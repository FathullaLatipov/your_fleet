"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/fuel. */
interface FuelItem {
  id: string;
  unit_number: string;
  driver: string | null;
  connected: boolean;
  odometer_miles: number | null;
  odometer_source: string | null;
  odometer_updated_at: string | null;
  fuel_percent: number | null;
  fuel_updated_at: string | null;
  engine_hours: number | null;
  last_lat: number | null;
  last_lng: number | null;
  last_location_at: string | null;
  active_faults: number;
}
interface FuelData {
  items: FuelItem[];
  summary: {
    trucks: number;
    connected: number;
    reporting_fuel: number;
    avg_fuel_percent: number | null;
    trucks_with_faults: number;
  };
}

const num = (n: number | null, d = 0) =>
  n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: d });

function ago(iso: string | null): string {
  if (!iso) return "—";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

function FuelBar({ pct }: { pct: number }) {
  const color = pct <= 15 ? "bg-danger" : pct <= 30 ? "bg-cta" : "bg-pine";
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-mist">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
      </div>
      <span className="tabular-nums">{Math.round(pct)}%</span>
    </div>
  );
}

function FuelInner() {
  const { user } = useAuth();
  const [data, setData] = useState<FuelData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyConnected, setOnlyConnected] = useState(true);

  const load = useCallback(() => {
    api<FuelData>("/api/fleet/fuel")
      .then((d) => { setData(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  if (error && !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load fuel data.</p>
          <p className="mt-1 text-sm text-steel">({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (!data) return <div className="mx-auto max-w-6xl px-4 py-6"><Loader /></div>;

  const rows = onlyConnected ? data.items.filter((i) => i.connected) : data.items;
  const s = data.summary;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-steel">
          Odometer, fuel level and engine hours straight from Samsara. Updates every 15 minutes.
        </p>
        <Link href="/faults" className="btn-quiet !py-2 text-sm">
          Engine faults{s.trucks_with_faults > 0 && (
            <span className="ml-1.5 rounded bg-danger-wash px-1.5 text-xs font-bold text-danger">
              {s.trucks_with_faults}
            </span>
          )}
        </Link>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        {[
          ["Trucks on Samsara", `${s.connected} of ${s.trucks}`],
          ["Avg fuel level", s.avg_fuel_percent == null ? "—" : `${s.avg_fuel_percent}%`],
          ["Reporting fuel", String(s.reporting_fuel)],
          ["Trucks with faults", String(s.trucks_with_faults)],
        ].map(([label, value]) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-steel">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>

      <section className="card mt-5 p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <h2 className="font-bold">Trucks</h2>
          <label className="flex items-center gap-2 text-sm text-steel">
            <input type="checkbox" checked={onlyConnected}
                   onChange={(e) => setOnlyConnected(e.target.checked)} />
            Samsara-connected only
          </label>
        </div>
        {s.reporting_fuel === 0 && s.connected > 0 && (
          <p className="mx-5 mb-3 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-2.5 text-xs text-steel">
            None of these trucks report a fuel level to Samsara right now — the gateways send odometer
            and engine hours but not tank level. Fuel appears here automatically for trucks that do.
          </p>
        )}
        {rows.length === 0 ? (
          <p className="m-5 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-10 text-center text-sm text-steel">
            {onlyConnected
              ? "No trucks connected to Samsara yet."
              : "No trucks yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-line bg-mist text-left text-steel">
                  <th className="px-4 py-2.5 font-semibold">Unit</th>
                  <th className="px-3 py-2.5 font-semibold">Driver</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Odometer</th>
                  <th className="px-3 py-2.5 font-semibold">Fuel level</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Engine hrs</th>
                  <th className="px-3 py-2.5 font-semibold">Updated</th>
                  <th className="px-3 py-2.5 font-semibold">Where</th>
                  <th className="px-3 py-2.5 font-semibold">Faults</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.id} className="border-b border-line/60 hover:bg-mist/60">
                    <td className="px-4 py-2.5">
                      <Link href={`/fleet/${i.id}`} className="font-semibold text-pine hover:underline">
                        #{i.unit_number}
                      </Link>
                      {!i.connected && (
                        <span className="ml-1.5 text-xs text-faint">manual</span>
                      )}
                    </td>
                    <td className="max-w-[160px] truncate px-3 py-2.5 text-steel">{i.driver ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {num(i.odometer_miles)}{i.odometer_miles != null && <span className="text-faint"> mi</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {i.fuel_percent != null
                        ? <FuelBar pct={i.fuel_percent} />
                        : <span className="text-faint">not reported</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{num(i.engine_hours)}</td>
                    <td className="px-3 py-2.5 text-steel">
                      {i.connected ? ago(i.odometer_updated_at) : "manual"}
                    </td>
                    <td className="px-3 py-2.5">
                      {i.last_lat != null ? (
                        <Link className="text-pine hover:underline" target="_blank"
                              href={`/track?truck=${i.id}`}>
                          map
                        </Link>
                      ) : <span className="text-faint">—</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {i.active_faults > 0 ? (
                        <Link href={`/fleet/${i.id}?tab=faults`}
                              className="rounded bg-danger-wash px-1.5 py-0.5 text-xs font-bold text-danger">
                          {i.active_faults}
                        </Link>
                      ) : <span className="text-faint">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-4 text-xs text-faint">
        Fuel-card fill-ups (WEX, Comdata, EFS) with gallons and price are a separate integration —
        meanwhile log fuel receipts as <Link href="/expenses" className="font-semibold text-pine hover:underline">expenses</Link>.
      </p>
    </div>
  );
}

export default function FuelPage() {
  return (
    <AppShell title="Fuel">
      <FuelInner />
    </AppShell>
  );
}
