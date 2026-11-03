"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EXPENSE_LABELS, fmtUsd } from "@/lib/types";

/* Contract for /api/fleet/service-records. */
interface ServiceRecord {
  date: string;
  vehicle_id: string;
  unit_number: string;
  kind: "marketplace" | "logged";
  description: string;
  category: string | null;
  amount_cents: number | null;
  odometer_miles: number | null;
  booking_id: string | null;
  shop_name: string | null;
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

function ServiceRecordsInner() {
  const { user } = useAuth();
  const [records, setRecords] = useState<ServiceRecord[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<ServiceRecord[]>("/api/fleet/service-records", { params: { vehicle_id: vehicleId || undefined } })
      .then(setRecords)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [vehicleId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    api<VehicleOpt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
  }, [user]);

  if (error && records === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your service records.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const total = records?.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0) ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Service records</h2>
            <p className="mt-0.5 text-sm text-steel">
              The full service history across the fleet — marketplace repairs and logged work together.
            </p>
          </div>
          <select
            className="field !w-auto !py-2 text-sm"
            aria-label="Filter by truck"
            value={vehicleId}
            onChange={(e) => { setRecords(null); setVehicleId(e.target.value); }}
          >
            <option value="">All trucks</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
          </select>
        </div>

        {records === null ? (
          <Loader />
        ) : records.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
            No service records yet. Completed marketplace repairs land here automatically, and
            service expenses you log on a truck show up alongside them.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-steel">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 font-medium">What</th>
                  <th className="py-2 pr-3 font-medium">Where</th>
                  <th className="py-2 pr-3 font-medium">Odometer</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={`${r.vehicle_id}-${r.date}-${i}`}
                      className="border-b border-line/60 transition-colors hover:bg-mist/60">
                    <td className="py-2.5 pr-3 text-steel">{new Date(r.date).toLocaleDateString()}</td>
                    <td className="py-2.5 pr-3">
                      <Link href={`/fleet/${r.vehicle_id}`}
                            className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel hover:text-ink">
                        #{r.unit_number}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      {r.kind === "marketplace" && r.booking_id ? (
                        <Link href={`/bookings/${r.booking_id}`}
                              className="mr-1.5 rounded bg-pine-wash px-1.5 py-0.5 text-xs font-semibold text-pine hover:underline">
                          Marketplace
                        </Link>
                      ) : (
                        <span className="mr-1.5 rounded bg-mist px-1.5 py-0.5 text-xs font-medium text-steel">
                          {r.kind === "marketplace" ? "Marketplace" : "Logged"}
                        </span>
                      )}
                      {r.description}
                      {r.category && EXPENSE_LABELS[r.category] && (
                        <span className="ml-1.5 text-xs text-faint">{EXPENSE_LABELS[r.category]}</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-steel">{r.shop_name ?? "Logged manually"}</td>
                    <td className="py-2.5 pr-3 text-steel">
                      {r.odometer_miles != null ? `${Math.round(r.odometer_miles).toLocaleString()} mi` : "—"}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">{fmtUsd(r.amount_cents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="py-2.5 pr-3 font-semibold text-steel">
                    {records.length} record{records.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2.5 text-right font-bold tabular-nums">{fmtUsd(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ServiceRecordsPage() {
  return (
    <AppShell title="Service records">
      <ServiceRecordsInner />
    </AppShell>
  );
}
