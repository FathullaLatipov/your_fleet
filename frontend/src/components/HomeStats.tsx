"use client";

import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { fmtUsd } from "@/lib/types";

interface PublicStats {
  businesses: number;
  partners: number;
  states: number;
  completed_bookings: number;
  driver_savings_cents: number;
}

/* Social proof strip — every figure comes from the live database.
   Items render only when their real value is meaningful (no fabricated numbers). */
export function HomeStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);

  useEffect(() => {
    api<PublicStats>("/api/stats/public").then(setStats).catch(() => {});
  }, []);

  if (!stats) return <div className="h-[72px] border-t border-white/10" aria-hidden />;

  const items: [string, string][] = [
    [stats.businesses.toLocaleString(), "shops listed"],
    [String(stats.states), "states covered"],
  ];
  if (stats.partners > 0) items.push([String(stats.partners), "verified partners"]);
  if (stats.completed_bookings > 0) items.push([stats.completed_bookings.toLocaleString(), "repairs booked"]);
  if (stats.driver_savings_cents > 0) items.push([fmtUsd(stats.driver_savings_cents), "saved by drivers"]);

  return (
    <div className="border-t border-white/10">
      <dl className="mx-auto flex max-w-6xl flex-wrap gap-x-12 gap-y-3 px-4 py-5">
        {items.map(([value, label]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dd className="display text-2xl font-bold text-white">{value}</dd>
            <dt className="text-sm text-white/60">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
