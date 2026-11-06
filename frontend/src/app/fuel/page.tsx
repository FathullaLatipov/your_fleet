"use client";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";

export default function FuelPage() {
  return (
    <AppShell title="Fuel">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <section className="card p-6">
          <span className="rounded border border-cta/50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-cta">
            Coming soon
          </span>
          <h2 className="mt-3 text-xl font-bold">Fuel, by truck and driver</h2>
          <p className="mt-2 text-sm text-steel">
            Once a fuel card provider (WEX, Comdata, EFS) is connected, every fill-up
            lands here automatically: gallons, price, location, the truck and the
            driver — with cost per mile next to your repairs and loans, and the data
            ready for IFTA.
          </p>
          <div className="mt-5 rounded-lg border border-dashed border-line bg-mist/50 p-4 text-sm text-steel">
            Until then, fuel receipts can be logged as expenses on each truck —
            they count into the cost ledger and monthly totals.
          </div>
          <Link href="/expenses" className="btn mt-5 inline-block !py-2 text-sm">
            Log fuel as an expense
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
