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

const Icons = {
  wrench: (
    <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z" />
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10.5V17M12 7.2v.2" strokeLinecap="round" />
    </>
  ),
  star: (
    <path d="m12 3.5 2.5 5.3 5.8.7-4.3 4 1.1 5.7L12 16.4l-5.1 2.8 1.1-5.7-4.3-4 5.8-.7L12 3.5Z" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" strokeLinecap="round" />
    </>
  ),
  tag: (
    <>
      <path d="M3.5 12.5 11 20l9-9V4h-7l-9.5 8.5Z" strokeLinejoin="round" />
      <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
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
  icon, title, tone = "pine", children, right,
}: {
  icon: keyof typeof Icons;
  title: string;
  tone?: "pine" | "amber";
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`grid h-10 w-10 place-items-center rounded-lg ${
          tone === "amber" ? "bg-amber-wash text-amber-ink" : "bg-pine-wash text-pine"}`}>
          <Icon name={icon} />
        </span>
        <h2 className="text-lg font-bold">{title}</h2>
        {right && <span className="ml-auto">{right}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const cleanAddress = (a: string) => a.replace(/,?\s*(США|USA|United States)\s*$/i, "");

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
  const address = b.address_raw ? cleanAddress(b.address_raw) : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Hero: photo or illustrated cover with identity overlay */}
      <div className="relative h-60 overflow-hidden rounded-2xl shadow-(--shadow-card) sm:h-72">
        {b.photos.length > 0 ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mediaUrl(b.photos[0].path)} alt={`${b.name} photo`}
               className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <ShopCover name={b.name} category={b.category} showMonogram={false}
                     className="absolute inset-0" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-charcoal/90 via-charcoal/30 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur">
              {CATEGORY_LABELS[b.category] ?? b.category}
            </span>
            <TrustBadges b={{ ...b, has_active_offer: b.offers.length > 0 }} compact />
            {maxSavePct != null && (
              <a href="#offers"
                 className="rounded-full bg-cta px-2.5 py-0.5 text-xs font-bold text-ink hover:bg-cta-hover">
                Save up to {maxSavePct}% ↓
              </a>
            )}
          </div>
          <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">{b.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/85">
            {b.rating_count > 0 && (
              <span><strong className="text-amber">{b.rating_avg?.toFixed(1)}★</strong> on YourFleet ({b.rating_count})</span>
            )}
            {b.google_rating != null && (
              <span><strong className="text-amber">{b.google_rating.toFixed(1)}★</strong> on Google
                {b.google_rating_count != null && ` (${b.google_rating_count.toLocaleString()})`}</span>
            )}
            {b.rating_count === 0 && b.google_rating == null && <span>No reviews yet</span>}
            <span className={`font-semibold ${
              status.kind === "open" ? "text-[#7fd4a3]" : status.kind === "closed" ? "text-[#ff9d8f]" : "text-white/55"}`}>
              {status.label}
            </span>
          </div>
        </div>
        {b.photos.length === 0 && (
          <p className="absolute right-3 top-3 rounded bg-charcoal/60 px-2 py-0.5 text-[10px] text-white/60">
            Illustration — no photos yet
          </p>
        )}
      </div>

      {b.photos.length > 1 && (
        <div className="mt-2 flex gap-2 overflow-x-auto">
          {b.photos.slice(1, 6).map((p) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={p.id} src={mediaUrl(p.path)} alt={p.caption ?? `${b.name} photo`}
                 className="h-20 w-28 shrink-0 rounded-lg object-cover" />
          ))}
        </div>
      )}

      {/* Action bar */}
      <div className="card mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 p-4">
        {address && <p className="text-[15px] text-steel">{address}</p>}
        <div className="ml-auto flex flex-wrap gap-2">
          {b.phone && <a href={`tel:${b.phone}`} className="btn !py-2">Call {b.phone}</a>}
          <a href={directions} target="_blank" rel="noopener noreferrer" className="btn-quiet !py-2">
            Directions
          </a>
          <a href={googleUrl} target="_blank" rel="noopener noreferrer" className="btn-quiet !py-2">
            View on Google
          </a>
          {user && (
            <button onClick={toggleFavorite} aria-pressed={favorite}
                    className={`btn-quiet !py-2 ${favorite ? "!border-pine/50 !bg-pine-wash !text-pine" : ""}`}>
              {favorite ? "Saved ✓" : "Save shop"}
            </button>
          )}
        </div>
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {/* Offers — amber is reserved for this block */}
          {b.offers.length > 0 && (
            <section id="offers" className="scroll-mt-20 rounded-xl border border-amber/60 bg-amber-wash p-5 shadow-(--shadow-card)">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-amber/25 text-amber-ink">
                  <Icon name="tag" />
                </span>
                <h2 className="text-lg font-bold text-amber-ink">Verified partner offers</h2>
              </div>
              <p className="mt-2 text-sm text-amber-ink/80">
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
                    <li key={o.id} className="rounded-xl border border-amber/40 bg-panel p-4 shadow-(--shadow-card)">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="display font-semibold">{o.title}</h3>
                        {pct != null && (
                          <span className="rounded-full bg-cta px-2.5 py-0.5 text-sm font-bold text-ink">
                            Save {pct}%
                          </span>
                        )}
                      </div>
                      {o.standard_price_cents != null && o.marketplace_price_cents != null ? (
                        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line">
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
                        <button className="btn mt-3"
                                onClick={() => { setBookingOffer(o.id); setBookingOpen(true); }}>
                          Book with this offer
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          <SectionCard icon="wrench" title="Services">
            {b.services.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line bg-mist/60 px-4 py-6 text-center">
                <p className="text-sm text-steel">
                  Service list not provided yet — call the shop to confirm what they handle.
                </p>
                {b.phone && (
                  <a href={`tel:${b.phone}`} className="btn-quiet mt-3 !py-2 text-sm">Call the shop</a>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-line/70">
                {b.services.map((s) => (
                  <li key={s.id} className="flex items-baseline justify-between gap-4 py-2.5">
                    <span className="font-medium">{s.service.name}</span>
                    <span className="text-sm font-semibold text-steel">
                      {s.standard_price_cents != null ? `from ${fmtUsd(s.standard_price_cents)}` : s.price_note ?? "Quote on request"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard icon="info" title="About">
            {b.description ? (
              <p className="whitespace-pre-line text-[15px] leading-relaxed text-steel">{b.description}</p>
            ) : (
              <p className="text-[15px] leading-relaxed text-steel">
                {CATEGORY_LABELS[b.category] ?? "Service"} shop
                {b.city ? ` in ${b.city}, ${b.state}` : b.state ? ` in ${b.state}` : ""}, listed in
                the YourFleet directory from our operator-curated shop map.
                {b.is_claimed
                  ? " Managed by the business on YourFleet."
                  : " Details like services, hours and photos are confirmed once the owner claims this listing — call ahead to confirm."}
              </p>
            )}
          </SectionCard>

          <SectionCard icon="star" title="Reviews"
                       right={reviews.length > 0 ? <Stars avg={b.rating_avg} count={b.rating_count} /> : undefined}>
            {reviews.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line bg-mist/60 px-4 py-6 text-center">
                <p className="text-sm text-steel">
                  No YourFleet reviews yet. Only drivers with completed bookings can review this
                  shop — so every review here is a real job.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {reviews.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line/70 bg-mist/50 p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-ink">{r.rating}★</span>
                      <span className="text-xs text-faint">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                    {r.text && <p className="mt-1.5 text-[15px] text-steel">{r.text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>

        {/* Sidebar */}
        <aside className="space-y-4 self-start">
          <div className="card overflow-hidden p-0">
            <a href={directions} target="_blank" rel="noopener noreferrer"
               aria-label={`Open directions to ${b.name}`} className="block h-44">
              <LocationMap lat={b.lat} lng={b.lng} />
            </a>
            <div className="border-t border-line/70 px-4 py-2.5 text-sm text-steel">
              {b.city ? `${b.city}, ${b.state}` : b.state} ·{" "}
              <a href={directions} target="_blank" rel="noopener noreferrer"
                 className="font-medium text-pine hover:underline">Get directions</a>
            </div>
          </div>

          <div className="rounded-xl bg-pine-dark p-5 text-white shadow-(--shadow-card)">
            <h2 className="display text-lg font-bold">Request a repair</h2>
            <p className="mt-1 text-sm text-white/75">
              Describe the problem; the shop replies with a price and time. Booking through
              YourFleet is how offer pricing is honored.
            </p>
            {canBook ? (
              <button className="btn mt-4 w-full"
                      onClick={() => { setBookingOffer(null); setBookingOpen(true); }}>
                Request repair or quote
              </button>
            ) : user ? (
              <p className="mt-3 text-sm text-white/70">Provider accounts can&apos;t book repairs.</p>
            ) : (
              <Link href={`/login?next=/business/${b.id}`} className="btn mt-4 w-full">
                Sign in to request
              </Link>
            )}
          </div>

          <div className="card p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-pine-wash text-pine">
                <Icon name="clock" className="h-4.5 w-4.5" />
              </span>
              <h2 className="font-bold">Hours</h2>
              <span className={`ml-auto text-sm font-semibold ${
                status.kind === "open" ? "text-pine" : status.kind === "closed" ? "text-danger" : "text-faint"}`}>
                {status.kind === "unknown" ? "Not verified" : status.kind === "open" ? "Open" : "Closed"}
              </span>
            </div>
            {b.hours ? (
              <table className="mt-3 w-full text-sm">
                <tbody>
                  {Object.entries(DAY_LABELS).map(([key, label]) => (
                    <tr key={key}>
                      <td className="py-0.5 pr-3 text-steel">{label}</td>
                      <td className="py-0.5 text-right font-medium">
                        {b.hours![key]?.length
                          ? b.hours![key].map((r) => r.join("–")).join(", ")
                          : "Closed"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="mt-3 text-sm text-steel">Hours not verified. Call before you drive.</p>
            )}
            <dl className="mt-3 space-y-1.5 border-t border-line/70 pt-3 text-sm">
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
                Claim this listing to manage your details, publish offers, and receive booking requests.
              </p>
              <Link href={`/provider/claim?business=${b.id}`} className="btn-quiet mt-3 w-full">
                Claim this business
              </Link>
            </div>
          )}

          <p className="px-1 text-xs text-faint">
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
          <button className="btn flex-[1.4] !py-2.5"
                  onClick={() => { setBookingOffer(null); setBookingOpen(true); }}>
            Request repair
          </button>
        ) : !user ? (
          <Link href={`/login?next=/business/${b.id}`} className="btn flex-[1.4] !py-2.5">
            Request repair
          </Link>
        ) : null}
      </div>
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
