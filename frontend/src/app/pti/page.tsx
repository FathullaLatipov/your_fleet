"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const MEDIA = process.env.NEXT_PUBLIC_API_URL ?? "";

interface PtiItem { key: string; label: string; status: string; note: string; photos?: string[] }
interface Pti {
  id: string;
  vehicle_id: string | null;
  unit_number: string | null;
  driver_name: string | null;
  inspection_type: string;
  result: "pass" | "fail";
  defect_count: number;
  items: PtiItem[];
  performed_at: string;
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-US",
    { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function PtiCard({ p }: { p: Pti }) {
  const [open, setOpen] = useState(false);
  const defects = p.items.filter((i) => i.status === "defect");
  return (
    <div className="card p-4">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-3 text-left">
        <span className="flex min-w-0 items-center gap-3">
          {p.vehicle_id ? (
            <Link href={`/fleet/${p.vehicle_id}`} onClick={(e) => e.stopPropagation()}
                  className="rounded bg-mist px-2 py-0.5 text-sm font-bold text-steel hover:text-ink">
              #{p.unit_number}
            </Link>
          ) : <span className="rounded bg-mist px-2 py-0.5 text-sm font-bold text-steel">#{p.unit_number ?? "—"}</span>}
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{p.driver_name ?? "Driver"}</span>
            <span className="block text-xs text-faint">
              {p.inspection_type === "post" ? "Post-trip" : "Pre-trip"} · {fmt(p.performed_at)}
            </span>
          </span>
        </span>
        <span className="shrink-0">
          {p.result === "pass" ? (
            <span className="rounded-full bg-pine-wash px-2.5 py-0.5 text-xs font-semibold text-pine">Passed</span>
          ) : (
            <span className="rounded-full bg-danger-wash px-2.5 py-0.5 text-xs font-semibold text-danger">
              {p.defect_count} defect{p.defect_count === 1 ? "" : "s"}
            </span>
          )}
        </span>
      </button>
      {open && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3 text-sm">
          {p.items.map((i) => (
            <li key={i.key}>
              <div className="flex items-start justify-between gap-3">
                <span className="min-w-0">
                  <span className={i.status === "defect" ? "font-medium text-danger" : "text-ink"}>{i.label}</span>
                  {i.note && <span className="block text-xs text-steel">{i.note}</span>}
                </span>
                <span className="shrink-0 text-xs font-semibold">
                  {i.status === "defect" ? <span className="text-danger">⚠️ Defect</span>
                    : i.status === "skipped" ? <span className="text-faint">Skipped</span>
                    : <span className="text-pine">✓ OK</span>}
                </span>
              </div>
              {i.photos && i.photos.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {i.photos.map((ph, n) => (
                    <a key={n} href={`${MEDIA}${ph}`} target="_blank" rel="noopener noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`${MEDIA}${ph}`} alt="" className="h-16 w-16 rounded-md object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PtiInner() {
  const { user } = useAuth();
  const [list, setList] = useState<Pti[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<Pti[]>("/api/fleet/pti").then((d) => { setList(d); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);
  useEffect(() => { if (user) load(); }, [user, load]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display text-2xl font-bold">Pre-trip inspections</h2>
          <p className="mt-1 text-sm text-steel">
            Submitted by drivers via Telegram. Set it up in{" "}
            <Link href="/profile" className="font-semibold text-pine hover:underline">Profile → Driver PTI</Link>.
          </p>
        </div>
      </div>

      {error ? (
        <div className="card mt-5 p-6">
          <p className="font-semibold text-danger">{error}</p>
          <button className="btn-quiet mt-3 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      ) : list === null ? (
        <div className="mt-6"><Loader /></div>
      ) : list.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-12 text-center text-sm text-steel">
          No inspections yet. Invite a driver from{" "}
          <Link href="/profile" className="font-semibold text-pine hover:underline">Profile → Driver PTI</Link>.
        </p>
      ) : (
        <div className="mt-5 space-y-2.5">
          {list.map((p) => <PtiCard key={p.id} p={p} />)}
        </div>
      )}
    </div>
  );
}

export default function PtiPage() {
  return (
    <AppShell title="Pre-trip inspections">
      <PtiInner />
    </AppShell>
  );
}
