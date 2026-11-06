"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import {
  LOAN_FOOTNOTE,
  LoanScheduleTable,
  LoanSummary,
  fmtDate,
  type LoanDetail,
} from "@/components/LoanSchedule";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd } from "@/lib/types";

interface VehicleOpt { id: string; unit_number: string }

function centsToUsdStr(c: number | null): string {
  return c == null ? "" : (c / 100).toFixed(c % 100 === 0 ? 0 : 2);
}
function usdToCents(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function LoanDetailInner() {
  const { user } = useAuth();
  const params = useParams<{ vehicleId: string }>();
  const qs = useSearchParams();
  const router = useRouter();
  const vehicleId = params.vehicleId;

  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [noLoan, setNoLoan] = useState(false);
  const [unit, setUnit] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(qs.get("edit") === "1");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [form, setForm] = useState({
    lender: "", price: "", down: "", principal: "", apr: "", term: "60", start: "", note: "",
  });

  const load = useCallback(() => {
    setError(null);
    api<LoanDetail>(`/api/fleet/vehicles/${vehicleId}/loan`)
      .then((l) => {
        setLoan(l);
        setNoLoan(false);
        setForm({
          lender: l.lender,
          price: centsToUsdStr(l.purchase_price_cents),
          down: centsToUsdStr(l.down_payment_cents),
          principal: centsToUsdStr(l.principal_cents),
          apr: String(l.apr),
          term: String(l.term_months),
          start: l.start_date,
          note: l.note ?? "",
        });
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) {
          setNoLoan(true);
          setEditing(true);
        } else {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      });
  }, [vehicleId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    api<VehicleOpt[]>("/api/fleet/vehicles")
      .then((vs) => setUnit(vs.find((v) => v.id === vehicleId)?.unit_number ?? ""))
      .catch(() => {});
  }, [user, vehicleId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const principal = usdToCents(form.principal);
    if (!principal || principal <= 0) { setFormErr("Enter the financed amount."); return; }
    const apr = Number(form.apr);
    if (!Number.isFinite(apr) || apr < 0 || apr > 100) { setFormErr("APR must be 0–100."); return; }
    const term = Number(form.term);
    if (!Number.isInteger(term) || term < 1) { setFormErr("Enter the term in months."); return; }
    if (!form.start) { setFormErr("Pick the loan start date."); return; }
    setBusy(true);
    setFormErr(null);
    try {
      const updated = await api<LoanDetail>(`/api/fleet/vehicles/${vehicleId}/loan`, {
        method: "PUT",
        body: {
          lender: form.lender.trim(),
          purchase_price_cents: usdToCents(form.price),
          down_payment_cents: usdToCents(form.down),
          principal_cents: principal,
          apr,
          term_months: term,
          start_date: form.start,
          note: form.note.trim() || null,
        },
      });
      setLoan(updated);
      setNoLoan(false);
      setEditing(false);
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : "Couldn't save the loan");
    } finally {
      setBusy(false);
    }
  }

  async function removeLoan() {
    if (!window.confirm("Remove this loan and its schedule? The truck stays.")) return;
    setBusy(true);
    try {
      await api(`/api/fleet/vehicles/${vehicleId}/loan`, { method: "DELETE" });
      router.push("/loans");
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : "Couldn't remove the loan");
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load this loan.</p>
          <p className="mt-1 text-sm text-steel">({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (loan === null && !noLoan) return <div className="mx-auto max-w-5xl px-4 py-6"><Loader /></div>;

  const editForm = (
    <form onSubmit={save}
          className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
      <div className="sm:col-span-2">
        <label className="text-sm font-medium text-steel" htmlFor="ln-lender">Lender *</label>
        <input id="ln-lender" required className="field mt-1" placeholder="Crossroads Equipment Credit"
               value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor="ln-start">Start date *</label>
        <input id="ln-start" type="date" required className="field mt-1" value={form.start.slice(0, 10)}
               onChange={(e) => setForm({ ...form, start: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor="ln-price">Purchase price, $</label>
        <input id="ln-price" className="field mt-1" inputMode="decimal" placeholder="188,000"
               value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor="ln-down">Down payment, $</label>
        <input id="ln-down" className="field mt-1" inputMode="decimal" placeholder="20,000"
               value={form.down} onChange={(e) => setForm({ ...form, down: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor="ln-principal">Financed amount, $ *</label>
        <input id="ln-principal" required className="field mt-1" inputMode="decimal" placeholder="168,000"
               value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor="ln-apr">APR, % *</label>
        <input id="ln-apr" required className="field mt-1" inputMode="decimal" placeholder="8.9"
               value={form.apr} onChange={(e) => setForm({ ...form, apr: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor="ln-term">Term, months *</label>
        <input id="ln-term" required className="field mt-1" inputMode="numeric" placeholder="60"
               value={form.term} onChange={(e) => setForm({ ...form, term: e.target.value })} />
      </div>
      <div className="sm:col-span-3">
        <label className="text-sm font-medium text-steel" htmlFor="ln-note">Note</label>
        <input id="ln-note" className="field mt-1" placeholder="Anything worth remembering about this loan"
               value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
      {formErr && <p className="text-sm font-medium text-danger sm:col-span-3">{formErr}</p>}
      <div className="flex gap-2 sm:col-span-3">
        <button className="btn" disabled={busy}>{busy ? "Saving…" : noLoan ? "Add loan" : "Save changes"}</button>
        {!noLoan && (
          <button type="button" className="btn-quiet" onClick={() => setEditing(false)}>Cancel</button>
        )}
      </div>
    </form>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href="/loans" className="text-sm font-medium text-steel hover:text-ink">← All loans</Link>

      <section className="card mt-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">
              {unit && <>Truck #{unit} · </>}{loan ? loan.lender : "Add financing"}
            </h2>
            {loan ? (
              <p className="mt-0.5 text-sm text-steel">
                {loan.purchase_price_cents != null && <>Purchase {fmtUsd(loan.purchase_price_cents)} · </>}
                {loan.down_payment_cents != null && <>down {fmtUsd(loan.down_payment_cents)} · </>}
                {loan.apr}% APR · {loan.term_months} months from {fmtDate(loan.start_date)}
              </p>
            ) : (
              <p className="mt-0.5 text-sm text-steel">
                Enter the loan terms — the payment schedule, balance and payoff date are computed from them.
              </p>
            )}
          </div>
          {loan && !editing && (
            <div className="flex gap-2">
              <button className="btn-quiet !py-2 text-sm" onClick={() => setEditing(true)}>Edit</button>
              <button className="btn-danger !py-2 text-sm" disabled={busy} onClick={() => void removeLoan()}>
                Remove
              </button>
            </div>
          )}
        </div>

        {editing && editForm}

        {loan && (
          <>
            <div className="mt-5"><LoanSummary loan={loan} /></div>
            {loan.note && <p className="mt-3 text-sm text-steel">{loan.note}</p>}
          </>
        )}
      </section>

      {loan && (
        <section className="card mt-4 p-0">
          <LoanScheduleTable loan={loan} />
          <p className="border-t border-line px-5 py-3 text-xs text-faint">{LOAN_FOOTNOTE}</p>
        </section>
      )}
    </div>
  );
}

export default function LoanDetailPage() {
  return (
    <AppShell title="Loan">
      <Suspense fallback={<Loader />}>
        <LoanDetailInner />
      </Suspense>
    </AppShell>
  );
}
