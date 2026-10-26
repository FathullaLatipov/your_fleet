"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd, type Booking, type BookingStatus, type BusinessDetail } from "@/lib/types";

interface EventRow {
  id: string;
  from_status: string | null;
  to_status: string | null;
  note: string | null;
  created_at: string;
}

interface Action {
  to: BookingStatus;
  label: string;
  style?: "danger" | "quiet";
  needsQuote?: boolean;
  needsFinal?: boolean;
}

function actionsFor(kind: "driver" | "provider" | "admin", status: BookingStatus): Action[] {
  const A: Record<string, Action[]> = {
    "driver:requested": [{ to: "cancelled", label: "Cancel request", style: "danger" }],
    "driver:quoted": [
      { to: "confirmed", label: "Accept quote & confirm" },
      { to: "cancelled", label: "Decline & cancel", style: "danger" },
    ],
    "driver:accepted": [
      { to: "confirmed", label: "Confirm booking" },
      { to: "cancelled", label: "Cancel", style: "danger" },
    ],
    "driver:confirmed": [{ to: "cancelled", label: "Cancel booking", style: "danger" }],
    "driver:in_progress": [{ to: "disputed", label: "Report a problem", style: "danger" }],
    "driver:completed": [{ to: "disputed", label: "Dispute this repair", style: "danger" }],
    "provider:requested": [
      { to: "quoted", label: "Send quote", needsQuote: true },
      { to: "accepted", label: "Accept as requested" },
      { to: "cancelled", label: "Decline", style: "danger" },
    ],
    "provider:quoted": [
      { to: "quoted", label: "Revise quote", needsQuote: true, style: "quiet" },
      { to: "cancelled", label: "Withdraw", style: "danger" },
    ],
    "provider:accepted": [{ to: "cancelled", label: "Cancel", style: "danger" }],
    "provider:confirmed": [
      { to: "in_progress", label: "Start repair" },
      { to: "cancelled", label: "Cancel", style: "danger" },
    ],
    "provider:in_progress": [
      { to: "completed", label: "Mark completed", needsFinal: true },
      { to: "disputed", label: "Raise dispute", style: "danger" },
    ],
    "admin:disputed": [
      { to: "completed", label: "Resolve as completed" },
      { to: "cancelled", label: "Resolve as cancelled", style: "danger" },
    ],
  };
  return A[`${kind}:${status}`] ?? [];
}

export default function BookingPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [business, setBusiness] = useState<BusinessDetail | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState("");
  const [reviewDone, setReviewDone] = useState(false);

  const load = useCallback(() => {
    api<Booking>(`/api/bookings/${id}`)
      .then((b) => {
        setBooking(b);
        api<BusinessDetail>(`/api/businesses/${b.business_id}`).then(setBusiness).catch(() => {});
        api<EventRow[]>(`/api/bookings/${id}/events`).then(setEvents).catch(() => {});
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (!user) return <p className="mx-auto max-w-3xl px-4 py-10 text-steel">Sign in to view this booking.</p>;
  if (error) return <p className="mx-auto max-w-3xl px-4 py-10 font-medium text-danger">{error}</p>;
  if (!booking) return <p className="mx-auto max-w-3xl px-4 py-10 text-steel">Loading…</p>;

  const kind: "driver" | "provider" | "admin" =
    user.role === "admin" ? "admin" : booking.driver_id === user.id ? "driver" : "provider";
  const actions = actionsFor(kind, booking.status);

  async function act(a: Action) {
    if (!booking) return;
    const cents = price ? Math.round(parseFloat(price) * 100) : null;
    if ((a.needsQuote || a.needsFinal) && (cents == null || Number.isNaN(cents))) {
      setError("Enter a price in dollars first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api(`/api/bookings/${booking.id}/transition`, {
        method: "POST",
        body: {
          to_status: a.to,
          version: booking.version,
          note: note || null,
          quoted_price_cents: a.needsQuote ? cents : null,
          final_price_cents: a.needsFinal ? cents : null,
        },
      });
      setPrice("");
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("/api/reviews", {
        method: "POST",
        body: { booking_id: booking!.id, rating, text: reviewText || null },
      });
      setReviewDone(true);
      setReviewOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  const needsPriceInput = actions.some((a) => a.needsQuote || a.needsFinal);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Repair request</h1>
        <StatusBadge status={booking.status} />
      </div>
      {business && (
        <p className="mt-1 text-steel">
          at{" "}
          <Link href={`/business/${business.id}`} className="font-medium text-pine hover:underline">
            {business.name}
          </Link>
          {business.city && ` — ${business.city}, ${business.state}`}
        </p>
      )}

      <div className="mt-6 card p-5">
        <h2 className="font-bold">Issue</h2>
        <p className="mt-1 whitespace-pre-line text-[15px]">{booking.issue_description}</p>
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex justify-between sm:block">
            <dt className="text-steel">Urgency</dt>
            <dd className="font-medium">{booking.urgency === "emergency" ? "Emergency" : "Scheduled"}</dd>
          </div>
          {booking.truck_info && (
            <div className="flex justify-between sm:block">
              <dt className="text-steel">Truck</dt>
              <dd className="font-medium">
                {[booking.truck_info.year, booking.truck_info.make, booking.truck_info.model].filter(Boolean).join(" ") || "—"}
              </dd>
            </div>
          )}
          {booking.location_text && (
            <div className="flex justify-between sm:block">
              <dt className="text-steel">Truck location</dt>
              <dd className="font-medium">{booking.location_text}</dd>
            </div>
          )}
          {booking.preferred_time && (
            <div className="flex justify-between sm:block">
              <dt className="text-steel">Preferred time</dt>
              <dd className="font-medium">{new Date(booking.preferred_time).toLocaleString()}</dd>
            </div>
          )}
          {booking.quoted_price_cents != null && (
            <div className="flex justify-between sm:block">
              <dt className="text-steel">Quoted price (estimate)</dt>
              <dd className="font-semibold text-pine">{fmtUsd(booking.quoted_price_cents)}</dd>
            </div>
          )}
          {booking.final_price_cents != null && (
            <div className="flex justify-between sm:block">
              <dt className="text-steel">Final price</dt>
              <dd className="font-semibold">{fmtUsd(booking.final_price_cents)}</dd>
            </div>
          )}
          {kind !== "driver" && booking.commission_amount_cents != null && (
            <>
              <div className="flex justify-between sm:block">
                <dt className="text-steel">Platform commission</dt>
                <dd className="font-medium">{fmtUsd(booking.commission_amount_cents)}</dd>
              </div>
              <div className="flex justify-between sm:block">
                <dt className="text-steel">Provider payout</dt>
                <dd className="font-medium">{fmtUsd(booking.provider_payout_cents)}</dd>
              </div>
            </>
          )}
        </dl>
        {booking.quote_note && (
          <p className="mt-3 rounded bg-mist p-3 text-sm text-steel">Shop note: {booking.quote_note}</p>
        )}
      </div>

      {actions.length > 0 && (
        <div className="mt-5 card p-5">
          <h2 className="font-bold">Actions</h2>
          {needsPriceInput && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="bk-price">Price (USD)</label>
                <input id="bk-price" className="field mt-1" inputMode="decimal" placeholder="e.g. 1500.00"
                       value={price} onChange={(e) => setPrice(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="bk-note">Note to the other party</label>
                <input id="bk-note" className="field mt-1" maxLength={2000} value={note}
                       onChange={(e) => setNote(e.target.value)} />
              </div>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((a) => (
              <button
                key={a.to + a.label}
                className={a.style === "danger" ? "btn-danger" : a.style === "quiet" ? "btn-quiet" : "btn"}
                disabled={busy}
                onClick={() => act(a)}
              >
                {a.label}
              </button>
            ))}
          </div>
          {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
        </div>
      )}

      {kind === "driver" && booking.status === "completed" && !reviewDone && (
        <div className="mt-5 card p-5">
          <h2 className="font-bold">How did it go?</h2>
          {reviewOpen ? (
            <form onSubmit={submitReview} className="mt-3 space-y-3">
              <div className="flex gap-1" role="radiogroup" aria-label="Rating">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n}
                          onClick={() => setRating(n)}
                          className={`h-10 w-10 rounded border text-lg font-bold ${n <= rating ? "border-amber bg-amber-wash text-amber-ink" : "border-line text-faint"}`}>
                    {n}
                  </button>
                ))}
              </div>
              <textarea className="field min-h-24" placeholder="What should other drivers know?"
                        maxLength={5000} value={reviewText} onChange={(e) => setReviewText(e.target.value)} />
              <button className="btn" disabled={busy}>Publish review</button>
            </form>
          ) : (
            <button className="btn-quiet mt-3" onClick={() => setReviewOpen(true)}>
              Leave a review
            </button>
          )}
        </div>
      )}
      {reviewDone && <p className="mt-5 rounded bg-pine-wash p-4 font-medium text-pine">Review published. Thanks!</p>}

      <div className="mt-5">
        <h2 className="font-bold">History</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {events.map((ev) => (
            <li key={ev.id} className="flex gap-3 border-b border-line py-1.5">
              <span className="w-36 shrink-0 text-faint">{new Date(ev.created_at).toLocaleString()}</span>
              <span className="font-medium">
                {ev.from_status ? `${ev.from_status} → ${ev.to_status}` : `created (${ev.to_status})`}
              </span>
              {ev.note && <span className="text-steel">— {ev.note}</span>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
