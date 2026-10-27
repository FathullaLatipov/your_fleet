import Link from "next/link";

import { HeroTruck } from "@/components/HeroTruck";
import { HomeSearch } from "@/components/HomeSearch";
import { HomeStats } from "@/components/HomeStats";
import { Reveal } from "@/components/Reveal";
import { TopRated } from "@/components/TopRated";

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  truck_trailer: (
    <>
      <path d="M2 16V7h11v9M13 10h5l3 3v3h-3M2 16h2m3.5 0H13m4.5 0H21" />
      <path d="M6 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm9 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </>
  ),
  tire: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3v3m6.4 0.6-2.2 2.2M21 12h-3M18.4 18.4l-2.2-2.2M12 21v-3m-6.4.4 2.2-2.2M3 12h3M5.6 5.6l2.2 2.2" strokeLinecap="round" />
    </>
  ),
  towing: (
    <>
      <path d="M3 17h13l5-5v5M7 12l3-6 4 6M10 6v6" />
      <path d="M8 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm11 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
    </>
  ),
  mobile_mechanic: (
    <path d="M14.5 6.5a4 4 0 0 1 5-3.9l-2.8 2.8 2 2 2.8-2.8a4 4 0 0 1-5.2 4.9L8 17.8A2.1 2.1 0 1 1 5 14.9l7.6-7.6a4 4 0 0 1 1.9-.8Z" />
  ),
  pickup_auto: (
    <>
      <path d="M3 15v-3l2-5h10l2 5h4v3h-2M3 15h2m4 0h6m4 0h2" />
      <path d="M7 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    </>
  ),
};

const CATEGORIES = [
  { slug: "truck_trailer", name: "Truck & trailer repair", blurb: "Engine, drivetrain, suspension, frame" },
  { slug: "tire", name: "Tires", blurb: "Steer, drive and trailer tires, roadside changes" },
  { slug: "towing", name: "Towing & recovery", blurb: "Heavy wreckers and recovery" },
  { slug: "mobile_mechanic", name: "Mobile mechanics", blurb: "Repairs at your truck, on the road or in the yard" },
  { slug: "pickup_auto", name: "Pickup & auto", blurb: "Light-duty service for support vehicles" },
];

const STEPS: [title: string, body: string][] = [
  ["Search near you", "Share your location or enter a city or ZIP. Shops sorted by distance, with services, ratings and hours where they're verified."],
  ["Compare real prices", "Partner shops publish negotiated marketplace prices. Savings are shown only against a documented regular price — never invented."],
  ["Book and roll", "Send a repair or quote request. The shop answers with a price and time; you confirm. You pay the shop directly, no middleman on the money."],
];

export default function HomePage() {
  return (
    <>
      {/* Hero on charcoal-forest */}
      <section className="relative bg-charcoal bg-[radial-gradient(90rem_42rem_at_85%_-20%,#17523566,transparent)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 pb-24 pt-16 lg:grid-cols-[1fr_minmax(380px,430px)] lg:pb-28 lg:pt-24">
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
                className="inline-flex items-center rounded-lg border border-white/30 px-6 py-3 text-base font-semibold text-white transition-colors hover:border-white/70"
              >
                Join as a repair shop
              </Link>
            </div>
          </div>
          <div className="hero-rise-2">
            <HomeSearch />
          </div>
        </div>
        <HeroTruck />
        <HomeStats />
      </section>

      {/* How it works — a real 3-step sequence */}
      <section className="mx-auto max-w-6xl px-4 py-14">
        <Reveal>
          <h2 className="text-3xl font-bold">How it works</h2>
        </Reveal>
        <div className="relative mt-8">
          {/* connecting line (desktop) */}
          <div aria-hidden className="absolute left-0 right-0 top-6 hidden border-t-2 border-dashed border-line sm:block" />
          <ol className="grid gap-4 sm:grid-cols-3 sm:gap-6">
            {STEPS.map(([title, body], i) => (
              <Reveal key={title} delay={i * 120}>
                <li className="card relative h-full p-6 pt-5">
                  <span className="display absolute -top-6 left-6 grid h-12 w-12 place-items-center rounded-full border-4 border-mist bg-pine text-lg font-bold text-white">
                    {i + 1}
                  </span>
                  <h3 className="mt-6 text-xl font-semibold">{title}</h3>
                  <p className="mt-2 text-[15px] leading-relaxed text-steel">{body}</p>
                </li>
              </Reveal>
            ))}
          </ol>
        </div>
        <Reveal delay={150}>
          <p className="mt-6 max-w-[90ch] text-sm text-steel">
            Straight with you: listings marked{" "}
            <span className="rounded bg-panel px-1.5 py-0.5 text-xs font-medium shadow-[0_1px_2px_rgb(22_24_27/0.06)]">Directory listing</span>{" "}
            are imported from our shop map and not yet managed by the business. Only{" "}
            <span className="rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink">Partner</span>{" "}
            shops have agreements with YourFleet, and only admin-verified offers show prices.
          </p>
        </Reveal>
      </section>

      <TopRated />

      {/* Categories */}
      <section className="mx-auto max-w-6xl px-4 pb-16">
        <Reveal>
          <h2 className="text-3xl font-bold">What&apos;s broken?</h2>
        </Reveal>
        <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {CATEGORIES.map((c, i) => (
            <Reveal key={c.slug} delay={i * 70}>
              <Link
                href={`/search?category=${c.slug}`}
                className="group card block h-full p-5 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-pine/50 hover:shadow-(--shadow-lift)"
              >
                <span className="grid h-11 w-11 place-items-center rounded-lg bg-pine-wash text-pine transition-colors group-hover:bg-pine group-hover:text-white">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
                       strokeWidth="1.6" strokeLinejoin="round" aria-hidden>
                    {CATEGORY_ICONS[c.slug]}
                  </svg>
                </span>
                <h3 className="mt-3 font-semibold group-hover:text-pine">{c.name}</h3>
                <p className="mt-1 text-sm text-steel">{c.blurb}</p>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Provider band */}
      <section className="bg-pine-dark">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-4 py-12">
          <Reveal className="max-w-[60ch]">
            <h2 className="text-2xl font-bold text-white">Run a repair shop?</h2>
            <p className="mt-2 text-white/80">
              Your shop may already be listed. Claim it free, manage your hours and services,
              and publish marketplace offers that put your bays in front of drivers who are
              broken down nearby — you only deal with real repair requests.
            </p>
          </Reveal>
          <Reveal delay={120}>
            <Link href="/register?role=provider" className="btn text-base !px-6 !py-3">
              Claim your shop
            </Link>
          </Reveal>
        </div>
      </section>
    </>
  );
}
