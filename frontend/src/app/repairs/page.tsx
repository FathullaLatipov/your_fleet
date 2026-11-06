"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatusBadge, Stars, TrustBadges } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Booking, BusinessListItem } from "@/lib/types";

const ACTIVE = new Set(["requested", "quoted", "accepted", "confirmed", "in_progress", "disputed"]);

/* Inline icon set — 24px stroke glyphs, consistent with the brand. */
const Icons = {
  wrench: (
    <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z" />
  ),
  bookmark: <path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4-6.5 4V4.5a1 1 0 0 1 1-1Z" />,
  truck: (
    <>
      <path d="M2 16V7h11v9M13 10h5l3 3v3h-3M2 16h2m3.5 0H13m4.5 0H21" />
      <path d="M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </>
  ),
};

function Icon({ name, className = "h-5 w-5" }: { name: keyof typeof Icons; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
         strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
      {Icons[name]}
    </svg>
  );
}

function SectionCard({
  icon, title, count, id, children,
}: {
  icon: keyof typeof Icons;
  title: string;
  count?: number;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="card scroll-mt-20 p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-lg bg-pine-wash text-pine">
          <Icon name={icon} />
        </span>
        <h2 className="text-lg font-bold">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="rounded-full bg-mist px-2.5 py-0.5 text-sm font-semibold text-steel">{count}</span>
        )}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EmptyState({
  icon, text, actionHref, actionLabel,
}: {
  icon: keyof typeof Icons;
  text: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-mist/60 px-4 py-8 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-panel text-faint shadow-[0_1px_2px_rgb(22_24_27/0.06)]">
        <Icon name={icon} className="h-6 w-6" />
      </span>
      <p className="max-w-[36ch] text-sm text-steel">{text}</p>
      {actionHref && actionLabel && (
        <Link href={actionHref} className="btn !py-2 text-sm">{actionLabel}</Link>
      )}
    </div>
  );
}

function RepairsInner() {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [favorites, setFavorites] = useState<BusinessListItem[]>([]);

  useEffect(() => {
    if (!user) return;
    api<Booking[]>("/api/bookings/mine").then(setBookings).catch(() => {});
    api<BusinessListItem[]>("/api/me/favorites").then(setFavorites).catch(() => {});
  }, [user]);

  const active = bookings.filter((b) => ACTIVE.has(b.status));

  const BookingRow = ({ b }: { b: Booking }) => (
    <li>
      <Link
        href={`/bookings/${b.id}`}
        className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-mist"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold">
            {b.issue_description.slice(0, 80)}{b.issue_description.length > 80 ? "…" : ""}
          </p>
          <p className="mt-0.5 text-sm text-faint">
            {new Date(b.created_at).toLocaleDateString()}
            {b.urgency === "emergency" && <span className="ml-1.5 font-semibold text-danger">Emergency</span>}
            {b.quoted_price_cents != null && ` · quoted $${(b.quoted_price_cents / 100).toLocaleString()}`}
          </p>
        </div>
        <StatusBadge status={b.status} />
      </Link>
    </li>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-steel">Active repair requests and the shops you saved.</p>
        <Link href="/map" className="btn !py-2 text-sm">
          <Icon name="wrench" className="h-4.5 w-4.5" />
          Find truck repair
        </Link>
      </div>

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <SectionCard icon="wrench" title="Active requests" count={active.length}>
            {active.length === 0 ? (
              <EmptyState
                icon="truck"
                text="Nothing active. When a truck needs work, find a shop and send a request — you'll track it here."
                actionHref="/map"
                actionLabel="Find a shop"
              />
            ) : (
              <ul className="-mx-3 divide-y divide-line/70">{active.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            )}
          </SectionCard>
        </div>

        <div className="space-y-5">
          <SectionCard icon="bookmark" title="Saved shops" count={favorites.length}>
            {favorites.length === 0 ? (
              <EmptyState
                icon="bookmark"
                text="Keep the shops you trust one tap away — hit “Save shop” on any profile."
                actionHref="/map"
                actionLabel="Browse shops"
              />
            ) : (
              <ul className="-mx-3 divide-y divide-line/70">
                {favorites.map((f) => (
                  <li key={f.id}>
                    <Link href={`/business/${f.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-3 transition-colors hover:bg-mist">
                      <div>
                        <p className="font-semibold">{f.name}</p>
                        <p className="text-sm text-steel">{f.city ? `${f.city}, ${f.state}` : f.state}</p>
                      </div>
                      <span className="flex items-center gap-2">
                        <Stars avg={f.rating_avg} count={f.rating_count} />
                        <TrustBadges b={f} compact />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

export default function RepairsPage() {
  return (
    <AppShell title="Repairs">
      <RepairsInner />
    </AppShell>
  );
}
