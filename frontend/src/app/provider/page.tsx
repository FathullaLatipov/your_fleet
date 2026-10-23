"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd, type Booking, type BusinessListItem, type Claim, type Offer } from "@/lib/types";

const OPEN = new Set(["requested", "quoted", "accepted", "confirmed", "in_progress", "disputed"]);

export default function ProviderDashboard() {
  const { user, loading } = useAuth();
  const [businesses, setBusinesses] = useState<BusinessListItem[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);

  useEffect(() => {
    if (!user) return;
    api<Claim[]>("/api/claims/mine").then(setClaims).catch(() => {});
    api<BusinessListItem[]>("/api/me/businesses").then(async (bs) => {
      setBusinesses(bs);
      const allBookings: Booking[] = [];
      const allOffers: Offer[] = [];
      for (const b of bs) {
        try {
          allBookings.push(...(await api<Booking[]>(`/api/bookings/business/${b.id}`)));
          allOffers.push(...(await api<Offer[]>(`/api/offers/business/${b.id}`)));
        } catch {
          /* skip */
        }
      }
      setBookings(allBookings);
      setOffers(allOffers);
    }).catch(() => {});
  }, [user]);

  if (loading) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>;
  if (!user || user.role !== "provider") {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="text-steel">This area is for repair shop accounts.</p>
        <Link href="/register?role=provider" className="btn mt-4">Create a shop account</Link>
      </div>
    );
  }

  const newLeads = bookings.filter((b) => b.status === "requested");
  const openJobs = bookings.filter((b) => OPEN.has(b.status) && b.status !== "requested");
  const completed = bookings.filter((b) => b.status === "completed");
  const revenue = completed.reduce((s, b) => s + (b.provider_payout_cents ?? b.final_price_cents ?? 0), 0);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">Shop dashboard</h1>

      {businesses.length === 0 && (
        <div className="mt-6 rounded border border-line bg-panel p-6">
          <h2 className="text-lg font-bold">Get your shop on YourFleet</h2>
          <p className="mt-1 max-w-[60ch] text-[15px] text-steel">
            Your shop is probably already in our directory. Find it and claim it to manage your
            listing, publish offers, and receive booking requests. Our team reviews every claim.
          </p>
          <div className="mt-4 flex gap-2">
            <Link href="/search" className="btn">Find my shop to claim it</Link>
          </div>
          {claims.length > 0 && (
            <ul className="mt-5 space-y-2 border-t border-line pt-4">
              {claims.map((c) => (
                <li key={c.id} className="flex items-center justify-between text-sm">
                  <span className="text-steel">Claim submitted {new Date(c.created_at).toLocaleDateString()}</span>
                  <StatusBadge status={c.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {businesses.length > 0 && (
        <>
          <div className="mt-6 grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-4">
            {[
              ["New leads", String(newLeads.length)],
              ["Open jobs", String(openJobs.length)],
              ["Completed jobs", String(completed.length)],
              ["Payout earned", fmtUsd(revenue)],
            ].map(([label, value]) => (
              <div key={label} className="bg-panel p-4">
                <p className="text-sm text-steel">{label}</p>
                <p className="display mt-1 text-2xl font-bold">{value}</p>
              </div>
            ))}
          </div>

          <section className="mt-8">
            <h2 className="text-lg font-bold">My listings</h2>
            <ul className="mt-2 divide-y divide-line rounded border border-line bg-panel">
              {businesses.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                  <div>
                    <Link href={`/business/${b.id}`} className="font-semibold hover:text-pine hover:underline">{b.name}</Link>
                    <p className="text-sm text-steel">
                      {b.city ? `${b.city}, ${b.state}` : b.state}
                      {b.is_verified ? " · Identity verified" : " · Not yet verified"}
                      {b.partner_status === "active" && " · Active partner"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Link href={`/provider/business/${b.id}`} className="btn-quiet !py-1.5">Edit listing</Link>
                    <Link href={`/provider/offers/${b.id}`} className="btn-quiet !py-1.5">Offers</Link>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-bold">New leads</h2>
            {newLeads.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">No new requests right now.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded border border-line bg-panel">
                {newLeads.map((b) => (
                  <li key={b.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Link href={`/bookings/${b.id}`} className="font-semibold hover:text-pine hover:underline">
                        {b.issue_description.slice(0, 90)}{b.issue_description.length > 90 ? "…" : ""}
                      </Link>
                      {b.urgency === "emergency" && (
                        <span className="rounded bg-danger-wash px-2 py-0.5 text-xs font-bold text-danger">EMERGENCY</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-sm text-faint">{new Date(b.created_at).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-bold">Jobs in progress</h2>
            {openJobs.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">No active jobs.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded border border-line bg-panel">
                {openJobs.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <Link href={`/bookings/${b.id}`} className="font-semibold hover:text-pine hover:underline">
                      {b.issue_description.slice(0, 70)}…
                    </Link>
                    <div className="flex items-center gap-3">
                      {b.quoted_price_cents != null && <span className="text-sm font-medium">{fmtUsd(b.quoted_price_cents)}</span>}
                      <StatusBadge status={b.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-8">
            <h2 className="text-lg font-bold">My offers</h2>
            {offers.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">
                No offers yet. Offers are negotiated marketplace prices that drivers see on your
                profile — they need admin approval and active partner status to go live.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded border border-line bg-panel">
                {offers.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="font-semibold">{o.title}</span>
                    <div className="flex items-center gap-3 text-sm">
                      {o.marketplace_price_cents != null && <span className="font-medium">{fmtUsd(o.marketplace_price_cents)}</span>}
                      {o.discount_percent != null && <span className="font-medium">{o.discount_percent}% off</span>}
                      <StatusBadge status={o.status ?? ""} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
