"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd } from "@/lib/types";

/* Contract for /api/fleet/loans. */
export interface LoanRow {
  vehicle_id: string;
  unit_number: string;
  truck: string;
  lender: string;
  apr: number;
  term_months: number;
  payment_cents: number;
  paid_count: number;
  next_due: string | null;
  next_payment_cents: number | null;
  remaining_cents: number;
  payoff_date: string;
}

interface LoansResponse {
  loans: LoanRow[];
  totals: { balance_cents: number; monthly_cents: number };
  unfinanced_units: { vehicle_id: string; unit_number: string }[];
}

function LoansInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<LoansResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addUnit, setAddUnit] = useState("");

  const load = useCallback(() => {
    setError(null);
    api<LoansResponse>("/api/fleet/loans")
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (error && data === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your loans.</p>
          <p className="mt-1 text-sm text-steel">({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (data === null) return <div className="mx-auto max-w-6xl px-4 py-6"><Loader /></div>;

  const nextLoan = data.loans
    .filter((l) => l.next_due)
    .sort((a, b) => (a.next_due! < b.next_due! ? -1 : 1))[0];

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-steel">
          Every financed truck in one place. Open a loan to see the full payment schedule.
        </p>
        {data.unfinanced_units.length > 0 && (
          <div className="flex items-center gap-2">
            <select className="field !w-auto !py-2 text-sm" aria-label="Truck to add a loan for"
                    value={addUnit} onChange={(e) => setAddUnit(e.target.value)}>
              <option value="">Add a loan for…</option>
              {data.unfinanced_units.map((u) => (
                <option key={u.vehicle_id} value={u.vehicle_id}>#{u.unit_number}</option>
              ))}
            </select>
            <button className="btn !py-2 text-sm" disabled={!addUnit}
                    onClick={() => router.push(`/loans/${addUnit}?edit=1`)}>
              Add loan
            </button>
          </div>
        )}
      </div>

      {/* KPI tiles */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card p-5">
          <p className="text-sm font-medium text-steel">Balance left</p>
          <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">
            {fmtUsd(data.totals.balance_cents)}
          </p>
          <p className="mt-2 text-sm text-faint">{data.loans.length} truck{data.loans.length === 1 ? "" : "s"} financed</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-steel">Monthly payments</p>
          <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">
            {fmtUsd(data.totals.monthly_cents)}
          </p>
          <p className="mt-2 text-sm text-faint">all lenders</p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-steel">Next payment</p>
          <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">
            {nextLoan?.next_due ? new Date(nextLoan.next_due).toLocaleDateString() : "—"}
          </p>
          <p className="mt-2 text-sm text-faint">
            {nextLoan?.next_payment_cents != null ? `${fmtUsd(nextLoan.next_payment_cents)} · #${nextLoan.unit_number}` : ""}
          </p>
        </div>
        <div className="card p-5">
          <p className="text-sm font-medium text-steel">Owned outright</p>
          <p className="display mt-1.5 text-3xl font-bold tabular-nums leading-none">
            {data.unfinanced_units.length}
          </p>
          <p className="mt-2 truncate text-sm text-faint">
            {data.unfinanced_units.map((u) => `#${u.unit_number}`).join(", ") || "every truck is financed"}
          </p>
        </div>
      </div>

      {/* Loans table */}
      <section className="card mt-5 p-5">
        <h3 className="text-lg font-bold">Truck loans</h3>
        {data.loans.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-8 text-center text-sm text-steel">
            No loans yet. Pick a truck above and add its financing to see the payment schedule,
            balance and payoff date.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-steel">
                  <th className="py-2 pr-3 font-medium">Truck</th>
                  <th className="py-2 pr-3 font-medium">Lender</th>
                  <th className="py-2 pr-3 text-right font-medium">APR</th>
                  <th className="py-2 pr-3 text-right font-medium">Monthly</th>
                  <th className="py-2 pr-3 font-medium">Paid</th>
                  <th className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th className="py-2 font-medium">Payoff</th>
                </tr>
              </thead>
              <tbody>
                {data.loans.map((l) => (
                  <tr key={l.vehicle_id}
                      className="cursor-pointer border-b border-line/60 transition-colors hover:bg-mist/60"
                      onClick={() => router.push(`/loans/${l.vehicle_id}`)}>
                    <td className="py-2.5 pr-3">
                      <span className="font-semibold text-pine">#{l.unit_number}</span>
                      {l.truck && <span className="ml-1.5 text-xs text-faint">{l.truck}</span>}
                    </td>
                    <td className="py-2.5 pr-3">{l.lender}</td>
                    <td className="py-2.5 pr-3 text-right tabular-nums">{l.apr}%</td>
                    <td className="py-2.5 pr-3 text-right font-semibold tabular-nums">{fmtUsd(l.payment_cents)}</td>
                    <td className="py-2.5 pr-3" style={{ minWidth: 140 }}>
                      <span className="text-xs text-steel">{l.paid_count} of {l.term_months}</span>
                      <div className="mt-1 h-1.5 rounded-full bg-mist">
                        <div className="h-1.5 rounded-full bg-pine"
                             style={{ width: `${Math.min(100, (l.paid_count / l.term_months) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right font-bold tabular-nums">{fmtUsd(l.remaining_cents)}</td>
                    <td className="py-2.5 tabular-nums">{new Date(l.payoff_date).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-faint">
          Payments count as made once their due date passes — bank matching isn&apos;t connected yet.
        </p>
      </section>

      <p className="mt-4 text-sm text-steel">
        Monthly loan payments also show on the <Link href="/expenses" className="font-semibold text-pine hover:underline">Expenses</Link> page,
        next to repairs and trailer leases.
      </p>
    </div>
  );
}

export default function LoansPage() {
  return (
    <AppShell title="Loans">
      <LoansInner />
    </AppShell>
  );
}
