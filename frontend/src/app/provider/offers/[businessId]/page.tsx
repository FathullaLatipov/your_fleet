"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd, type BusinessDetail, type Offer } from "@/lib/types";

export default function ProviderOffersPage() {
  const { businessId } = useParams<{ businessId: string }>();
  const { user, loading } = useAuth();
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [title, setTitle] = useState("");
  const [offerType, setOfferType] = useState("fixed_amount");
  const [standard, setStandard] = useState("");
  const [marketplace, setMarketplace] = useState("");
  const [percent, setPercent] = useState("");
  const [conditions, setConditions] = useState("");
  const [expires, setExpires] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<BusinessDetail>(`/api/businesses/${businessId}`).then(setBusiness).catch(() => {});
    api<Offer[]>(`/api/offers/business/${businessId}`).then(setOffers).catch(() => {});
  }, [businessId]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading) return <p className="mx-auto max-w-2xl px-4 py-10 text-steel">Loading…</p>;
  if (!user || user.role !== "provider") {
    return <p className="mx-auto max-w-2xl px-4 py-10 text-steel">This page is for shop accounts.</p>;
  }

  const dollars = (s: string) => (s ? Math.round(parseFloat(s) * 100) : null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/offers", {
        method: "POST",
        body: {
          business_id: businessId,
          title,
          offer_type: offerType,
          standard_price_cents: dollars(standard),
          marketplace_price_cents: offerType === "fixed_amount" || offerType === "negotiated_rate" ? dollars(marketplace) : null,
          discount_percent: offerType === "percentage" || offerType === "quote_based" ? (percent ? parseFloat(percent) : null) : null,
          conditions: conditions || null,
          expires_at: expires ? new Date(expires).toISOString() : null,
        },
      });
      setMsg({ kind: "ok", text: "Offer submitted for admin approval." });
      setTitle(""); setStandard(""); setMarketplace(""); setPercent(""); setConditions(""); setExpires("");
      load();
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Submit failed" });
    } finally {
      setBusy(false);
    }
  }

  async function suspend(offerId: string) {
    await api(`/api/offers/${offerId}/suspend`, { method: "POST" }).catch(() => {});
    load();
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Marketplace offers</h1>
      {business && <p className="mt-1 text-steel">{business.name}</p>}
      {business && business.partner_status !== "active" && (
        <p className="mt-3 rounded border border-line bg-mist p-3 text-sm text-steel">
          Offers only appear publicly once your shop is an <strong>active marketplace partner</strong>.
          Submit offers now; they go live after partner activation and admin approval.
        </p>
      )}

      <section className="mt-6 rounded border border-line bg-panel p-5">
        <h2 className="font-bold">New offer</h2>
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="of-title">Title</label>
            <input id="of-title" required minLength={3} className="field mt-1"
                   placeholder="e.g. PM service — full chassis lube & inspection"
                   value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="of-type">Offer type</label>
            <select id="of-type" className="field mt-1" value={offerType} onChange={(e) => setOfferType(e.target.value)}>
              <option value="fixed_amount">Fixed marketplace price</option>
              <option value="percentage">Percentage off</option>
              <option value="negotiated_rate">Negotiated rate (e.g. hourly labor)</option>
              <option value="quote_based">Discount applied to quote</option>
            </select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {(offerType === "fixed_amount" || offerType === "negotiated_rate") && (
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="of-mkt">Marketplace price (USD)</label>
                <input id="of-mkt" required className="field mt-1" inputMode="decimal"
                       value={marketplace} onChange={(e) => setMarketplace(e.target.value)} />
              </div>
            )}
            {(offerType === "percentage" || offerType === "quote_based") && (
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="of-pct">Discount %</label>
                <input id="of-pct" required={offerType === "percentage"} className="field mt-1" inputMode="decimal"
                       value={percent} onChange={(e) => setPercent(e.target.value)} />
              </div>
            )}
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="of-std">Your documented regular price (optional)</label>
              <input id="of-std" className="field mt-1" inputMode="decimal"
                     value={standard} onChange={(e) => setStandard(e.target.value)} />
              <p className="mt-0.5 text-xs text-faint">
                Savings are shown to drivers only when this is documented. Don&apos;t inflate it —
                offers are audited.
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="of-exp">Expires (optional)</label>
              <input id="of-exp" type="date" className="field mt-1" value={expires} onChange={(e) => setExpires(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="of-cond">Conditions & exclusions</label>
            <textarea id="of-cond" className="field mt-1" maxLength={5000}
                      placeholder="e.g. Class 8 tractors only. Parts and shop supplies extra. Not valid with other discounts."
                      value={conditions} onChange={(e) => setConditions(e.target.value)} />
          </div>
          {msg && <p className={`text-sm font-medium ${msg.kind === "ok" ? "text-pine" : "text-danger"}`}>{msg.text}</p>}
          <button className="btn" disabled={busy}>{busy ? "Submitting…" : "Submit for approval"}</button>
        </form>
      </section>

      <section className="mt-6">
        <h2 className="font-bold">Existing offers</h2>
        {offers.length === 0 ? (
          <p className="mt-2 text-[15px] text-steel">None yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded border border-line bg-panel">
            {offers.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div>
                  <p className="font-semibold">{o.title}</p>
                  <p className="text-sm text-steel">
                    {o.marketplace_price_cents != null && `${fmtUsd(o.marketplace_price_cents)} `}
                    {o.discount_percent != null && `${o.discount_percent}% off `}
                    {o.standard_price_cents != null && `(regular ${fmtUsd(o.standard_price_cents)})`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={o.status ?? ""} />
                  {(o.status === "approved" || o.status === "pending_approval") && (
                    <button className="btn-quiet !py-1" onClick={() => suspend(o.id)}>Suspend</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Link href="/provider" className="btn-quiet mt-6">Back to dashboard</Link>
    </div>
  );
}
