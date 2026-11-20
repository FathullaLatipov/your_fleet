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
function LovesBadge() {
  return (
    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cta text-xs font-extrabold text-white shadow-sm">
      L
    </span>
  );
}

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
      <button type="button" onClick={() => setStation(s)}
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
    const gmaps = selected
      ? `https://www.google.com/maps/dir/${selected.lat},${selected.lng}/${station.lat},${station.lng}`
      : `https://www.google.com/maps/search/?api=1&query=${station.lat},${station.lng}`;
    return (
      <div className="absolute inset-x-3 top-3 z-[600] sm:left-auto sm:right-3 sm:w-80">
        <div className="card overflow-hidden p-0 shadow-(--shadow-lift)">
          <div className="flex items-start gap-3 border-b border-line p-4">
            <LovesBadge />
            <div className="min-w-0 flex-1">
              <h3 className="font-bold leading-snug">{station.name || "Love's Travel Stop"}</h3>
              <p className="text-xs text-steel">Love&apos;s Travel Stop</p>
            </div>
            <button type="button" onClick={() => setStation(null)} aria-label="Close"
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-lg text-steel hover:bg-mist hover:text-ink">
              ×
            </button>
          </div>
          <div className="space-y-2 p-4 text-sm">
            {(station.street || where) && (
              <p className="text-ink">
                {station.street && <>{station.street}<br /></>}
                {where || "United States"}
              </p>
            )}
            {stationMiles != null && (
              <p className="text-steel">
                <span className="font-semibold text-cta">{stationMiles} mi</span> from #{selected!.unit_number}
              </p>
            )}
            <p className="text-xs text-faint tabular-nums">
              {station.lat.toFixed(5)}, {station.lng.toFixed(5)}
            </p>
            <div className="flex gap-2 pt-1">
              <a href={gmaps} target="_blank" rel="noopener noreferrer"
                 className="btn-quiet !py-1.5 text-sm">Directions ↗</a>
            </div>
            <p className="pt-1 text-[11px] text-faint">
              Location from OpenStreetMap. Not affiliated with Love&apos;s.
            </p>
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
                    onSelectLoves={setStation} focusStation={station} />
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
