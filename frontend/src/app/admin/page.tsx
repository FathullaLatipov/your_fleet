"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd, type Booking, type Claim, type Offer, type Review } from "@/lib/types";

interface Stats {
  businesses: number; published: number; claimed: number; partners: number;
  pending_claims: number; pending_offers: number; pending_duplicates: number;
  bookings_total: number; bookings_disputed: number; users: number;
}
interface DupCandidate {
  id: string; business_a_id: string; business_b_id: string; reason: string; status: string;
}
interface ImportBatchRow {
  id: string; source_file: string; dry_run: boolean; started_at: string;
  finished_at: string | null; report: Record<string, unknown> | null;
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [dups, setDups] = useState<DupCandidate[]>([]);
  const [disputes, setDisputes] = useState<Booking[]>([]);
  const [reported, setReported] = useState<Review[]>([]);
  const [imports, setImports] = useState<ImportBatchRow[]>([]);
  const [commission, setCommission] = useState<{ model: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Stats>("/api/admin/stats").then(setStats).catch((e) => setError(e.message));
    api<Claim[]>("/api/admin/claims").then(setClaims).catch(() => {});
    api<Offer[]>("/api/admin/offers/pending").then(setOffers).catch(() => {});
    api<DupCandidate[]>("/api/admin/duplicates").then(setDups).catch(() => {});
    api<Booking[]>("/api/admin/bookings/disputed").then(setDisputes).catch(() => {});
    api<Review[]>("/api/admin/reviews/reported").then(setReported).catch(() => {});
    api<ImportBatchRow[]>("/api/admin/imports").then(setImports).catch(() => {});
    api<{ model: string; percent: number }>("/api/admin/settings/commission").then(setCommission).catch(() => {});
  }, []);

  useEffect(() => {
    if (user?.role === "admin") load();
  }, [user, load]);

  if (loading) return <p className="mx-auto max-w-6xl px-4 py-10 text-steel">Loading…</p>;
  if (!user || user.role !== "admin") {
    return <p className="mx-auto max-w-6xl px-4 py-16 text-steel">Admin access required.</p>;
  }

  async function decideClaim(id: string, approve: boolean, verify: boolean) {
    await api(`/api/admin/claims/${id}/decide`, {
      method: "POST", body: { approve, mark_identity_verified: verify },
    }).catch((e) => setError(e.message));
    load();
  }
  async function decideOffer(id: string, approve: boolean) {
    await api(`/api/admin/offers/${id}/decide`, { method: "POST", body: { approve } }).catch((e) => setError(e.message));
    load();
  }
  async function decideDup(id: string, action: "dismiss" | "merge") {
    await api(`/api/admin/duplicates/${id}/decide`, { method: "POST", body: { action } }).catch((e) => setError(e.message));
    load();
  }
  async function moderate(id: string, action: "restore" | "remove") {
    await api(`/api/admin/reviews/${id}/moderate`, { method: "POST", body: { action } }).catch((e) => setError(e.message));
    load();
  }
  async function saveCommission(e: React.FormEvent) {
    e.preventDefault();
    if (!commission) return;
    await api("/api/admin/settings/commission", { method: "PUT", body: commission }).catch((e2) => setError(e2.message));
    load();
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-2xl font-bold">Platform admin</h1>
      {error && <p className="mt-2 text-sm font-medium text-danger">{error}</p>}

      {stats && (
        <div className="mt-5 grid gap-px overflow-hidden rounded-xl border border-line/70 bg-line shadow-(--shadow-card) grid-cols-2 sm:grid-cols-5">
          {([
            ["Listings", stats.businesses], ["Published", stats.published],
            ["Claimed", stats.claimed], ["Partners", stats.partners], ["Users", stats.users],
            ["Pending claims", stats.pending_claims], ["Pending offers", stats.pending_offers],
            ["Duplicate pairs", stats.pending_duplicates],
            ["Bookings", stats.bookings_total], ["Disputes", stats.bookings_disputed],
          ] as const).map(([label, value]) => (
            <div key={label} className="bg-panel p-3">
              <p className="text-xs text-steel">{label}</p>
              <p className="display text-xl font-bold">{value.toLocaleString()}</p>
            </div>
          ))}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="text-lg font-bold">Claim verification queue</h2>
          {claims.length === 0 ? <p className="mt-2 text-sm text-steel">Queue is empty.</p> : (
            <ul className="mt-2 space-y-2">
              {claims.map((c) => (
                <li key={c.id} className="card p-4">
                  <p className="text-sm">
                    <Link href={`/business/${c.business_id}`} className="font-semibold text-pine hover:underline">
                      View business
                    </Link>{" "}
                    · claimed {new Date(c.created_at).toLocaleDateString()}
                  </p>
                  <p className="mt-1 rounded bg-mist p-2 text-sm text-steel">{c.evidence}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button className="btn !py-1" onClick={() => decideClaim(c.id, true, true)}>
                      Approve + verify identity
                    </button>
                    <button className="btn-quiet !py-1" onClick={() => decideClaim(c.id, true, false)}>
                      Approve only
                    </button>
                    <button className="btn-danger !py-1" onClick={() => decideClaim(c.id, false, false)}>
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">Offer approvals</h2>
          {offers.length === 0 ? <p className="mt-2 text-sm text-steel">Queue is empty.</p> : (
            <ul className="mt-2 space-y-2">
              {offers.map((o) => (
                <li key={o.id} className="card p-4">
                  <p className="font-semibold">{o.title}</p>
                  <p className="text-sm text-steel">
                    {o.offer_type} · {o.marketplace_price_cents != null && `marketplace ${fmtUsd(o.marketplace_price_cents)} `}
                    {o.standard_price_cents != null && `· regular ${fmtUsd(o.standard_price_cents)} `}
                    {o.discount_percent != null && `· ${o.discount_percent}% off`}
                  </p>
                  {o.conditions && <p className="mt-1 text-sm text-faint">{o.conditions}</p>}
                  <div className="mt-2 flex gap-2">
                    <button className="btn !py-1" onClick={() => decideOffer(o.id, true)}>Approve</button>
                    <button className="btn-danger !py-1" onClick={() => decideOffer(o.id, false)}>Reject</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">Duplicate candidates</h2>
          <p className="mt-1 text-xs text-faint">
            Merge keeps the first listing and unpublishes the second; nothing is deleted.
          </p>
          {dups.length === 0 ? <p className="mt-2 text-sm text-steel">Queue is empty.</p> : (
            <ul className="mt-2 divide-y divide-line card">
              {dups.slice(0, 20).map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                  <span>
                    <Link href={`/business/${d.business_a_id}`} className="font-medium text-pine hover:underline">A</Link>
                    {" ↔ "}
                    <Link href={`/business/${d.business_b_id}`} className="font-medium text-pine hover:underline">B</Link>
                    <span className="ml-2 text-steel">{d.reason}</span>
                  </span>
                  <span className="flex gap-2">
                    <button className="btn-quiet !py-0.5 !px-2 text-xs" onClick={() => decideDup(d.id, "dismiss")}>
                      Not duplicates
                    </button>
                    <button className="btn !py-0.5 !px-2 text-xs" onClick={() => decideDup(d.id, "merge")}>
                      Merge (keep A)
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">Disputes & moderation</h2>
          {disputes.length === 0 && reported.length === 0 ? (
            <p className="mt-2 text-sm text-steel">No open disputes or reported reviews.</p>
          ) : (
            <>
              {disputes.map((b) => (
                <div key={b.id} className="mt-2 flex items-center justify-between card px-4 py-2.5 text-sm">
                  <Link href={`/bookings/${b.id}`} className="font-medium text-pine hover:underline">
                    Disputed booking — {fmtUsd(b.final_price_cents ?? b.quoted_price_cents)}
                  </Link>
                  <StatusBadge status={b.status} />
                </div>
              ))}
              {reported.map((r) => (
                <div key={r.id} className="mt-2 card px-4 py-2.5 text-sm">
                  <p><span className="font-semibold">{r.rating}★ review reported.</span> {r.text}</p>
                  <div className="mt-1.5 flex gap-2">
                    <button className="btn-quiet !py-0.5 !px-2 text-xs" onClick={() => moderate(r.id, "restore")}>Restore</button>
                    <button className="btn-danger !py-0.5 !px-2 text-xs" onClick={() => moderate(r.id, "remove")}>Remove</button>
                  </div>
                </div>
              ))}
            </>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">Commission settings</h2>
          {commission && (
            <form onSubmit={saveCommission} className="mt-2 flex flex-wrap items-end gap-3 card p-4">
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="cm-model">Model</label>
                <select id="cm-model" className="field mt-1 !w-44" value={commission.model}
                        onChange={(e) => setCommission({ ...commission, model: e.target.value })}>
                  <option value="commission">% commission</option>
                  <option value="lead_fee">Lead fee</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="cm-pct">Percent</label>
                <input id="cm-pct" className="field mt-1 !w-24" inputMode="decimal" value={commission.percent}
                       onChange={(e) => setCommission({ ...commission, percent: parseFloat(e.target.value) || 0 })} />
              </div>
              <button className="btn">Save</button>
              <p className="w-full text-xs text-faint">
                Applies to bookings confirmed after the change; existing bookings keep the terms
                snapshotted at confirmation.
              </p>
            </form>
          )}
        </section>

        <section>
          <h2 className="text-lg font-bold">Import history</h2>
          {imports.length === 0 ? <p className="mt-2 text-sm text-steel">No imports recorded.</p> : (
            <ul className="mt-2 divide-y divide-line card text-sm">
              {imports.map((b) => {
                const r = (b.report ?? {}) as Record<string, number>;
                return (
                  <li key={b.id} className="px-4 py-2.5">
                    <p className="font-medium">
                      {String(b.source_file).split(/[\\/]/).pop()}
                      {b.dry_run && <span className="ml-2 rounded bg-mist px-1.5 text-xs text-steel">dry run</span>}
                    </p>
                    <p className="text-steel">
                      {new Date(b.started_at).toLocaleString()} — created {r.created ?? 0},
                      skipped {r.skipped ?? 0}, duplicates {r.duplicates ?? 0}, invalid {r.invalid ?? 0}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
