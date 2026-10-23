import Link from "next/link";

import { HomeSearch } from "@/components/HomeSearch";

const CATEGORIES = [
  { slug: "truck_trailer", name: "Truck & trailer repair", blurb: "Engine, drivetrain, suspension, frame" },
  { slug: "tire", name: "Tires", blurb: "Steer, drive and trailer tires, roadside changes" },
  { slug: "towing", name: "Towing & recovery", blurb: "Heavy wreckers and recovery" },
  { slug: "mobile_mechanic", name: "Mobile mechanics", blurb: "Repairs at your truck, on the road or in the yard" },
  { slug: "pickup_auto", name: "Pickup & auto", blurb: "Light-duty service for support vehicles" },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line bg-panel">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 lg:grid-cols-[1fr_minmax(380px,440px)] lg:py-20">
          <div>
            <h1 className="text-4xl font-bold leading-tight sm:text-5xl">
              Broken down shouldn&apos;t mean ripped off.
            </h1>
            <p className="mt-4 max-w-[52ch] text-lg text-steel">
              YourFleet is a directory of 2,800+ truck repair shops across the US, plus
              negotiated marketplace prices from verified partner shops. Search near you,
              compare real offers, request a quote, and book.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/search" className="btn text-base !px-6 !py-3">
                Find truck repair
              </Link>
              <Link href="/register?role=provider" className="btn-quiet text-base !px-6 !py-3">
                Join as a repair shop
              </Link>
            </div>
          </div>
          <HomeSearch />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12">
        <h2 className="text-2xl font-bold">How it works</h2>
        <ol className="mt-6 grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-3">
          {[
            ["Search near you", "Share your location or enter a city or ZIP. See shops sorted by distance, with services, hours and ratings where they're verified."],
            ["Compare real offers", "Partner shops publish negotiated marketplace prices. Savings are shown only when the shop has documented its regular price."],
            ["Request and book", "Send a repair request or quote request. The shop responds with a price and time; you confirm. You pay the shop directly."],
          ].map(([title, body], i) => (
            <li key={title} className="bg-panel p-5">
              <p className="font-display text-sm font-semibold text-pine">Step {i + 1}</p>
              <h3 className="mt-1 text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-[15px] text-steel">{body}</p>
            </li>
          ))}
        </ol>
        <p className="mt-4 text-sm text-steel">
          Listings marked <span className="rounded bg-mist px-1 py-0.5 text-xs">Directory listing</span> come
          from our imported shop map and aren&apos;t yet managed by the business. Only{" "}
          <span className="rounded bg-amber-wash px-1 py-0.5 text-xs font-semibold text-amber-ink">Partner</span>{" "}
          shops have agreements with YourFleet, and only verified offers show prices.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="text-2xl font-bold">Service categories</h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
          {CATEGORIES.map((c) => (
            <Link
              key={c.slug}
              href={`/search?category=${c.slug}`}
              className="group bg-panel p-5 hover:bg-pine-wash"
            >
              <h3 className="font-semibold group-hover:text-pine">{c.name}</h3>
              <p className="mt-1 text-sm text-steel">{c.blurb}</p>
            </Link>
          ))}
        </div>
      </section>
    </>
  );
}
