"use client";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";

export default function WorkOrdersMobilePage() {
  return (
    <AppShell title="Work orders · Mobile app">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <section className="card p-6">
          <span className="rounded border border-cta/50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-cta">
            Coming soon
          </span>
          <h2 className="mt-3 text-xl font-bold">Repair requests from the driver app</h2>
          <p className="mt-2 text-sm text-steel">
            Drivers will open a work order straight from their phone: pick the truck,
            describe the problem, attach photos — and it lands here with the truck,
            the location and the driver already filled in. Status updates go back to
            the driver as push notifications.
          </p>
          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              "Report a problem with photos in under a minute",
              "The work order opens in this console automatically",
              "Driver sees the booked shop, address and directions",
              "Push updates at every status change",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />
                <span className="text-steel">{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-lg border border-dashed border-line bg-mist/50 p-4 text-sm text-steel">
            Until the app ships, open requests for your drivers manually — the flow
            from quote to invoice already works.
          </div>
          <Link href="/work-orders/new" className="btn mt-5 inline-block !py-2 text-sm">
            Create Request manually
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
