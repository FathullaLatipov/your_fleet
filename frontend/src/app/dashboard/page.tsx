"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/badges";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd } from "@/lib/types";

/* Contract for GET /api/fleet/analytics. */
interface Analytics {
  kpis: {
    trucks: number;
    trucks_in_repair: number;
    open_defects: number;
    major_defects: number;
    active_requests: number;
    maintenance_overdue: number;
    maintenance_due_soon: number;
    document_warnings: number;
    spend_total_cents: number;
    spend_period_cents: number;
  };
  spend_trend: { month: string; total_cents: number }[];
  spend_by_category: { category: string; total_cents: number }[];
  top_issues: { label: string; count: number }[];
  deadlines: {
    vehicle_id: string;
    unit_number: string;
    title: string;
    status: "overdue" | "due_soon";
    miles_left: number | null;
    days_left: number | null;
  }[];
  open_defect_list: {
    id: string;
    vehicle_id: string;
    unit_number: string;
    defect_type: string;
    severity: string | null;
    reported_at: string;
  }[];
  active_request_list: {
    id: string;
    status: string;
    issue_description: string;
    created_at: string;
    unit_number: string | null;
  }[];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabel(ym: string): string {
  const m = Number(ym.split("-")[1]);
  return MONTHS[m - 1] ?? ym;
}

/* Compact y-axis money label: $0, $850, $1.2k */
function compactUsd(cents: number): string {
  const d = cents / 100;
  if (d >= 1000) {
    const k = d / 1000;
    return `$${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `$${Math.round(d)}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function UnitChip({ unit }: { unit: string }) {
  return (
    <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">#{unit}</span>
  );
}

/* Hand-rolled monthly spend bar chart: 6 bars, amber, baseline-anchored. */
function SpendTrendChart({ trend }: { trend: Analytics["spend_trend"] }) {
  const max = Math.max(...trend.map((t) => t.total_cents), 0);

  if (max === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-line bg-mist/60 px-4 py-8 text-center">
        <p className="max-w-[40ch] text-sm text-steel">
          No spend recorded yet — completed repairs land here automatically.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-8 flex gap-3">
      {/* y axis */}
      <div className="flex h-44 flex-col justify-between text-right text-xs tabular-nums text-faint">
        <span className="-translate-y-1/2">{compactUsd(max)}</span>
        <span>{compactUsd(max / 2)}</span>
        <span className="translate-y-1/2">$0</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-44">
          <div className="absolute inset-x-0 top-0 h-px bg-line" aria-hidden />
          <div className="absolute inset-x-0 top-1/2 h-px bg-line" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 h-px bg-line" aria-hidden />
          <div className="absolute inset-0 flex items-end gap-2 px-1">
            {trend.map((t) => {
              const isMax = t.total_cents === max;
              const pct = (t.total_cents / max) * 100;
              return (
                <div key={t.month} className="group flex h-full flex-1 items-end justify-center">
                  {t.total_cents > 0 && (
                    <div
                      className="relative w-full max-w-7 rounded-t bg-amber"
                      style={{ height: `${pct}%` }}
                    >
                      <span
                        className={`pointer-events-none absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-panel px-1.5 py-0.5 text-xs font-semibold tabular-nums text-ink shadow-(--shadow-card) ${
                          isMax ? "" : "opacity-0 transition-opacity group-hover:opacity-100"
                        }`}
                      >
                        {fmtUsd(t.total_cents)}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        {/* month labels */}
        <div className="mt-2 flex gap-2 px-1">
          {trend.map((t) => (
            <span key={t.month} className="flex-1 text-center text-xs text-steel">
              {monthLabel(t.month)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label, value, sub, href,
}: {
  label: string;
  value: string | number;
  sub?: React.ReactNode;
  href?: string;
}) {
  const body = (
    <>
      <p className="text-sm font-medium text-steel">{label}</p>
      <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">{value}</p>
      {sub && <div className="mt-2 text-sm">{sub}</div>}
    </>
  );
  if (href) {
    return (
      <Link href={href} className="card block p-5 transition-[border-color,box-shadow] hover:border-pine/50 hover:shadow-(--shadow-lift)">
        {body}
      </Link>
    );
  }
  return <div className="card p-5">{body}</div>;
}

function DashboardInner() {
  const { user } = useAuth();
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Analytics>("/api/fleet/analytics").then(setData).catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  const firstName = user?.full_name.split(" ")[0] ?? "";
  const dateLine = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your fleet overview.</p>
          <p className="mt-1 text-sm text-steel">
            The analytics service didn&apos;t respond. Your trucks and repairs are still available from the sidebar.
          </p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  if (!data) return <Loader />;

  const k = data.kpis;
  const otherDefects = Math.max(k.open_defects - k.major_defects, 0);
  const maintTotal = k.maintenance_overdue + k.maintenance_due_soon;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div>
        <h2 className="display text-2xl font-bold">
          {greeting()}, {firstName} 👋
        </h2>
        <p className="mt-1 text-sm text-steel">{dateLine} — here&apos;s where your fleet stands.</p>
      </div>

      {/* KPI row */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="My trucks"
          value={k.trucks}
          sub={k.trucks_in_repair > 0 ? <span className="text-amber-ink">{k.trucks_in_repair} in repair</span> : <span className="text-faint">All on the road</span>}
        />
        <KpiCard
          label="Open issues"
          value={k.open_defects}
          sub={
            k.open_defects > 0 ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="flex items-center gap-1.5 text-danger">
                  <span className="h-2 w-2 rounded-full bg-danger" aria-hidden />
                  {k.major_defects} major
                </span>
                <span className="flex items-center gap-1.5 text-amber-ink">
                  <span className="h-2 w-2 rounded-full bg-amber" aria-hidden />
                  {otherDefects} other
                </span>
              </span>
            ) : (
              <span className="text-faint">No open defects</span>
            )
          }
        />
        <KpiCard
          label="Maintenance"
          value={maintTotal}
          href="/fleet"
          sub={
            maintTotal > 0 ? (
              <span>
                <span className={k.maintenance_overdue > 0 ? "font-semibold text-danger" : "text-faint"}>
                  {k.maintenance_overdue} overdue
                </span>
                <span className="text-faint"> · </span>
                <span className={k.maintenance_due_soon > 0 ? "font-semibold text-amber-ink" : "text-faint"}>
                  {k.maintenance_due_soon} due soon
                </span>
              </span>
            ) : (
              <span className="text-faint">Everything on schedule</span>
            )
          }
        />
        <KpiCard
          label="Spend (90 days)"
          value={fmtUsd(k.spend_period_cents)}
          sub={<span className="text-faint tabular-nums">{fmtUsd(k.spend_total_cents)} all time</span>}
        />
      </div>

      {/* Chart + top issues */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <section className="card p-5">
          <h3 className="text-lg font-bold">Service cost trend</h3>
          <SpendTrendChart trend={data.spend_trend} />
        </section>

        <section className="card p-5">
          <h3 className="text-lg font-bold">Top issue reasons</h3>
          {data.top_issues.length === 0 ? (
            <p className="mt-4 text-sm text-steel">No defects recorded.</p>
          ) : (
            <ul className="mt-4 space-y-3.5">
              {data.top_issues.map((issue) => {
                const maxCount = Math.max(...data.top_issues.map((i) => i.count), 1);
                return (
                  <li key={issue.label}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm text-ink">{issue.label}</span>
                      <span className="font-semibold tabular-nums">{issue.count}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-mist">
                      <div
                        className="h-1.5 rounded-full bg-pine"
                        style={{ width: `${(issue.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {/* Deadlines / defects / requests */}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-3">
        <section className="card p-5">
          <h3 className="text-lg font-bold">Deadlines</h3>
          {data.deadlines.length === 0 ? (
            <p className="mt-4 text-sm text-steel">Nothing due. 🎉</p>
          ) : (
            <ul className="-mx-2 mt-3 space-y-0.5">
              {data.deadlines.map((d, i) => (
                <li key={`${d.vehicle_id}-${d.title}-${i}`}>
                  <Link
                    href={`/fleet/${d.vehicle_id}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-mist"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <UnitChip unit={d.unit_number} />
                      <span className="truncate text-sm font-medium">{d.title}</span>
                    </span>
                    {d.status === "overdue" ? (
                      <span className="shrink-0 rounded bg-danger-wash px-2 py-0.5 text-xs font-semibold text-danger">
                        Overdue
                      </span>
                    ) : (
                      <span className="shrink-0 rounded bg-amber-wash px-2 py-0.5 text-xs font-semibold text-amber-ink">
                        {d.days_left != null
                          ? `in ${d.days_left} d`
                          : d.miles_left != null
                          ? `${Math.round(d.miles_left).toLocaleString()} mi left`
                          : "Due soon"}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h3 className="text-lg font-bold">Open defects</h3>
          {data.open_defect_list.length === 0 ? (
            <p className="mt-4 text-sm text-steel">No open defects. Pre-trip inspections land here.</p>
          ) : (
            <ul className="-mx-2 mt-3 space-y-0.5">
              {data.open_defect_list.map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/fleet/${d.vehicle_id}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-mist"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <UnitChip unit={d.unit_number} />
                      <span className="truncate text-sm font-medium">{d.defect_type}</span>
                    </span>
                    {d.severity && (
                      <span
                        className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                          d.severity === "major" ? "bg-danger-wash text-danger" : "bg-amber-wash text-amber-ink"
                        }`}
                      >
                        {d.severity}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <h3 className="text-lg font-bold">Active requests</h3>
          {data.active_request_list.length === 0 ? (
            <div className="mt-4">
              <p className="text-sm text-steel">No repair requests in flight.</p>
              <Link href="/search" className="btn-quiet mt-3 !py-2 text-sm">Find a shop</Link>
            </div>
          ) : (
            <ul className="-mx-2 mt-3 space-y-0.5">
              {data.active_request_list.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/bookings/${r.id}`}
                    className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-mist"
                  >
                    <span className="min-w-0 truncate text-sm font-medium">
                      {r.issue_description.slice(0, 60)}
                      {r.issue_description.length > 60 ? "…" : ""}
                    </span>
                    <StatusBadge status={r.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href="/repairs" className="mt-3 inline-block text-sm font-medium text-pine hover:underline">
            All repairs →
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AppShell title="Dashboard">
      <DashboardInner />
    </AppShell>
  );
}
