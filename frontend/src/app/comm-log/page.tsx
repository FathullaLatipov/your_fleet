"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/comm-log. */
type EntryKind = "call" | "email" | "text" | "note";

interface CommEntry {
  id: string;
  kind: EntryKind;
  subject: string;
  body: string | null;
  contact_name: string | null;
  vehicle_id: string | null;
  unit_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  booking_id: string | null;
  happened_at: string;
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

interface DriverOpt {
  id: string;
  name: string;
}

/* 24px stroke glyphs, consistent with the brand icon set. */
const KIND_ICONS: Record<EntryKind, React.ReactNode> = {
  call: (
    <path d="M5 4h4l1.5 4.5L8 10a12 12 0 0 0 6 6l1.5-2.5L20 15v4a1.5 1.5 0 0 1-1.7 1.5C10.5 19.6 4.4 13.5 3.5 5.7A1.5 1.5 0 0 1 5 4Z" strokeLinejoin="round" />
  ),
  email: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" strokeLinecap="round" />
    </>
  ),
  text: (
    <path d="M4 5.5h16v10.5h-9l-4.5 3.5v-3.5H4V5.5Z" strokeLinejoin="round" />
  ),
  note: (
    <>
      <path d="M6 3.5h12v17H6v-17Z" strokeLinejoin="round" />
      <path d="M9 8h6M9 11.5h6M9 15h4" strokeLinecap="round" />
    </>
  ),
};

const KIND_LABEL: Record<EntryKind, string> = {
  call: "Call",
  email: "Email",
  text: "Text",
  note: "Note",
};

function KindChip({ kind }: { kind: EntryKind }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-pine-wash px-2.5 py-0.5 text-xs font-semibold text-pine">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor"
           strokeWidth="1.7" aria-hidden>
        {KIND_ICONS[kind]}
      </svg>
      {KIND_LABEL[kind]}
    </span>
  );
}

/* Current time as a datetime-local value (local timezone). */
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function CommLogInner() {
  const { user } = useAuth();
  const [entries, setEntries] = useState<CommEntry[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    kind: "call", subject: "", body: "", contact_name: "", vehicle_id: "", driver_id: "",
    happened: nowLocal(),
  });

  const load = useCallback(() => {
    setError(null);
    api<CommEntry[]>("/api/fleet/comm-log", { params: { limit: 100 } })
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    api<VehicleOpt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
    api<DriverOpt[]>("/api/fleet/drivers").then(setDrivers).catch(() => {});
  }, [user, load]);

  async function addEntry(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionErr(null);
    try {
      await api("/api/fleet/comm-log", {
        method: "POST",
        body: {
          kind: form.kind,
          subject: form.subject.trim(),
          body: form.body || null,
          contact_name: form.contact_name || null,
          vehicle_id: form.vehicle_id || null,
          driver_id: form.driver_id || null,
          happened_at: form.happened ? new Date(form.happened).toISOString() : null,
        },
      });
      setForm({ kind: "call", subject: "", body: "", contact_name: "", vehicle_id: "",
                driver_id: "", happened: nowLocal() });
      setAddOpen(false);
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Failed to log entry");
    } finally {
      setBusy(false);
    }
  }

  async function remove(entry: CommEntry) {
    if (!window.confirm(`Delete "${entry.subject}" from the log?`)) return;
    setActionErr(null);
    try {
      await api(`/api/fleet/comm-log/${entry.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (error && entries === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load the comm log.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (entries === null) return <Loader />;

  // Group entries by calendar day, newest first (API order preserved inside a day).
  const byDay: [string, CommEntry[]][] = [];
  for (const entry of entries) {
    const day = new Date(entry.happened_at).toLocaleDateString();
    const last = byDay[byDay.length - 1];
    if (last && last[0] === day) last[1].push(entry);
    else byDay.push([day, [entry]]);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Comm log</h2>
            <p className="mt-0.5 text-sm text-steel">
              Calls, emails, texts and notes — the paper trail for shops, drivers and brokers.
            </p>
          </div>
          <button className="btn !py-2 text-sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? "Close" : "+ Log an entry"}
          </button>
        </div>

        {addOpen && (
          <form onSubmit={addEntry}
                className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="cl-kind">Kind</label>
              <select id="cl-kind" className="field mt-1" value={form.kind}
                      onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="call">Call</option>
                <option value="email">Email</option>
                <option value="text">Text</option>
                <option value="note">Note</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm font-medium text-steel" htmlFor="cl-subject">Subject *</label>
              <input id="cl-subject" required className="field mt-1" placeholder="e.g. Quote follow-up with Joe's Truck Repair"
                     value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <label className="text-sm font-medium text-steel" htmlFor="cl-body">What was said</label>
              <textarea id="cl-body" className="field mt-1" value={form.body}
                        onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="cl-contact">Contact name</label>
              <input id="cl-contact" className="field mt-1" value={form.contact_name}
                     onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
            </div>
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="cl-truck">Truck</label>
              <select id="cl-truck" className="field mt-1" value={form.vehicle_id}
                      onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
                <option value="">—</option>
                {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="cl-driver">Driver</label>
              <select id="cl-driver" className="field mt-1" value={form.driver_id}
                      onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
                <option value="">—</option>
                {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="cl-when">When</label>
              <input id="cl-when" type="datetime-local" className="field mt-1" value={form.happened}
                     onChange={(e) => setForm({ ...form, happened: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <button className="btn" disabled={busy}>{busy ? "Logging…" : "Log entry"}</button>
            </div>
          </form>
        )}

        {actionErr && <p className="mt-3 text-sm font-medium text-danger">{actionErr}</p>}

        {entries.length === 0 && !addOpen ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
            Nothing logged yet — record a call or a note and build the paper trail.
          </p>
        ) : (
          <div className="mt-4 space-y-5">
            {byDay.map(([day, dayEntries]) => (
              <div key={day}>
                <p className="text-xs font-semibold uppercase tracking-wide text-faint">{day}</p>
                <ul className="mt-1.5 divide-y divide-line/70">
                  {dayEntries.map((entry) => (
                    <li key={entry.id} className="py-3">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <KindChip kind={entry.kind} />
                        <p className="min-w-0 flex-1 font-semibold">{entry.subject}</p>
                        <span className="text-xs tabular-nums text-faint">
                          {new Date(entry.happened_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                        </span>
                        <button className="btn-danger !px-3 !py-1 text-xs" onClick={() => void remove(entry)}>
                          Delete
                        </button>
                      </div>
                      {entry.body && <p className="mt-1 text-sm text-steel">{entry.body}</p>}
                      {(entry.contact_name || entry.unit_number || entry.driver_name) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {entry.contact_name && (
                            <span className="text-sm text-steel">{entry.contact_name}</span>
                          )}
                          {entry.unit_number && (
                            <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">
                              #{entry.unit_number}
                            </span>
                          )}
                          {entry.driver_name && (
                            <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">
                              {entry.driver_name}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export default function CommLogPage() {
  return (
    <AppShell title="Comm log">
      <CommLogInner />
    </AppShell>
  );
}
