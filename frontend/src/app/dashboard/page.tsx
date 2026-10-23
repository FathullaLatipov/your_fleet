"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusBadge, Stars, TrustBadges } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Booking, BusinessListItem, Notification } from "@/lib/types";

const ACTIVE = new Set(["requested", "quoted", "accepted", "confirmed", "in_progress", "disputed"]);

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
  const unread = notifications.filter((n) => !n.read_at);

  async function markRead(id: string) {
    await api(`/api/me/notifications/${id}/read`, { method: "POST" }).catch(() => {});
    setNotifications((ns) => ns.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)));
  }

  const BookingRow = ({ b }: { b: Booking }) => (
    <li className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3">
      <div className="min-w-0">
        <Link href={`/bookings/${b.id}`} className="font-semibold hover:text-pine hover:underline">
          {b.issue_description.slice(0, 80)}{b.issue_description.length > 80 ? "…" : ""}
        </Link>
        <p className="text-sm text-faint">
          {new Date(b.created_at).toLocaleDateString()} · {b.urgency === "emergency" ? "Emergency" : "Scheduled"}
        </p>
      </div>
      <StatusBadge status={b.status} />
    </li>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold">My repairs</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-8">
          <section>
            <h2 className="text-lg font-bold">Active requests</h2>
            {active.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">
                Nothing active. <Link href="/search" className="font-medium text-pine hover:underline">Find a shop</Link> when you need one.
              </p>
            ) : (
              <ul className="mt-2">{active.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            )}
          </section>
          <section>
            <h2 className="text-lg font-bold">History</h2>
            {past.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">No completed repairs yet.</p>
            ) : (
              <ul className="mt-2">{past.map((b) => <BookingRow key={b.id} b={b} />)}</ul>
            )}
          </section>
          <section>
            <h2 className="text-lg font-bold">Saved shops</h2>
            {favorites.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">No saved shops. Save shops you trust from their profile page.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line">
                {favorites.map((f) => (
                  <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <Link href={`/business/${f.id}`} className="font-semibold hover:text-pine hover:underline">{f.name}</Link>
                      <p className="text-sm text-steel">{f.city ? `${f.city}, ${f.state}` : f.state}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Stars avg={f.rating_avg} count={f.rating_count} />
                      <TrustBadges b={f} compact />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside>
          <h2 className="text-lg font-bold">
            Notifications {unread.length > 0 && <span className="rounded bg-pine px-1.5 text-sm text-white">{unread.length}</span>}
          </h2>
          {notifications.length === 0 ? (
            <p className="mt-2 text-sm text-steel">Nothing yet.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {notifications.slice(0, 15).map((n) => (
                <li key={n.id} className={`rounded border border-line p-3 text-sm ${n.read_at ? "bg-mist text-steel" : "bg-panel"}`}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{n.title}</p>
                    {!n.read_at && (
                      <button className="text-xs text-pine hover:underline" onClick={() => markRead(n.id)}>
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
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
