"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusBadge, Stars, TrustBadges } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Booking, BusinessListItem, Notification } from "@/lib/types";

const ACTIVE = new Set(["requested", "quoted", "accepted", "confirmed", "in_progress", "disputed"]);

/* Inline icon set — 24px stroke glyphs, consistent with the brand. */
const Icons = {
  wrench: (
    <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z" />
  ),
  history: (
    <>
      <path d="M12 21a9 9 0 1 0-8.6-11.7" />
      <path d="M3 4v5h5M12 7v5l3.5 2" strokeLinecap="round" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11a1 1 0 0 1 1 1V21l-6.5-4-6.5 4V4.5a1 1 0 0 1 1-1Z" />,
  bell: (
    <>
      <path d="M12 3a6 6 0 0 0-6 6v3.2l-1.7 3.3a.6.6 0 0 0 .5.9h14.4a.6.6 0 0 0 .5-.9L18 12.2V9a6 6 0 0 0-6-6Z" />
      <path d="M9.8 19.5a2.3 2.3 0 0 0 4.4 0" strokeLinecap="round" />
    </>
  ),
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
  icon, title, count, children,
}: {
  icon: keyof typeof Icons;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="card p-5">
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

export default function DriverDashboard() {
  const { user, loading } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [favorites, setFavorites] = useState<BusinessListItem[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user) return;
    api<Booking[]>("/api/bookings/mine").then(setBookings).catch(() => {});
    api<BusinessListItem[]>("/api/me/favorites").then(setFavorites).catch(() => {});
    api<Notification[]>("/api/me/notifications").then(setNotifications).catch(() => {});
  }, [user]);

  if (loading) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>;
  if (!user) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <p className="text-steel">Sign in to see your repairs.</p>
        <Link href="/login?next=/dashboard" className="btn mt-4">Sign in</Link>
      </div>
    );
  }

  const active = bookings.filter((b) => ACTIVE.has(b.status));
  const past = bookings.filter((b) => !ACTIVE.has(b.status));
  const completed = past.filter((b) => b.status === "completed");
  const unread = notifications.filter((n) => !n.read_at);

  async function markRead(id: string) {
    await api(`/api/me/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }

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
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My repairs</h1>
          <p className="mt-1 text-steel">Hey {user.full_name.split(" ")[0]} — here&apos;s where your trucks stand.</p>
        </div>
        <Link href="/search" className="btn">
          <Icon name="wrench" className="h-4.5 w-4.5" />
          Find truck repair
        </Link>
      </div>

      {/* Stat strip */}
      <div className="mt-6 grid grid-cols-3 gap-3">
        {([
          ["wrench", active.length, "active requests"],
          ["history", completed.length, "repairs completed"],
          ["bookmark", favorites.length, "saved shops"],
        ] as const).map(([icon, value, label]) => (
          <div key={label} className="card flex items-center gap-3 p-4">
            <span className="hidden h-10 w-10 shrink-0 place-items-center rounded-lg bg-mist text-steel sm:grid">
              <Icon name={icon} />
            </span>
            <div>
              <p className="display text-2xl font-bold leading-none">{value}</p>
              <p className="mt-1 text-sm text-steel">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <SectionCard icon="wrench" title="Active requests" count={active.length}>
            {active.length === 0 ? (
              <EmptyState
                icon="truck"
                text="Nothing active. When a truck needs work, find a shop and send a request — you'll track it here."
                actionHref="/search"
                actionLabel="Find a shop"
              />
            ) : (
              <ul className="-mx-3 divide-y divide-line/70">{active.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            )}
          </SectionCard>

          <SectionCard icon="history" title="History" count={past.length}>
            {past.length === 0 ? (
              <EmptyState icon="history" text="Completed and cancelled repairs will show up here with their final costs." />
            ) : (
              <ul className="-mx-3 divide-y divide-line/70">{past.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            )}
          </SectionCard>

          <SectionCard icon="bookmark" title="Saved shops" count={favorites.length}>
            {favorites.length === 0 ? (
              <EmptyState
                icon="bookmark"
                text="Keep the shops you trust one tap away — hit “Save shop” on any profile."
                actionHref="/search"
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

        <SectionCard icon="bell" title="Notifications" count={unread.length}>
          {notifications.length === 0 ? (
            <EmptyState icon="bell" text="Quotes, confirmations and maintenance alerts will land here." />
          ) : (
            <ul className="space-y-2">
              {notifications.slice(0, 15).map((n) => (
                <li key={n.id}
                    className={`rounded-lg border p-3 text-sm ${n.read_at ? "border-line/60 bg-mist/60 text-steel" : "border-line bg-panel shadow-[0_1px_2px_rgb(22_24_27/0.05)]"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">
                      {!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-cta align-middle" aria-label="Unread" />}
                      {n.title}
                    </p>
                    {!n.read_at && (
                      <button className="shrink-0 text-xs font-medium text-pine hover:underline" onClick={() => markRead(n.id)}>
                        Mark read
                      </button>
                    )}
                  </div>
                  {n.body && <p className="mt-0.5">{n.body}</p>}
                  {n.data?.booking_id && (
                    <Link href={`/bookings/${n.data.booking_id}`} className="mt-1 inline-block font-medium text-pine hover:underline">
                      Open booking
                    </Link>
                  )}
                  {n.data?.vehicle_id && !n.data?.booking_id && (
                    <Link href={`/fleet/${n.data.vehicle_id}`} className="mt-1 inline-block font-medium text-pine hover:underline">
                      Open truck
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
