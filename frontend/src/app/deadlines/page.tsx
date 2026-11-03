"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/deadlines. */
type DeadlineKind =
  | "maintenance" | "vehicle_insurance" | "vehicle_inspection"
  | "trailer_inspection" | "trailer_registration" | "driver_cdl" | "driver_medical";

interface Deadline {
  kind: DeadlineKind;
  label: string;
  ref: string;
  href_id: string;
  status: "overdue" | "due_soon" | "upcoming";
  days_left: number | null;
  miles_left: number | null;
}

const KIND_CHIP: Record<DeadlineKind, string> = {
  maintenance: "Maintenance",
  vehicle_insurance: "Insurance",
  vehicle_inspection: "Inspection",
  trailer_inspection: "Inspection",
  trailer_registration: "Registration",
  driver_cdl: "CDL",
  driver_medical: "Medical card",
};

function hrefFor(d: Deadline): string {
  if (d.kind === "maintenance" || d.kind.startsWith("vehicle_")) return `/fleet/${d.href_id}`;
  if (d.kind.startsWith("trailer_")) return "/trailers";
  return "/drivers";
}

function timeChip(d: Deadline): string {
  if (d.days_left != null) {
    if (d.status === "overdue") return `${Math.abs(Math.round(d.days_left))}d overdue`;
    return `in ${Math.round(d.days_left)}d`;
  }
  if (d.miles_left != null) {
    if (d.status === "overdue" && d.miles_left < 0) {
      return `${Math.abs(Math.round(d.miles_left)).toLocaleString()} mi over`;
    }
    return `${Math.round(d.miles_left).toLocaleString()} mi left`;
  }
  return d.status === "overdue" ? "Overdue" : "Due soon";
}

function DeadlineGroup({
  title, sub, rows, headCls, chipCls,
}: {
  title: string;
  sub: string;
  rows: Deadline[];
  headCls: string;
  chipCls: string;
}) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2.5">
        <h2 className={`text-lg font-bold ${headCls}`}>{title}</h2>
        <span className="rounded-full bg-mist px-2.5 py-0.5 text-sm font-semibold text-steel">
          {rows.length}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-steel">{sub}</p>
      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-5 text-center text-sm text-steel">
          Nothing here.
        </p>
      ) : (
        <ul className="-mx-2 mt-3 space-y-0.5">
          {rows.map((d, i) => (
            <li key={`${d.kind}-${d.href_id}-${i}`}>
              <Link href={hrefFor(d)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2.5 transition-colors hover:bg-mist">
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">
                    {KIND_CHIP[d.kind] ?? d.kind}
                  </span>
                  <span className="truncate text-sm font-medium">{d.label}</span>
                  <span className="text-sm text-faint">{d.ref}</span>
                </span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular-nums ${chipCls}`}>
                  {timeChip(d)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeadlinesInner() {
  const { user } = useAuth();
  const [deadlines, setDeadlines] = useState<Deadline[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Deadline[]>("/api/fleet/deadlines").then(setDeadlines)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (error && deadlines === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your deadlines.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (deadlines === null) return <Loader />;

  const overdue = deadlines.filter((d) => d.status === "overdue");
  const dueSoon = deadlines.filter((d) => d.status === "due_soon");
  const upcoming = deadlines.filter((d) => d.status === "upcoming");

  if (deadlines.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line bg-panel px-4 py-14 text-center">
          <p className="display text-2xl font-bold">All clear 🎉</p>
          <p className="max-w-[44ch] text-sm text-steel">
            No maintenance, insurance, inspection, registration, CDL or medical-card deadlines
            on the horizon. Your paperwork is in order.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-6 sm:px-6">
      <DeadlineGroup
        title="Overdue"
        sub="Already past due — handle these first."
        rows={overdue}
        headCls="text-danger"
        chipCls="bg-danger-wash text-danger"
      />
      <DeadlineGroup
        title="Due soon"
        sub="Coming up within 30 days."
        rows={dueSoon}
        headCls="text-amber-ink"
        chipCls="bg-amber-wash text-amber-ink"
      />
      <DeadlineGroup
        title="Upcoming"
        sub="On the radar — within 90 days."
        rows={upcoming}
        headCls="text-steel"
        chipCls="bg-mist text-steel"
      />
    </div>
  );
}

export default function DeadlinesPage() {
  return (
    <AppShell title="Deadlines">
      <DeadlinesInner />
    </AppShell>
  );
}
