"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd } from "@/lib/types";
import {
  WO_PRIORITY_LABELS,
  WO_SERVICE_LABELS,
  WO_STATUS_LABELS,
  WO_STATUS_ORDER,
  WorkOrder,
  statusPill,
  unitLabel,
} from "@/lib/workOrders";

function WorkOrdersInner() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<WorkOrder[] | null>(null);
  const [filter, setFilter] = useState<string>("active");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    const params =
      filter === "active" ? { open_only: true }
      : filter === "all" ? {}
      : { status: filter };
    api<WorkOrder[]>("/api/fleet/work-orders", { params })
      .then(setOrders)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [filter]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (error && orders === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your work orders.</p>
          <p className="mt-1 text-sm text-steel">({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Work orders</h2>
            <p className="mt-0.5 text-sm text-steel">
              Repair requests from first call to closed invoice.
            </p>
          </div>
          <Link href="/work-orders/new" className="btn !py-2 text-sm">
            Create Request
          </Link>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {[
            { key: "active", label: "Active" },
            ...WO_STATUS_ORDER.map((s) => ({ key: s, label: WO_STATUS_LABELS[s] })),
            { key: "all", label: "All" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => { setOrders(null); setFilter(f.key); }}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                filter === f.key
                  ? "bg-charcoal text-white"
                  : "bg-mist text-steel hover:text-ink"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {orders === null ? (
          <Loader />
        ) : orders.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-8 text-center text-sm text-steel">
            No work orders here yet. Hit <span className="font-semibold">Create Request</span> when
            a truck or trailer needs service.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-steel">
                  <th className="py-2 pr-3 font-medium">WO&nbsp;#</th>
                  <th className="py-2 pr-3 font-medium">Opened</th>
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Shop</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 text-right font-medium">Final</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((wo) => (
                  <tr key={wo.id}
                      className="border-b border-line/60 transition-colors hover:bg-mist/60">
                    <td className="py-2.5 pr-3">
                      <Link href={`/work-orders/${wo.id}`}
                            className="font-semibold text-pine hover:underline">
                        WO-{wo.wo_number}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3 text-steel">
                      {new Date(wo.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 pr-3">{unitLabel(wo)}</td>
                    <td className="py-2.5 pr-3">
                      {WO_SERVICE_LABELS[wo.service_type] ?? wo.service_type}
                      {wo.priority !== "normal" && (
                        <span className="ml-1.5 rounded bg-cta/10 px-1.5 py-0.5 text-xs font-semibold text-cta">
                          {WO_PRIORITY_LABELS[wo.priority] ?? wo.priority}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-steel">{wo.shop_name ?? "—"}</td>
                    <td className="py-2.5 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusPill(wo.status)}`}>
                        {WO_STATUS_LABELS[wo.status]}
                      </span>
                      {wo.quote_count > 0 && wo.status !== "closed" && (
                        <span className="ml-1.5 text-xs text-faint">
                          {wo.quote_count} quote{wo.quote_count === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">
                      {wo.final_amount_cents != null ? fmtUsd(wo.final_amount_cents) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default function WorkOrdersPage() {
  return (
    <AppShell title="Work orders">
      <WorkOrdersInner />
    </AppShell>
  );
}
