"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/badges";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/issues. */
interface Issue {
  id: string;
  vehicle_id: string;
  unit_number: string;
  defect_type: string;
  comment: string | null;
  severity: string | null;
  status: "open" | "in_repair" | "resolved";
  source: string;
  reported_at: string;
  resolved_at: string | null;
  booking_id: string | null;
  suggested_service_slug: string | null;
}

const FILTERS: [string, string][] = [
  ["active", "Active"],
  ["open", "Open"],
  ["in_repair", "In repair"],
  ["resolved", "Resolved"],
  ["all", "All"],
];

function IssuesInner() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("active");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Issue[]>("/api/fleet/issues", { params: { status: filter } })
      .then(setIssues)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [filter]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (error && issues === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your issues.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map(([val, label]) => (
          <button key={val} className="chip" data-on={filter === val}
                  onClick={() => { setIssues(null); setFilter(val); }}>
            {label}
          </button>
        ))}
      </div>

      {issues === null ? (
        <Loader />
      ) : (
        <section className="card mt-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Issues</h2>
              <p className="mt-0.5 text-sm text-steel">
                {issues.length} issue{issues.length === 1 ? "" : "s"} — PTI defects and reported
                problems across the fleet. Report new ones from a truck&apos;s page.
              </p>
            </div>
          </div>

          {issues.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
              {filter === "resolved"
                ? "Nothing resolved yet."
                : "No issues here — that's how we like it."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/70">
              {issues.map((i) => (
                <li key={i.id} className="py-3.5">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Link href={`/fleet/${i.vehicle_id}`}
                          className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel hover:text-ink">
                      #{i.unit_number}
                    </Link>
                    <p className="font-semibold">{i.defect_type}</p>
                    {i.severity && (
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        i.severity === "major" ? "bg-danger-wash text-danger" : "bg-amber-wash text-amber-ink"
                      }`}>
                        {i.severity}
                      </span>
                    )}
                    <StatusBadge status={i.status} />
                  </div>
                  {i.comment && <p className="mt-1 text-sm text-steel">{i.comment}</p>}
                  <p className="mt-1 text-xs text-faint">
                    {i.source === "samsara_dvir" ? "From Samsara DVIR" : "Manual"} ·{" "}
                    reported {new Date(i.reported_at).toLocaleDateString()}
                    {i.resolved_at && <> · resolved {new Date(i.resolved_at).toLocaleDateString()}</>}
                  </p>
                  {(i.status === "open" || i.booking_id) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {i.status === "open" && (
                        <Link href={`/fleet/${i.vehicle_id}`} className="btn !py-1.5 text-sm">
                          Find shops &amp; prices
                        </Link>
                      )}
                      {i.booking_id && (
                        <Link href={`/bookings/${i.booking_id}`} className="btn-quiet !py-1.5 text-sm">
                          View booking
                        </Link>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export default function IssuesPage() {
  return (
    <AppShell title="Issues">
      <IssuesInner />
    </AppShell>
  );
}
