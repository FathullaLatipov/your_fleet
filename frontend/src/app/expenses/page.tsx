"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { EXPENSE_LABELS, fmtUsd } from "@/lib/types";

/* Contract for /api/fleet/expenses. */
interface ExpenseItem {
  id: string;
  vehicle_id: string;
  unit_number: string;
  category: string;
  description: string;
  amount_cents: number;
  odometer_miles: number | null;
  incurred_at: string;
  booking_id: string | null;
}

interface ExpensesResponse {
  items: ExpenseItem[];
  total_cents: number;
  totals_by_category: Record<string, number>;
  monthly: { month: string; total_cents: number }[];
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

/* Contract for /api/fleet/finance/monthly. */
interface MonthlyCosts {
  months: {
    month: string;
    repairs_cents: number;
    loans_cents: number;
    leases_cents: number;
    total_cents: number;
  }[];
  loan_monthly_cents: number;
  lease_monthly_cents: number;
  financed_trucks: number;
  leased_trailers: number;
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

/* Monthly spend bar chart — same construction as the dashboard trend chart. */
function MonthlyChart({ monthly }: { monthly: ExpensesResponse["monthly"] }) {
  const max = Math.max(...monthly.map((t) => t.total_cents), 0);

  if (max === 0) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-lg border border-dashed border-line bg-mist/60 px-4 py-8 text-center">
        <p className="max-w-[40ch] text-sm text-steel">
          Nothing spent in this window — widen the filters or log an expense below.
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
            {monthly.map((t) => {
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
          {monthly.map((t) => (
            <span key={t.month} className="flex-1 text-center text-xs text-steel">
              {monthLabel(t.month)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ExpensesInner() {
  const { user } = useAuth();
  const [data, setData] = useState<ExpensesResponse | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [category, setCategory] = useState("");
  const [months, setMonths] = useState("6");
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    vehicle_id: "", category: "repair", description: "", amount: "", odometer: "", date: "",
  });
  const [monthlyCosts, setMonthlyCosts] = useState<MonthlyCosts | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<ExpensesResponse>("/api/fleet/expenses", {
      params: {
        vehicle_id: vehicleId || undefined,
        category: category || undefined,
        months: Number(months),
      },
    })
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [vehicleId, category, months]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    api<VehicleOpt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
    api<MonthlyCosts>("/api/fleet/finance/monthly").then(setMonthlyCosts).catch(() => {});
  }, [user]);

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionErr(null);
    try {
      await api("/api/fleet/expenses", {
        method: "POST",
        body: {
          vehicle_id: form.vehicle_id,
          category: form.category,
          description: form.description,
          amount_cents: Math.round(Number(form.amount) * 100),
          odometer_miles: form.odometer ? Number(form.odometer) : null,
          incurred_at: form.date ? new Date(form.date).toISOString() : null,
        },
      });
      setForm({ vehicle_id: "", category: "repair", description: "", amount: "", odometer: "", date: "" });
      setAddOpen(false);
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Failed to add expense");
    } finally {
      setBusy(false);
    }
  }

  if (error && data === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your expenses.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const catEntries = data ? Object.entries(data.totals_by_category).sort((a, b) => b[1] - a[1]) : [];
  const biggest = catEntries[0];
  const maxCat = catEntries.length > 0 ? catEntries[0][1] : 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <select className="field !w-auto !py-2 text-sm" aria-label="Filter by truck" value={vehicleId}
                onChange={(e) => { setData(null); setVehicleId(e.target.value); }}>
          <option value="">All trucks</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
        </select>
        <select className="field !w-auto !py-2 text-sm" aria-label="Filter by category" value={category}
                onChange={(e) => { setData(null); setCategory(e.target.value); }}>
          <option value="">All categories</option>
          {Object.entries(EXPENSE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <select className="field !w-auto !py-2 text-sm" aria-label="Window in months" value={months}
                onChange={(e) => { setData(null); setMonths(e.target.value); }}>
          <option value="3">Last 3 months</option>
          <option value="6">Last 6 months</option>
          <option value="12">Last 12 months</option>
        </select>
      </div>

      {data === null ? (
        <Loader />
      ) : (
        <>
          {/* Stat tiles */}
          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <div className="card p-5">
              <p className="text-sm font-medium text-steel">Total ({months} mo window)</p>
              <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">{fmtUsd(data.total_cents)}</p>
            </div>
            <div className="card p-5">
              <p className="text-sm font-medium text-steel">Biggest category</p>
              <p className="display mt-1.5 text-3xl font-bold leading-none">
                {biggest ? EXPENSE_LABELS[biggest[0]] ?? biggest[0] : "—"}
              </p>
              {biggest && <p className="mt-2 text-sm tabular-nums text-faint">{fmtUsd(biggest[1])}</p>}
            </div>
            <div className="card p-5">
              <p className="text-sm font-medium text-steel">Entries</p>
              <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">{data.items.length}</p>
            </div>
          </div>

          {/* Chart + category bars */}
          <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_320px]">
            <section className="card p-5">
              <h3 className="text-lg font-bold">Monthly spend</h3>
              <MonthlyChart monthly={data.monthly} />
            </section>

            <section className="card p-5">
              <h3 className="text-lg font-bold">By category</h3>
              {catEntries.length === 0 ? (
                <p className="mt-4 text-sm text-steel">No spend recorded in this window.</p>
              ) : (
                <ul className="mt-4 space-y-3.5">
                  {catEntries.map(([cat, cents]) => (
                    <li key={cat}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm text-ink">{EXPENSE_LABELS[cat] ?? cat}</span>
                        <span className="font-semibold tabular-nums">{fmtUsd(cents)}</span>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-mist">
                        <div
                          className="h-1.5 rounded-full bg-pine"
                          style={{ width: `${maxCat > 0 ? (cents / maxCat) * 100 : 0}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Monthly fleet cost: repairs + loans + leases */}
          {monthlyCosts && (monthlyCosts.financed_trucks > 0 || monthlyCosts.leased_trailers > 0) && (
            <section className="card mt-5 p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-lg font-bold">Monthly fleet cost</h3>
                <p className="text-sm text-steel">
                  {monthlyCosts.financed_trucks} financed truck{monthlyCosts.financed_trucks === 1 ? "" : "s"} ·{" "}
                  {monthlyCosts.leased_trailers} leased trailer{monthlyCosts.leased_trailers === 1 ? "" : "s"} ·{" "}
                  <Link href="/loans" className="font-semibold text-pine hover:underline">manage loans</Link>
                </p>
              </div>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-steel">
                      <th className="py-2 pr-3 font-medium">Month</th>
                      <th className="py-2 pr-3 text-right font-medium">Repairs</th>
                      <th className="py-2 pr-3 text-right font-medium">Truck loans</th>
                      <th className="py-2 pr-3 text-right font-medium">Trailer leases</th>
                      <th className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyCosts.months.map((m, i) => (
                      <tr key={m.month} className="border-b border-line/60">
                        <td className="py-2.5 pr-3">
                          {monthLabel(m.month)} {m.month.slice(0, 4)}
                          {i === monthlyCosts.months.length - 1 && (
                            <span className="ml-1 text-xs text-faint">(so far)</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{fmtUsd(m.repairs_cents)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{fmtUsd(m.loans_cents)}</td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">{fmtUsd(m.leases_cents)}</td>
                        <td className="py-2.5 text-right font-bold tabular-nums">{fmtUsd(m.total_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-xs text-faint">
                Loan and lease columns are the current monthly commitments applied to each month shown —
                payment history isn&apos;t tracked yet.
              </p>
            </section>
          )}

          {/* Ledger */}
          <section className="card mt-5 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold">Entries</h3>
                <p className="mt-0.5 text-sm text-steel">
                  Completed marketplace repairs land here automatically.
                </p>
              </div>
              <button className="btn !py-2 text-sm" onClick={() => setAddOpen(!addOpen)}>
                {addOpen ? "Close" : "+ Add expense"}
              </button>
            </div>

            {addOpen && (
              <form onSubmit={addExpense}
                    className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="xp-truck">Truck *</label>
                  <select id="xp-truck" required className="field mt-1" value={form.vehicle_id}
                          onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
                    <option value="">Choose a truck…</option>
                    {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="xp-cat">Category</label>
                  <select id="xp-cat" className="field mt-1" value={form.category}
                          onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {Object.entries(EXPENSE_LABELS).map(([val, label]) => (
                      <option key={val} value={val}>{label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="xp-amt">Amount ($) *</label>
                  <input id="xp-amt" required className="field mt-1" inputMode="decimal" placeholder="450.00"
                         value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-steel" htmlFor="xp-desc">Description *</label>
                  <input id="xp-desc" required className="field mt-1" placeholder="What was it? (receipt line)"
                         value={form.description}
                         onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="xp-odo">Odometer (mi)</label>
                  <input id="xp-odo" className="field mt-1" inputMode="numeric" value={form.odometer}
                         onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="xp-date">Date</label>
                  <input id="xp-date" type="date" className="field mt-1" value={form.date}
                         onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </div>
                <div className="sm:col-span-3">
                  <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add expense"}</button>
                </div>
              </form>
            )}

            {actionErr && <p className="mt-3 text-sm font-medium text-danger">{actionErr}</p>}

            {data.items.length === 0 && !addOpen ? (
              <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
                No expenses match these filters.
              </p>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-steel">
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 pr-3 font-medium">Unit</th>
                      <th className="py-2 pr-3 font-medium">Category</th>
                      <th className="py-2 pr-3 font-medium">Description</th>
                      <th className="py-2 pr-3 font-medium">Odometer</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((e) => (
                      <tr key={e.id} className="border-b border-line/60 transition-colors hover:bg-mist/60">
                        <td className="py-2.5 pr-3 text-steel">{new Date(e.incurred_at).toLocaleDateString()}</td>
                        <td className="py-2.5 pr-3">
                          <Link href={`/fleet/${e.vehicle_id}`}
                                className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel hover:text-ink">
                            #{e.unit_number}
                          </Link>
                        </td>
                        <td className="py-2.5 pr-3">
                          <span className="rounded-full bg-mist px-2 py-0.5 text-xs font-medium">
                            {EXPENSE_LABELS[e.category] ?? e.category}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3">
                          {e.description}
                          {e.booking_id && (
                            <Link href={`/bookings/${e.booking_id}`}
                                  className="ml-1.5 text-xs font-medium text-pine hover:underline">
                              booking
                            </Link>
                          )}
                        </td>
                        <td className="py-2.5 pr-3 text-steel">
                          {e.odometer_miles != null ? `${Math.round(e.odometer_miles).toLocaleString()} mi` : "—"}
                        </td>
                        <td className="py-2.5 text-right font-semibold tabular-nums">{fmtUsd(e.amount_cents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={5} className="py-2.5 pr-3 font-semibold text-steel">
                        {data.items.length} entr{data.items.length === 1 ? "y" : "ies"}
                      </td>
                      <td className="py-2.5 text-right font-bold tabular-nums">{fmtUsd(data.total_cents)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function ExpensesPage() {
  return (
    <AppShell title="Expenses">
      <ExpensesInner />
    </AppShell>
  );
}
