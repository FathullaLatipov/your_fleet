"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { BookingForm } from "@/components/BookingForm";
import { ShopCover } from "@/components/ShopCover";
import { Stars, TrustBadges } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { openStatus } from "@/lib/hours";
import { CATEGORY_LABELS, fmtUsd, mediaUrl, type BusinessDetail, type Review } from "@/lib/types";

const LocationMap = dynamic(() => import("@/components/LocationMap"), { ssr: false });

const DAY_LABELS: Record<string, string> = {
  mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday",
  fri: "Friday", sat: "Saturday", sun: "Sunday",
};

function BusinessPageInner() {
  const { id } = useParams<{ id: string }>();
  const qs = useSearchParams();
  const { user } = useAuth();
  const [b, setB] = useState<BusinessDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingOffer, setBookingOffer] = useState<string | null>(null);
  const [favorite, setFavorite] = useState(false);

  useEffect(() => {
    api<BusinessDetail>(`/api/businesses/${id}`).then(setB).catch((e) => setError(e.message));
    api<Review[]>(`/api/businesses/${id}/reviews`).then(setReviews).catch(() => {});
  }, [id]);

  async function toggleFavorite() {
    try {
      await api(`/api/me/favorites/${id}`, { method: favorite ? "DELETE" : "PUT" });
      setFavorite(!favorite);
    } catch {
      /* not signed in */
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <h1 className="text-2xl font-bold">Business not found</h1>
        <p className="mt-2 text-steel">{error}</p>
        <Link href="/search" className="btn mt-6">Back to search</Link>
      </div>
    );
  }
  if (!b) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>;

  const directions = `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
  const googleUrl =
    b.google_place_url ??
    `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${b.name} ${b.address_raw ?? `${b.lat},${b.lng}`}`)}`;
  const canBook = user && (user.role === "driver" || user.role === "fleet_manager");
  const status = openStatus(b.hours);
  const savePcts = b.offers
    .filter((o) => o.savings_cents != null && o.standard_price_cents)
    .map((o) => Math.round((o.savings_cents! / o.standard_price_cents!) * 100));
  const maxSavePct = savePcts.length ? Math.max(...savePcts) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Gallery */}
      {b.photos.length > 0 ? (
        <div className="grid h-60 gap-1.5 overflow-hidden rounded-lg sm:h-72 sm:grid-cols-[2fr_1fr]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mediaUrl(b.photos[0].path)} alt={b.photos[0].caption ?? `${b.name} photo`}
               className="h-full w-full object-cover" />
          {b.photos.length > 1 && (
            <div className="hidden grid-rows-2 gap-1.5 sm:grid">
              {b.photos.slice(1, 3).map((p) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={p.id} src={mediaUrl(p.path)} alt={p.caption ?? `${b.name} photo`}
                     className="h-full w-full object-cover" />
              ))}
            </div>
          )}
        </div>
      ) : (
        <ShopCover name={b.name} category={b.category} showLabel
                   locality={b.city ? `${b.city}, ${b.state ?? ""}` : b.state}
                   className="h-44 rounded-lg sm:h-52" />
      )}

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">{b.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-steel">
            <span>{CATEGORY_LABELS[b.category] ?? b.category}</span>
            <Stars avg={b.rating_avg} count={b.rating_count} />
            {b.google_rating != null && (
              <span className="text-sm">
                <span className="font-semibold text-amber-ink">{b.google_rating.toFixed(1)}★</span>{" "}
                on Google{b.google_rating_count != null && ` (${b.google_rating_count})`}
              </span>
            )}
            <TrustBadges b={{ ...b, has_active_offer: b.offers.length > 0 }} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-steel">
            {b.address_raw && <span>{b.address_raw}</span>}
            <span
              className={`font-medium ${
                status.kind === "open" ? "text-pine" : status.kind === "closed" ? "text-danger" : "text-faint"
              }`}
            >
              {status.label}
            </span>
          </div>
          {maxSavePct != null && (
            <a
              href="#offers"
              className="mt-3 inline-flex items-center gap-2 rounded-md bg-cta px-3 py-1.5 text-sm font-bold text-ink hover:bg-cta-hover"
            >
              Partner offer — save up to {maxSavePct}% ↓
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {b.phone && (
            <a href={`tel:${b.phone}`} className="btn">Call {b.phone}</a>
          )}
          <a href={directions} target="_blank" rel="noopener noreferrer" className="btn-quiet">
            Directions
          </a>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="btn-quiet">
            View on Google
          </a>
          {user && (
            <button onClick={toggleFavorite} className="btn-quiet" aria-pressed={favorite}>
              {favorite ? "Saved ✓" : "Save shop"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]">
        <div className="space-y-8">
          {/* Offers — amber is reserved for this block */}
          {b.offers.length > 0 && (
            <section id="offers" className="rounded-xl border border-amber/60 bg-amber-wash shadow-(--shadow-card) p-5 scroll-mt-20">
              <h2 className="text-xl font-bold text-amber-ink">Verified partner offers</h2>
              <p className="mt-1 text-sm text-amber-ink/80">
                Negotiated with this shop under a marketplace agreement. Final invoice may add
                parts, taxes, or approved extra labor — the shop must explain any additions
                before you commit.
              </p>
              <ul className="mt-4 space-y-3">
                {b.offers.map((o) => {
                  const pct =
                    o.savings_cents != null && o.standard_price_cents
                      ? Math.round((o.savings_cents / o.standard_price_cents) * 100)
                      : null;
                  return (
                    <li key={o.id} className="rounded-xl border border-amber/40 bg-panel shadow-(--shadow-card) p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="display font-semibold">{o.title}</h3>
                        {pct != null && (
                          <span className="rounded bg-cta px-2 py-0.5 text-sm font-bold text-ink">
                            Save {pct}%
                          </span>
                        )}
                      </div>
                      {o.standard_price_cents != null && o.marketplace_price_cents != null ? (
                        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line">
                          <div className="bg-mist p-3">
                            <p className="text-xs text-steel">Regular price (documented)</p>
                            <p className="mt-0.5 text-xl font-semibold text-faint line-through">
                              {fmtUsd(o.standard_price_cents)}
                            </p>
                          </div>
                          <div className="bg-pine-wash p-3">
                            <p className="text-xs font-medium text-pine">Marketplace price</p>
                            <p className="display mt-0.5 text-xl font-bold text-pine">
                              {fmtUsd(o.marketplace_price_cents)}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-2 text-lg font-bold text-pine">
                          {o.marketplace_price_cents != null && fmtUsd(o.marketplace_price_cents)}
                          {o.discount_percent != null && o.marketplace_price_cents == null && `${o.discount_percent}% off`}
                          {o.offer_type === "quote_based" && o.discount_percent == null && (
                            <span className="text-base font-semibold text-steel">Discounted quote on request</span>
                          )}
                        </p>
                      )}
                      {o.savings_cents != null && (
                        <p className="mt-2 text-sm font-semibold text-amber-ink">
                          You keep {fmtUsd(o.savings_cents)} — booked through YourFleet
                        </p>
                      )}
                      {o.conditions && <p className="mt-1.5 text-sm text-steel">{o.conditions}</p>}
                      {o.expires_at && (
                        <p className="mt-1 text-xs text-faint">
                          Valid through {new Date(o.expires_at).toLocaleDateString()}
                        </p>
                      )}
                      {canBook && (
                        <button
                          className="btn mt-3"
                          onClick={() => { setBookingOffer(o.id); setBookingOpen(true); }}
                        >
                          Book with this offer
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Services */}
          <section>
            <h2 className="text-xl font-bold">Services</h2>
            {b.services.length === 0 ? (
              <p className="mt-2 text-[15px] text-steel">
                Service list not provided yet. Call the shop to confirm what they handle.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-line card">
                {b.services.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                    <span className="font-medium">{s.service.name}</span>
                    <span className="text-sm text-steel">
                      {s.standard_price_cents != null ? `from ${fmtUsd(s.standard_price_cents)}` : s.price_note ?? "Quote on request"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-xl font-bold">About</h2>
            {b.description ? (
              <p className="mt-2 whitespace-pre-line text-[15px] text-steel">{b.description}</p>
            ) : (
              <p className="mt-2 text-[15px] text-steel">
                {CATEGORY_LABELS[b.category] ?? "Service"} shop
                {b.city ? ` in ${b.city}, ${b.state}` : b.state ? ` in ${b.state}` : ""}, listed in
                the YourFleet directory from our operator-curated shop map.
                {b.is_claimed
                  ? " Managed by the business on YourFleet."
                  : " Details like services, hours and photos are confirmed once the owner claims this listing — call ahead to confirm."}
              </p>
            )}
          </section>

          {/* Reviews */}
          <section>
            <h2 className="text-xl font-bold">Reviews</h2>
            <p className="mt-1 text-sm text-faint">
              Only drivers with completed YourFleet bookings can review this shop.
            </p>
            {reviews.length === 0 ? (
              <p className="mt-3 text-[15px] text-steel">No reviews yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {reviews.map((r) => (
                  <li key={r.id} className="card p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-ink">{r.rating}★</span>
                      <span className="text-xs text-faint">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.text && <p className="mt-1.5 text-[15px] text-steel">{r.text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Sidebar */}
        <aside className="space-y-5 self-start">
          <a
            href={directions}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open directions to ${b.name}`}
            className="block h-44 overflow-hidden rounded-lg border border-line"
          >
            <LocationMap lat={b.lat} lng={b.lng} />
          </a>
          <div className="card p-5">
            <h2 className="font-bold">Request a repair</h2>
            <p className="mt-1 text-sm text-steel">
              Describe the problem; the shop replies with a price and time. Booking through
              YourFleet is how offer pricing is honored.
            </p>
            {canBook ? (
              <button className="btn mt-3 w-full" onClick={() => { setBookingOffer(null); setBookingOpen(true); }}>
                Request repair or quote
              </button>
            ) : user ? (
              <p className="mt-3 text-sm text-steel">Provider accounts can&apos;t book repairs.</p>
            ) : (
              <Link href={`/login?next=/business/${b.id}`} className="btn mt-3 w-full">
                Sign in to request
              </Link>
            )}
          </div>

          <div className="card p-5">
            <h2 className="font-bold">Hours</h2>
            {b.hours ? (
              <table className="mt-2 w-full text-sm">
                <tbody>
                  {Object.entries(DAY_LABELS).map(([key, label]) => (
                    <tr key={key}>
                      <td className="py-0.5 pr-3 text-steel">{label}</td>
                      <td className="py-0.5 font-medium">
                        {b.hours![key]?.length
                          ? b.hours![key].map((r) => r.join("–")).join(", ")
                          : "Closed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-2 text-sm text-steel">
                Hours not verified. Call before you drive.
              </p>
            )}
            <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-steel">Mobile service</dt>
                <dd className="font-medium">{b.is_mobile_service == null ? "Unknown" : b.is_mobile_service ? "Yes" : "No"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-steel">Emergency requests</dt>
                <dd className="font-medium">{b.accepts_emergency == null ? "Unknown" : b.accepts_emergency ? "Yes" : "No"}</dd>
              </div>
              {b.website && (
                <div className="flex justify-between gap-3">
                  <dt className="text-steel">Website</dt>
                  <dd className="truncate font-medium">
                    <a className="text-pine hover:underline" href={b.website} target="_blank" rel="noopener noreferrer">
                      {b.website.replace(/^https?:\/\//, "")}
                    </a>
                  </dd>
                </div>
              )}
            </dl>
          </div>

          {!b.is_claimed && (
            <div className="rounded-xl border border-line bg-mist p-5 text-sm text-steel">
            <p className="font-semibold text-ink">Is this your shop?</p>
              <p className="mt-1">
                Claim this listing to manage your details, publish offers, and receive booking
                requests.
              </p>
              <Link href={`/provider/claim?business=${b.id}`} className="btn-quiet mt-3 w-full">
                Claim this business
              </Link>
            </div>
          )}

          <p className="text-xs text-faint">
            See something wrong? Imported listings can be out of date —{" "}
            <a className="underline" href={`mailto:support@yourfleet.example?subject=Listing issue ${b.id}`}>
              report an issue
            </a>.
          </p>
        </aside>
      </div>

      {bookingOpen && canBook && (
        <BookingForm
          business={b}
          offerId={bookingOffer}
          onClose={() => setBookingOpen(false)}
          initialIssue={qs.get("issue") ?? ""}
          initialVehicleId={qs.get("vehicle")}
          defectId={qs.get("defect")}
        />
      )}

      {/* One-tap mobile action bar */}
      <div
        className="fixed inset-x-0 bottom-0 z-[900] flex gap-2 border-t border-line bg-panel p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgb(22_24_27/0.12)] lg:hidden"
        role="group"
        aria-label="Quick actions"
      >
        {b.phone && (
          <a href={`tel:${b.phone}`} className="btn-forest flex-1 !py-2.5">Call</a>
        )}
        <a href={directions} target="_blank" rel="noopener noreferrer" className="btn-quiet flex-1 !py-2.5">
          Directions
        </a>
        {canBook ? (
          <button
            className="btn flex-[1.4] !py-2.5"
            onClick={() => { setBookingOffer(null); setBookingOpen(true); }}
          >
            Request repair
          </button>
        ) : !user ? (
          <Link href={`/login?next=/business/${b.id}`} className="btn flex-[1.4] !py-2.5">
            Request repair
          </Link>
        ) : null}
      </div>
      {/* Spacer so the fixed bar never covers content on mobile */}
      <div className="h-20 lg:hidden" aria-hidden />
    </div>
  );
}

export default function BusinessPage() {
  return (
    <Suspense fallback={<p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>}>
      <BusinessPageInner />
    </Suspense>
  );
}
