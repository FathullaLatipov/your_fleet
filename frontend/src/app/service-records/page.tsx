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
  expense_id: string | null;
  shop_name: string | null;
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");

function ServiceRecordsInner() {
  const { user } = useAuth();
  const [records, setRecords] = useState<ServiceRecord[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exporting, setExporting] = useState<string>("");
  const [exportError, setExportError] = useState<string | null>(null);

  async function download(
    format: "xlsx" | "pdf",
    single?: { booking_id?: string | null; expense_id?: string | null },
  ) {
    const key = single
      ? `${single.booking_id ?? single.expense_id}:${format}`
      : format;
    setExporting(key);
    setExportError(null);
    try {
      const qs = new URLSearchParams({ format });
      if (single?.booking_id) {
        qs.set("booking_id", single.booking_id);
      } else if (single?.expense_id) {
        qs.set("expense_id", single.expense_id);
      } else {
        if (vehicleId) qs.set("vehicle_id", vehicleId);
        if (dateFrom) qs.set("date_from", dateFrom);
        if (dateTo) qs.set("date_to", dateTo);
      }
      let auth: Record<string, string> = {};
      try {
        const t = localStorage.getItem("yf_token");
        if (t) auth = { Authorization: `Bearer ${t}` };
      } catch { /* ignore */ }
      const res = await fetch(`${API_URL}/api/fleet/service-records/export?${qs}`, { headers: auth });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? `service-records.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting("");
    }
  }

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

        {/* Export: pick a period (optional) and download XLSX or PDF */}
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-3.5">
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="exp-from">From</label>
            <input id="exp-from" type="date" className="field mt-1 !w-40 !py-2 text-sm"
                   value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="exp-to">To</label>
            <input id="exp-to" type="date" className="field mt-1 !w-40 !py-2 text-sm"
                   value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button className="btn !py-2 text-sm" disabled={exporting !== ""}
                  onClick={() => void download("xlsx")}>
            {exporting === "xlsx" ? "Preparing…" : "Download XLSX"}
          </button>
          <button className="btn-quiet !py-2 text-sm" disabled={exporting !== ""}
                  onClick={() => void download("pdf")}>
            {exporting === "pdf" ? "Preparing…" : "Download PDF"}
          </button>
          <p className="basis-full text-xs text-faint sm:basis-auto">
            Empty dates = full history. The truck filter above applies too.
          </p>
          {exportError && <p className="basis-full text-sm font-medium text-danger">{exportError}</p>}
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
                    <td className="py-2.5 pl-3 text-right">
                      <span className="inline-flex gap-1">
                        {(["xlsx", "pdf"] as const).map((f) => {
                          const key = `${r.booking_id ?? r.expense_id}:${f}`;
                          return (
                            <button
                              key={f}
                              disabled={exporting !== ""}
                              onClick={() => void download(f, r)}
                              title={`Download this record as ${f.toUpperCase()}`}
                              className="rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-steel transition-colors hover:border-pine/50 hover:text-pine disabled:opacity-50"
                            >
                              {exporting === key ? "…" : f.toUpperCase()}
                            </button>
                          );
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} className="py-2.5 pr-3 font-semibold text-steel">
                    {records.length} record{records.length === 1 ? "" : "s"}
                  </td>
                  <td className="py-2.5 text-right font-bold tabular-nums">{fmtUsd(total)}</td>
                  <td />
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
