import Link from "next/link";

import { HomeSearch } from "@/components/HomeSearch";
import { HomeStats } from "@/components/HomeStats";

const CATEGORIES = [
  { slug: "truck_trailer", name: "Truck & trailer repair", blurb: "Engine, drivetrain, suspension, frame" },
  { slug: "tire", name: "Tires", blurb: "Steer, drive and trailer tires, roadside changes" },
  { slug: "towing", name: "Towing & recovery", blurb: "Heavy wreckers and recovery" },
  { slug: "mobile_mechanic", name: "Mobile mechanics", blurb: "Repairs at your truck, on the road or in the yard" },
  { slug: "pickup_auto", name: "Pickup & auto", blurb: "Light-duty service for support vehicles" },
];

const STEP_ICONS = [
  // crosshair / locate
  <svg key="1" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22" strokeLinecap="round" />
  </svg>,
  // price tag
  <svg key="2" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M3.5 12.5 11 20l9-9V4h-7l-9.5 8.5Z" strokeLinejoin="round" />
    <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" />
  </svg>,
  // wrench
  <svg key="3" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
    <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z" strokeLinejoin="round" />
  </svg>,
];

export default function HomePage() {
  return (
    <>
      {/* Hero on charcoal-forest */}
      <section className="bg-charcoal bg-[radial-gradient(90rem_42rem_at_85%_-20%,#17523566,transparent)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 lg:grid-cols-[1fr_minmax(380px,430px)] lg:py-24">
          <div className="hero-rise self-center">
            <p className="display text-sm font-semibold tracking-wide text-amber">
              2,800+ truck repair shops across 48 states
            </p>
            <h1 className="mt-3 text-4xl font-bold leading-[1.05] text-white sm:text-[3.4rem]">
              Breakdowns happen.
              <br />
              Getting ripped off shouldn&apos;t.
            </h1>
            <p className="mt-5 max-w-[50ch] text-lg text-white/75">
              Find nearby shops with real ratings and hours. Partner shops publish
              negotiated marketplace prices — below what you&apos;d pay walking in the door.
              Book through YourFleet, pay the shop directly.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/search" className="btn text-base !px-6 !py-3">
                Find truck repair
              </Link>
              <Link
                href="/register?role=provider"
                className="inline-flex items-center rounded-md border border-white/30 px-6 py-3 text-base font-semibold text-white transition-colors hover:border-white/70"
              >
                Join as a repair shop
              </Link>
            </div>
          </div>
          <div className="hero-rise-2">
            <HomeSearch />
          </div>
        </div>
        <HomeStats />
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <h2 className="text-3xl font-bold">How it works</h2>
        <ol className="mt-7 grid gap-4 sm:grid-cols-3">
          {[
            ["Search near you", "Share your location or enter a city or ZIP. Shops sorted by distance, with services, ratings and hours where they're verified."],
            ["Compare real prices", "Partner shops publish negotiated marketplace prices. Savings are shown only against a documented regular price — never invented."],
            ["Book and roll", "Send a repair or quote request. The shop answers with a price and time; you confirm. You pay the shop directly, no middleman on the money."],
          ].map(([title, body], i) => (
            <li key={title} className="rounded-lg border border-line bg-panel p-6">
              <span className="inline-grid h-12 w-12 place-items-center rounded-md bg-pine-wash text-pine">
                {STEP_ICONS[i]}
              </span>
              <h3 className="mt-4 text-xl font-semibold">{title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-steel">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-5 max-w-[90ch] text-sm text-steel">
          Straight with you: listings marked{" "}
          <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-medium">Directory listing</span>{" "}
          are imported from our shop map and not yet managed by the business. Only{" "}
          <span className="rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink">Partner</span>{" "}
          shops have agreements with YourFleet, and only admin-verified offers show prices.
        </p>
      </section>

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4 pb-14">
        <h2 className="text-3xl font-bold">What&apos;s broken?</h2>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/search?category=${c.slug}`}
              className="group rounded-lg border border-line bg-panel p-5 transition-[border-color,box-shadow] hover:border-pine hover:shadow-[0_2px_10px_rgb(23_82_53/0.12)]"
            >
              <h3 className="font-semibold group-hover:text-pine">{c.name}</h3>
              <p className="mt-1 text-sm text-steel">{c.blurb}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Provider band */}
      <section className="bg-pine-dark">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-12">
          <div className="max-w-[60ch]">
            <h2 className="text-2xl font-bold text-white">Run a repair shop?</h2>
            <p className="mt-2 text-white/80">
              Your shop may already be listed. Claim it free, manage your hours and services,
              and publish marketplace offers that put your bays in front of drivers who are
              broken down nearby — you only deal with real repair requests.
            </p>
          </div>
          <Link href="/register?role=provider" className="btn text-base !px-6 !py-3">
            Claim your shop
          </Link>
        </div>
      </section>
    </>
  );
}
