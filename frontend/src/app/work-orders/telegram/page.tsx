"use client";

import Link from "next/link";

import { AppShell } from "@/components/AppShell";

export default function WorkOrdersTelegramPage() {
  return (
    <AppShell title="Work orders · Telegram">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6">
        <section className="card p-6">
          <span className="rounded border border-cta/50 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-cta">
            Coming soon
          </span>
          <h2 className="mt-3 text-xl font-bold">Repair requests from a Telegram group</h2>
          <p className="mt-2 text-sm text-steel">
            A YourFleet bot joins your drivers&apos; Telegram group. When a driver writes
            &quot;truck 101, left steer losing air&quot; and drops a photo, the bot turns it
            into a work order here — no app installs, the chat your drivers already
            use keeps working.
          </p>
          <ul className="mt-5 space-y-2.5 text-sm">
            {[
              "Message + photos in the group become a work order",
              "The bot asks the driver what's missing (which truck, can it move)",
              "Booking confirmation and shop address go back to the chat",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cta" />
                <span className="text-steel">{t}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 rounded-lg border border-dashed border-line bg-mist/50 p-4 text-sm text-steel">
            Until the bot is connected, log what drivers report in the chat as a manual
            request — it takes under a minute.
          </div>
          <Link href="/work-orders/new" className="btn mt-5 inline-block !py-2 text-sm">
            Create Request manually
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
