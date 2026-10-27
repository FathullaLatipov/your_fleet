"use client";

import { useEffect, useRef, useState } from "react";

import { api } from "@/lib/api";
import { fmtUsd } from "@/lib/types";

/* Count-up number: animates 0 -> value once (skipped for reduced motion). */
function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const t0 = performance.now();
    const dur = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      setShown(Math.round(value * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format(shown)}</>;
}

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

  const items: [number, (n: number) => string, string][] = [
    [stats.businesses, (n) => n.toLocaleString(), "shops listed"],
    [stats.states, (n) => String(n), "states covered"],
  ];
  if (stats.partners > 0) items.push([stats.partners, (n) => String(n), "verified partners"]);
  if (stats.completed_bookings > 0)
    items.push([stats.completed_bookings, (n) => n.toLocaleString(), "repairs booked"]);
  if (stats.driver_savings_cents > 0)
    items.push([stats.driver_savings_cents, (n) => fmtUsd(n), "saved by drivers"]);

  return (
    <div className="border-t border-white/10">
      <dl className="mx-auto flex max-w-6xl flex-wrap gap-x-12 gap-y-3 px-4 py-5">
        {items.map(([value, format, label]) => (
          <div key={label} className="flex items-baseline gap-2">
            <dd className="display text-2xl font-bold tabular-nums text-white">
              <CountUp value={value} format={format} />
            </dd>
            <dt className="text-sm text-white/60">{label}</dt>
          </div>
        ))}
      </dl>
    </div>
  );
}
