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

const MILES_PER_DEG = 69;

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

function TrackInner() {
  const { user } = useAuth();
  const params = useSearchParams();
  const [trucks, setTrucks] = useState<TruckPos[] | null>(null);
  const [loves, setLoves] = useState<LovesStop[]>([]);
  const [lovesSource, setLovesSource] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(params.get("truck"));
  const [showList, setShowList] = useState(true); // mobile toggle

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

  // Nearest Love's to the selected truck.
  const nearest = useMemo(() => {
    if (!selected || loves.length === 0) return [];
    return loves
      .map((s) => ({ s, d: miles(selected.lat, selected.lng, s.lat, s.lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
  }, [selected, loves]);

  if (trucks === null) return <div className="p-10"><Loader /></div>;

  return (
    <div className="flex h-[calc(100vh-6.5rem)] flex-col lg:h-[calc(100vh-3.5rem)]">
      {/* Mobile list/map toggle */}
      <div className="flex border-b border-line bg-panel lg:hidden">
        {(["Trucks", "Map"] as const).map((label) => (
          <button key={label}
                  className={`flex-1 py-2 text-sm font-semibold ${
                    (label === "Map") === !showList ? "border-b-2 border-pine text-pine" : "text-steel"}`}
                  onClick={() => setShowList(label === "Trucks")}>
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left: trucks + nearest Love's */}
        <div className={`min-h-0 w-full overflow-y-auto border-r border-line bg-mist lg:max-w-[360px] ${showList ? "" : "hidden lg:block"}`}>
          {trucks.length === 0 ? (
            <div className="p-5 text-sm text-steel">
              No live truck positions yet. Connect trucks to Samsara to see them on the map.
            </div>
          ) : (
            <div className="p-3">
              <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-steel">
                Trucks ({trucks.length})
              </p>
              <div className="space-y-1">
                {trucks.map((t) => (
                  <button key={t.id} onClick={() => { setSelectedId(t.id); setShowList(false); }}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            t.id === selectedId ? "bg-panel shadow-(--shadow-card)" : "hover:bg-panel/60"}`}>
                    <span className="min-w-0">
                      <span className="font-semibold">#{t.unit_number}</span>
                      {t.driver && <span className="ml-1.5 text-steel">{t.driver}</span>}
                    </span>
                    <span className="shrink-0 text-xs text-faint">
                      {t.speed_mph != null && (t.speed_mph ?? 0) > 1 ? `${Math.round(t.speed_mph)} mph` : ago(t.located_at)}
                    </span>
                  </button>
                ))}
              </div>

              {selected && (
                <div className="mt-4">
                  <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-steel">
                    Love&apos;s near #{selected.unit_number}
                  </p>
                  {loves.length === 0 ? (
                    <p className="px-1 text-xs text-faint">Love&apos;s locations are loading…</p>
                  ) : (
                    <div className="space-y-1">
                      {nearest.map(({ s, d }) => (
                        <a key={`${s.lat},${s.lng}`}
                           href={`https://www.google.com/maps/dir/${selected.lat},${selected.lng}/${s.lat},${s.lng}`}
                           target="_blank" rel="noopener noreferrer"
                           className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm hover:bg-panel/60">
                          <span className="min-w-0">
                            <span className="font-medium">{s.name.replace(/^Love's /, "")}</span>
                            {(s.city || s.state) && (
                              <span className="block text-xs text-faint">{[s.city, s.state].filter(Boolean).join(", ")}</span>
                            )}
                          </span>
                          <span className="shrink-0 rounded bg-cta/10 px-1.5 py-0.5 text-xs font-semibold text-cta">
                            {Math.round(d)} mi
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {lovesSource && (
                <p className="mt-4 px-1 text-[11px] text-faint">
                  Love&apos;s locations: {lovesSource}. Community-mapped, may be incomplete.
                </p>
              )}
            </div>
          )}
        </div>

        {/* Right: map */}
        <div className={`relative min-h-0 flex-1 ${showList ? "hidden lg:block" : ""}`}>
          <TrackMap trucks={trucks} loves={loves} selectedId={selectedId} onSelectTruck={setSelectedId} />
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
