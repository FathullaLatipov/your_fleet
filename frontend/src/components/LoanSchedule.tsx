"use client";

import { useEffect, useRef } from "react";

import { fmtUsd } from "@/lib/types";

/* Contract for GET /api/fleet/vehicles/{id}/loan. */
export interface ScheduleRow {
  i: number;
  due: string;
  payment_cents: number;
  principal_cents: number;
  interest_cents: number;
  balance_cents: number;
  paid: boolean;
}

export interface LoanDetail {
  vehicle_id: string;
  unit_number: string;
  truck: string;
  lender: string;
  purchase_price_cents: number | null;
  down_payment_cents: number | null;
  principal_cents: number;
  apr: number;
  term_months: number;
  start_date: string;
  note: string | null;
  payment_cents: number;
  paid_count: number;
  interest_total_cents: number;
  next_due: string | null;
  next_payment_cents: number | null;
  remaining_cents: number;
  payoff_date: string;
  schedule: ScheduleRow[];
}

export const fmtDate = (s: string) => new Date(s).toLocaleDateString();

export function loanTermsLine(loan: LoanDetail): string {
  return [
    loan.purchase_price_cents != null && `Purchase ${fmtUsd(loan.purchase_price_cents)}`,
    loan.down_payment_cents != null && `down ${fmtUsd(loan.down_payment_cents)}`,
    `${loan.apr}% APR`,
    `${loan.term_months} months from ${fmtDate(loan.start_date)}`,
  ].filter(Boolean).join(" · ");
}

/* Monthly payment / next due / balance / payoff tiles plus the progress bar. */
export function LoanSummary({ loan }: { loan: LoanDetail }) {
  const pct = Math.min(100, Math.round((loan.paid_count / loan.term_months) * 100));
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Monthly payment", fmtUsd(loan.payment_cents)],
          ["Next due", loan.next_due ? fmtDate(loan.next_due) : "paid off"],
          ["Balance left", fmtUsd(loan.remaining_cents)],
          ["Payoff", fmtDate(loan.payoff_date)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-mist p-3.5">
            <p className="text-xs text-steel">{label}</p>
            <p className="text-xl font-bold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4">
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <span>{loan.paid_count} of {loan.term_months} payments made</span>
          <span className="text-steel">{pct}% · total interest {fmtUsd(loan.interest_total_cents)}</span>
        </div>
        <div className="mt-1.5 h-2 rounded-full bg-mist">
          <div className="h-2 rounded-full bg-pine" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </>
  );
}

/* Full amortization table; scrolls its own box (not the page) to the next payment. */
export function LoanScheduleTable({ loan, maxHeight = 480 }: { loan: LoanDetail; maxHeight?: number }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLTableRowElement | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    const row = nextRef.current;
    if (box && row) box.scrollTop = row.offsetTop - box.clientHeight / 2;
  }, [loan]);

  return (
    <div ref={boxRef} className="overflow-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-mist">
          <tr className="text-left text-steel">
            <th className="py-2.5 pl-5 pr-3 font-medium">#</th>
            <th className="py-2.5 pr-3 font-medium">Due date</th>
            <th className="py-2.5 pr-3 text-right font-medium">Payment</th>
            <th className="py-2.5 pr-3 text-right font-medium">Principal</th>
            <th className="py-2.5 pr-3 text-right font-medium">Interest</th>
            <th className="py-2.5 pr-3 text-right font-medium">Balance</th>
            <th className="py-2.5 pr-5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {loan.schedule.map((r) => {
            const isNext = loan.next_due === r.due && !r.paid;
            return (
              <tr key={r.i} ref={isNext ? nextRef : undefined}
                  className={`border-t border-line/60 ${r.paid ? "text-faint" : ""} ${isNext ? "bg-amber-wash" : ""}`}>
                <td className="py-2 pl-5 pr-3 tabular-nums">{r.i}</td>
                <td className="py-2 pr-3 tabular-nums">{fmtDate(r.due)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(r.payment_cents)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(r.principal_cents)}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(r.interest_cents)}</td>
                <td className="py-2 pr-3 text-right font-semibold tabular-nums">{fmtUsd(r.balance_cents)}</td>
                <td className="py-2 pr-5">
                  {r.paid ? (
                    <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-medium">paid</span>
                  ) : isNext ? (
                    <span className="rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink ring-1 ring-amber/40">due next</span>
                  ) : (
                    <span className="text-xs text-faint">upcoming</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export const LOAN_FOOTNOTE =
  "Payments count as made once their due date passes — bank matching isn't connected yet. " +
  "The last payment absorbs rounding so the balance ends at exactly $0.";
