"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EXPENSE_LABELS, fmtUsd } from "@/lib/types";

/* Contract for /api/fleet/insights. */
interface Insights {
  per_truck: {
    vehicle_id: string;
    unit_number: string;
    total_cents: number;
    period_cents: number;
    expenses_count: number;
    cost_per_mile_cents: number | null;
  }[];
  monthly_by_category: {
    month: string;
    categories: Record<string, number>;
  }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(ym: string): string {
  const m = Number(ym.split("-")[1]);
  return MONTHS[m - 1] ?? ym;
}

/* Small multiples: one labeled row of mini bars per top category — no stacking. */
function CategorySmallMultiples({ rows }: { rows: Insights["monthly_by_category"] }) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    for (const [cat, cents] of Object.entries(row.categories)) {
      totals.set(cat, (totals.get(cat) ?? 0) + cents);
    }
  }
  const topCats = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  if (topCats.length === 0 || topCats.every(([, sum]) => sum === 0)) {
    return (
      <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
        No categorized spend yet — it shows up here as expenses come in.
      </p>
    );
  }

  return (
    <div className="mt-4">
      <ul className="space-y-4">
        {topCats.map(([cat, sum]) => {
          const catMax = Math.max(...rows.map((r) => r.categories[cat] ?? 0), 1);
          return (
            <li key={cat} className="grid grid-cols-[110px_1fr_90px] items-center gap-3 sm:grid-cols-[140px_1fr_110px]">
              <span className="truncate text-sm font-medium text-ink">{EXPENSE_LABELS[cat] ?? cat}</span>
              <div className="flex h-12 items-end gap-1.5">
                {rows.map((r) => {
                  const cents = r.categories[cat] ?? 0;
                  return (
                    <div key={r.month} className="group relative flex h-full flex-1 items-end">
                      {cents > 0 ? (
                        <div className="w-full rounded-t bg-pine"
                             style={{ height: `${Math.max((cents / catMax) * 100, 4)}%` }}>
                          <span className="pointer-events-none absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-panel px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink opacity-0 shadow-(--shadow-card) transition-opacity group-hover:opacity-100">
                            {fmtUsd(cents)}
                          </span>
                        </div>
                      ) : (
                        <div className="h-0.5 w-full rounded bg-mist" />
                      )}
                    </div>
                  );
                })}
              </div>
              <span className="text-right text-sm font-semibold tabular-nums">{fmtUsd(sum)}</span>
            </li>
          );
        })}
      </ul>
      {/* Months axis, once under the grid */}
      <div className="mt-2 grid grid-cols-[110px_1fr_90px] gap-3 sm:grid-cols-[140px_1fr_110px]">
        <span />
        <div className="flex gap-1.5">
          {rows.map((r) => (
            <span key={r.month} className="flex-1 text-center text-xs text-steel">
              {monthLabel(r.month)}
            </span>
          ))}
        </div>
        <span />
      </div>
    </div>
  );
}

function AnalyticsInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Insights | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Insights>("/api/fleet/insights").then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (error && data === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load fleet analytics.</p>
          <p className="mt-1 text-sm text-steel">The insights service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (data === null) return <Loader />;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-6">
      <section className="card p-5">
        <h2 className="text-lg font-bold">Cost per truck</h2>
        <p className="mt-0.5 text-sm text-steel">
          Where the money goes, truck by truck. Click a row to open the truck.
        </p>
        {data.per_truck.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
            No trucks with recorded costs yet.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-steel">
                  <th className="py-2 pr-3 font-medium">Unit</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 pr-3 text-right font-medium">Last 90d</th>
                  <th className="py-2 pr-3 text-right font-medium">$ per mile</th>
                  <th className="py-2 text-right font-medium">Entries</th>
                </tr>
              </thead>
              <tbody>
                {data.per_truck.map((t) => (
                  <tr key={t.vehicle_id}
                      className="cursor-pointer border-b border-line/60 transition-colors hover:bg-mist/60"
                      onClick={() => router.push(`/fleet/${t.vehicle_id}`)}>
                    <td className="py-2.5 pr-3">
                      <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">
                        #{t.unit_number}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{fmtUsd(t.total_cents)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{fmtUsd(t.period_cents)}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">
                      {t.cost_per_mile_cents != null ? `$${(t.cost_per_mile_cents / 100).toFixed(2)}` : "—"}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-steel">{t.expenses_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">Monthly spend by category</h2>
        <p className="mt-0.5 text-sm text-steel">
          Top categories over the last months — each row is its own scale.
        </p>
        <CategorySmallMultiples rows={data.monthly_by_category} />
      </section>

      <section className="card p-5">
        <h2 className="text-lg font-bold">Dig deeper</h2>
        <p className="mt-1 text-sm text-steel">
          These numbers come from your expense ledger and service history. Browse and filter every
          entry on <Link href="/expenses" className="font-medium text-pine hover:underline">Expenses</Link>,
          or see the work behind them on{" "}
          <Link href="/service-records" className="font-medium text-pine hover:underline">Service records</Link>.
        </p>
      </section>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <AppShell title="Analytics">
      <AnalyticsInner />
    </AppShell>
  );
}
