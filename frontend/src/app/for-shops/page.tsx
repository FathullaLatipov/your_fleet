"use client";

import Link from "next/link";
import { useState } from "react";

import { Reveal } from "@/components/Reveal";
import { api } from "@/lib/api";
import type { SearchResponse } from "@/lib/types";

const PERKS: [string, string][] = [
  ["Claiming is free", "Your listing already exists — drivers see it today. Claiming gives you the keys: hours, services, photos, prices."],
  ["Publish marketplace offers", "Set negotiated prices for the jobs you want. Offers put your bays in front of drivers broken down nearby — you only deal with real repair requests."],
  ["You stay in control", "Accept, quote or decline every request. Customers pay you directly; YourFleet never touches your money."],
];

export default function ForShopsPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      setResults(await api<SearchResponse>("/api/search", { params: { q: q.trim(), limit: 8 } }));
    } catch {
      setResults({ total: 0, items: [], resolved_location: null });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className="bg-charcoal bg-[radial-gradient(90rem_42rem_at_15%_-20%,#17523566,transparent)]">
        <div className="mx-auto max-w-6xl px-4 py-16 lg:py-20">
          <div className="hero-rise max-w-[62ch]">
            <p className="display text-sm font-semibold tracking-wide text-amber">
              For repair shops, tire services, towing & mobile mechanics
            </p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.05] text-white sm:text-5xl">
              Drivers are already looking at your shop.
            </h1>
            <p className="mt-5 text-lg text-white/75">
              YourFleet lists 2,800+ truck service businesses across the US — including, most
              likely, yours. Every day drivers and fleets search it for repairs near them.
              Claim your listing for free and turn those views into booked jobs.
            </p>
          </div>

          {/* Find-your-shop lookup */}
          <form onSubmit={lookup} className="hero-rise-2 mt-8 flex max-w-xl gap-2">
            <input
              className="field !border-white/15 !bg-white/95 !py-3"
              placeholder="Type your shop's name…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Find your shop"
            />
            <button className="btn !px-6 !py-3" disabled={busy}>
              {busy ? "Searching…" : "Find my shop"}
            </button>
          </form>

          {results && (
            <div className="mt-4 max-w-xl space-y-2">
              {results.items.length === 0 ? (
                <div className="rounded-xl bg-white/10 p-4 text-white/85 backdrop-blur">
                  Nothing with that name yet.{" "}
                  <Link href="/register?role=provider" className="font-semibold text-amber underline">
                    Create a shop account
                  </Link>{" "}
                  and register your business from scratch.
                </div>
              ) : (
                results.items.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/95 p-4 shadow-(--shadow-card)">
                    <div className="min-w-0">
                      <p className="font-semibold">{b.name}</p>
                      <p className="text-sm text-steel">
                        {b.city ? `${b.city}, ${b.state}` : b.state}
                        {b.google_rating != null && <> · {b.google_rating.toFixed(1)}★ on Google</>}
                        {b.views_count > 0 && (
                          <> · <span className="font-semibold text-pine">{b.views_count.toLocaleString()} views on YourFleet</span></>
                        )}
                      </p>
                    </div>
                    {b.is_claimed ? (
                      <span className="rounded-full bg-mist px-3 py-1 text-sm font-medium text-steel">Already claimed</span>
                    ) : (
                      <Link href={`/provider/claim?business=${b.id}`} className="btn !py-2 text-sm">
                        This is my shop — claim it
                      </Link>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-14">
        <div className="grid gap-4 sm:grid-cols-3">
          {PERKS.map(([title, body], i) => (
            <Reveal key={title} delay={i * 110}>
              <div className="card h-full p-6">
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-[15px] leading-relaxed text-steel">{body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={150}>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-pine-dark p-6">
            <div className="max-w-[55ch]">
              <h2 className="text-xl font-bold text-white">How claiming works</h2>
              <p className="mt-1.5 text-sm text-white/80">
                Create a free shop account, find your listing, and tell us how to verify you —
                we typically call the number already on the listing. Approved claims unlock the
                dashboard: hours, services, photos, offers, and incoming repair requests by email.
              </p>
            </div>
            <Link href="/register?role=provider" className="btn !px-6 !py-3">
              Create a shop account
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
