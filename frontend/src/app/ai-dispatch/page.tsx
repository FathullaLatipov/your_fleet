"use client";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";

export default function AiDispatchPage() {
  return (
    <AppShell title="AI Dispatch">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <section className="card p-6">
          <span className="rounded border border-cta/50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-cta">
            Coming soon
          </span>
          <h2 className="mt-3 text-xl font-bold">The agent that calls shops for you</h2>
          <p className="mt-2 text-sm text-steel">
            AI Dispatch will pick up the problem from a work order, call nearby shops
            at the same time, collect their quotes and bring back the best price for
            your approval — so finding a bay stops being twenty phone calls.
          </p>
          <ol className="mt-5 space-y-3 text-sm">
            {[
              ["Reads the work order", "Problem, truck, location — no retyping."],
              ["Calls 5–7 shops at once", "Asks for a bay and the price, parts and labor."],
              ["Brings back quotes", "You see every price and availability side by side."],
              ["You approve, it books", "The shop gets the job, the driver gets directions."],
            ].map(([t, s], i) => (
              <li key={t} className="flex gap-3">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cta/10 text-xs font-bold text-cta">
                  {i + 1}
                </span>
                <span><span className="font-semibold">{t}.</span> <span className="text-steel">{s}</span></span>
              </li>
            ))}
          </ol>
          <div className="mt-6 rounded-lg border border-dashed border-line bg-mist/50 p-4 text-sm text-steel">
            Until then the same flow works by hand: open a work order, pick shops on the
            map and record the quotes you collect — approval, booking and closing with an
            invoice already work today.
          </div>
          <Link href="/work-orders" className="btn mt-5 inline-block !py-2 text-sm">
            Open Work orders
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
