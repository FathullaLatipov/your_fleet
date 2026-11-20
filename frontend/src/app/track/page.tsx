"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import type { LovesStop, TruckPos } from "@/components/TrackMap";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const TrackMap = dynamic(() => import("@/components/TrackMap"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-faint">Loading map…</div>,
});

interface LovesData {
  source: string;
  count: number;
  locations: LovesStop[];
}

/* Great-circle distance in miles (haversine). */
function miles(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(s));
}

function ago(iso: string | null): string {
  if (!iso) return "no fix";
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 2) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const LIST_CAP = 300;

/* Small orange "L" badge — same mark Love's gets on the map. */
function LovesBadge({ className = "h-7 w-7 text-xs" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-full bg-cta font-extrabold text-white shadow-sm ${className}`}>
      L
    </span>
  );
}

/* Amenities standard to the Love's Travel Stop format (the chain we filtered
   to). Per-store extras vary, so the panel labels these as typical. */
const AMENITIES: { label: string; icon: React.ReactNode }[] = [
  { label: "Truck Parking", icon: <path d="M5 4h14v16H5zM9 16V9h3.5a2.5 2.5 0 0 1 0 5H9" /> },
  { label: "Maintenance", icon: <path d="M14 7a4 4 0 0 1-5 5l-5 5 2 2 5-5a4 4 0 0 0 5-5z" /> },
  { label: "ATM", icon: <path d="M3 6h18v12H3zM3 10h18" /> },
  { label: "Scales", icon: <path d="M12 3v18M6 7h12M6 7l-3 6a3 3 0 0 0 6 0zM18 7l-3 6a3 3 0 0 0 6 0z" /> },
  { label: "Pet Area", icon: <path d="M6 13a3 3 0 0 0-3 3 2 2 0 0 0 2 2h14a2 2 0 0 0 2-2 3 3 0 0 0-3-3M7 9v.01M12 7v.01M17 9v.01" /> },
  { label: "Laundry", icon: <path d="M5 3h14v18H5zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM8 6h.01M11 6h.01" /> },
  { label: "Overnight", icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /> },
  { label: "Shower", icon: <path d="M12 3s5 6 5 10a5 5 0 0 1-10 0c0-4 5-10 5-10z" /> },
  { label: "WiFi", icon: <path d="M5 12a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0M12 18h.01" /> },
  { label: "Restaurant", icon: <path d="M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M16 3c-2 0-3 2-3 5s1 4 3 4v9" /> },
];

function TrackInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [trucks, setTrucks] = useState<TruckPos[] | null>(null);
  const [loves, setLoves] = useState<LovesStop[]>([]);
  const [lovesSource, setLovesSource] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("truck"));

  const [tab, setTab] = useState<"map" | "list">("map");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("");
  const [sort, setSort] = useState<"nearest" | "name">("nearest");
  const [station, setStation] = useState<LovesStop | null>(null); // opened Love's detail
  const [stationTab, setStationTab] = useState<"info" | "amenities">("info");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    api<{ items: TruckPos[] }>("/api/fleet/positions")
      .then((d) => {
        setTrucks(d.items);
        setSelectedId((cur) => cur ?? d.items[0]?.id ?? null);
      })
      .catch(() => setTrucks([]));
  }, [user]);

  useEffect(() => {
    fetch("/data/loves-locations.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: LovesData | null) => {
        if (d) { setLoves(d.locations); setLovesSource(d.source); }
      })
      .catch(() => {});
  }, []);

  const selected = trucks?.find((t) => t.id === selectedId) ?? null;

  // States present in the data, for the filter dropdown.
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const s of loves) if (s.state) set.add(s.state.toUpperCase());
    return [...set].sort();
  }, [loves]);

  // Search + state filter + sort, with distance from the selected truck.
  const stations = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = loves;
    if (stateFilter) rows = rows.filter((s) => (s.state ?? "").toUpperCase() === stateFilter);
    if (q) {
      rows = rows.filter((s) =>
        [s.name, s.city, s.state].some((v) => (v ?? "").toLowerCase().includes(q)),
      );
    }
    const withD = rows.map((s) => ({
      s,
      d: selected ? miles(selected.lat, selected.lng, s.lat, s.lng) : null,
    }));
    if (sort === "nearest" && selected) {
      withD.sort((a, b) => (a.d ?? Infinity) - (b.d ?? Infinity));
    } else {
      withD.sort((a, b) =>
        `${a.s.state ?? "zz"}${a.s.city ?? ""}`.localeCompare(`${b.s.state ?? "zz"}${b.s.city ?? ""}`));
    }
    return withD;
  }, [loves, query, stateFilter, sort, selected]);

  if (trucks === null) return <div className="p-10"><Loader /></div>;

  const totalStations = stations.length;
  const shown = stations.slice(0, tab === "list" ? LIST_CAP : 8);

  // One station row, shared by both tabs. Opens our own detail panel
  // (centers the map there too) instead of jumping to Google Maps.
  const StationRow = ({ s, d }: { s: LovesStop; d: number | null }) => {
    const where = [s.city, s.state].filter(Boolean).join(", ");
    const active = station?.lat === s.lat && station?.lng === s.lng;
    return (
      <button type="button" onClick={() => { setStation(s); setStationTab("info"); }}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active ? "bg-panel shadow-(--shadow-card)" : "hover:bg-panel/60"}`}>
        <LovesBadge />
        <span className="min-w-0 flex-1">
          <span className="font-medium">{s.name.replace(/^Love's ?/, "") || "Love's"}</span>
          <span className="block text-xs text-faint">{where || "Love's Travel Stop"}</span>
        </span>
        {d != null && (
          <span className="shrink-0 rounded bg-cta/10 px-1.5 py-0.5 text-xs font-semibold text-cta">
            {Math.round(d)} mi
          </span>
        )}
      </button>
    );
  };

  // Detail panel for an opened Love's stop — our own "tab about that truck stop".
  const stationMiles = station && selected
    ? Math.round(miles(selected.lat, selected.lng, station.lat, station.lng)) : null;
  const StationDetail = () => {
    if (!station) return null;
    const where = [station.city, station.state].filter(Boolean).join(", ");
    const title = station.ref ? `Love's #${station.ref}` : "Love's Travel Stop";
    const address = [station.street, where].filter(Boolean).join(", ");
    const gmaps = selected
      ? `https://www.google.com/maps/dir/${selected.lat},${selected.lng}/${station.lat},${station.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}`;
    const copyAddress = () => {
      navigator.clipboard?.writeText(address || `${station.lat}, ${station.lng}`)
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })
        .catch(() => {});
    };
    const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">{label}</p>
        <div className="mt-0.5 text-sm text-ink">{children}</div>
      </div>
    );
    return (
      <div className="absolute inset-x-3 top-3 z-[600] sm:left-auto sm:right-3 sm:w-80">
        <div className="card flex max-h-[calc(100%-1.5rem)] flex-col overflow-hidden p-0 shadow-(--shadow-lift)">
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-line px-4 py-3">
            <LovesBadge className="h-9 w-9 text-sm" />
            <h3 className="min-w-0 flex-1 truncate font-bold">{title}</h3>
            <button type="button" onClick={() => setStation(null)} aria-label="Close"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg text-steel hover:bg-mist hover:text-ink">
              ×
            </button>
          </div>
          {/* Tabs */}
          <div className="flex gap-2 px-4 pt-3">
            {([["info", "General Information"], ["amenities", "Amenities"]] as const).map(([k, label]) => (
              <button key={k} type="button" onClick={() => setStationTab(k)}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        stationTab === k ? "bg-cta text-white" : "bg-mist text-steel hover:text-ink"}`}>
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {stationTab === "info" ? (
              <div className="space-y-3.5">
                <Row label="Address">
                  <div className="flex items-start justify-between gap-2">
                    <span>{address || "United States"}</span>
                    <button type="button" onClick={copyAddress} aria-label="Copy address"
                            className="shrink-0 text-steel hover:text-ink" title="Copy address">
                      {copied ? <span className="text-xs font-semibold text-pine">Copied</span> : "⧉"}
                    </button>
                  </div>
                </Row>
                {stationMiles != null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-cta/10 px-2.5 py-1 text-xs font-semibold text-cta">
                    📍 {stationMiles} mi from #{selected!.unit_number}
                  </span>
                )}
                <Row label="Name">{title}</Row>
                <Row label="Coordinates">
                  <span className="tabular-nums">{station.lat.toFixed(5)}, {station.lng.toFixed(5)}</span>
                </Row>
                <div className="pt-1">
                  <a href={gmaps} target="_blank" rel="noopener noreferrer"
                     className="btn-quiet !py-1.5 text-sm">Directions ↗</a>
                </div>
                <p className="border-t border-line pt-2 text-[11px] text-faint">
                  Fuel prices &amp; IFTA aren&apos;t connected yet. Location from OpenStreetMap;
                  not affiliated with Love&apos;s.
                </p>
              </div>
            ) : (
              <div>
                <div className="grid grid-cols-3 gap-2">
                  {AMENITIES.map((a) => (
                    <div key={a.label}
                         className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-mist/40 px-1 py-3 text-center">
                      <svg viewBox="0 0 24 24" width="22" height="22" fill="none"
                           stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                           strokeLinejoin="round" className="text-steel">
                        {a.icon}
                      </svg>
                      <span className="text-[11px] font-medium leading-tight text-steel">{a.label}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-faint">
                  Typical Love&apos;s Travel Stop amenities — verify on site; extras vary by location.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const Toolbar = (
    <div className="border-b border-line bg-panel px-3 py-2.5">
      {/* Map / List tabs */}
      <div className="flex gap-4">
        {(["map", "list"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
                  className={`pb-1.5 text-sm font-semibold capitalize transition-colors ${
                    tab === t ? "border-b-2 border-pine text-pine" : "text-steel hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>
      {/* Search + filters */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search station, city or state…"
          className="field min-w-0 flex-1 !py-1.5 text-sm"
        />
        <select value={stateFilter} onChange={(e) => setStateFilter(e.target.value)}
                className="field !w-auto !py-1.5 text-sm">
          <option value="">All states</option>
          {states.map((st) => <option key={st} value={st}>{st}</option>)}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as "nearest" | "name")}
                className="field !w-auto !py-1.5 text-sm">
          <option value="nearest">Nearest</option>
          <option value="name">A–Z</option>
        </select>
        {(query || stateFilter) && (
          <button onClick={() => { setQuery(""); setStateFilter(""); }}
                  className="text-sm font-medium text-cta hover:underline">
            Reset
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col lg:h-[calc(100vh-3.5rem)]">
      {Toolbar}

      <div className="relative flex min-h-0 flex-1">
        <StationDetail />
        {/* LEFT: Map tab -> trucks + nearby; List tab -> all stations */}
        <div className={`min-h-0 w-full overflow-y-auto border-r border-line bg-mist lg:max-w-[380px] ${
          tab === "list" ? "" : "hidden lg:block"}`}>
          {tab === "map" ? (
            <div className="p-3">
              <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-steel">
                Trucks ({trucks.length})
              </p>
              {trucks.length === 0 ? (
                <p className="px-1 py-2 text-sm text-steel">
                  No live positions yet. Connect trucks to Samsara.
                </p>
              ) : (
                <div className="space-y-1">
                  {trucks.map((t) => (
                    <button key={t.id} onClick={() => setSelectedId(t.id)}
                            className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                              t.id === selectedId ? "bg-panel shadow-(--shadow-card)" : "hover:bg-panel/60"}`}>
                      <span className="min-w-0 truncate">
                        <span className="font-semibold">#{t.unit_number}</span>
                        {t.driver && <span className="ml-1.5 text-steel">{t.driver}</span>}
                      </span>
                      <span className="shrink-0 text-xs text-faint tabular-nums">
                        <span className="text-steel">{Math.round(t.speed_mph ?? 0)} mph</span>
                        {" / "}{ago(t.located_at)}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {selected && (
                <div className="mt-4">
                  <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-steel">
                    Love&apos;s near #{selected.unit_number}
                  </p>
                  {loves.length === 0 ? (
                    <p className="px-1 text-xs text-faint">Love&apos;s locations are loading…</p>
                  ) : shown.length === 0 ? (
                    <p className="px-1 text-xs text-faint">No stations match your filters.</p>
                  ) : (
                    <div className="space-y-1">
                      {shown.map(({ s, d }) => <StationRow key={`${s.lat},${s.lng}`} s={s} d={d} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* LIST tab: all stations, filtered + sorted */
            <div className="p-3">
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-steel">
                  {totalStations.toLocaleString()} station{totalStations === 1 ? "" : "s"}
                </p>
                {trucks.length > 0 && (
                  <label className="flex items-center gap-1.5 text-xs text-steel">
                    From
                    <select value={selectedId ?? ""} onChange={(e) => setSelectedId(e.target.value)}
                            className="field !w-auto !py-1 text-xs">
                      {trucks.map((t) => (
                        <option key={t.id} value={t.id}>#{t.unit_number}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              {shown.length === 0 ? (
                <p className="px-1 py-6 text-center text-sm text-faint">
                  No stations match your filters.
                </p>
              ) : (
                <div className="space-y-1">
                  {shown.map(({ s, d }) => <StationRow key={`${s.lat},${s.lng}`} s={s} d={d} />)}
                  {totalStations > LIST_CAP && (
                    <p className="px-1 py-2 text-center text-xs text-faint">
                      Showing the {sort === "nearest" && selected ? "nearest " : "first "}{LIST_CAP} of{" "}
                      {totalStations.toLocaleString()} — narrow it with search or a state.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {lovesSource && (
            <p className="px-4 pb-4 text-[11px] text-faint">
              Love&apos;s locations: {lovesSource}. Community-mapped, may be incomplete.
            </p>
          )}
        </div>

        {/* RIGHT: map (always shows trucks + Love's). Hidden on mobile in List tab. */}
        <div className={`relative min-h-0 flex-1 ${tab === "list" ? "hidden lg:block" : ""}`}>
          <TrackMap trucks={trucks} loves={loves} selectedId={selectedId} onSelectTruck={setSelectedId}
                    onSelectLoves={(s) => { setStation(s); setStationTab("info"); }} focusStation={station} />
          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-md border border-line bg-panel/95 px-3 py-2 text-xs text-steel shadow">
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-charcoal" /> Truck
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cta" /> Love&apos;s
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TrackPage() {
  return (
    <AppShell title="Tracking">
      <Suspense fallback={<Loader />}>
        <TrackInner />
      </Suspense>
    </AppShell>
  );
}
