"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/tasks. */
interface Task {
  id: string;
  title: string;
  details: string | null;
  priority: "low" | "medium" | "high";
  status: "open" | "in_progress" | "done";
  due_at: string | null;
  vehicle_id: string | null;
  unit_number: string | null;
  driver_id: string | null;
  driver_name: string | null;
  created_at: string;
  completed_at: string | null;
  overdue: boolean;
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

interface DriverOpt {
  id: string;
  name: string;
}

const FILTERS: [string, string][] = [
  ["active", "Active"],
  ["done", "Done"],
  ["all", "All"],
];

const PRIORITY_PILL: Record<string, [string, string]> = {
  high: ["High", "bg-danger-wash text-danger"],
  medium: ["Medium", "bg-amber-wash text-amber-ink"],
  low: ["Low", "bg-mist text-steel"],
};

const shortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

function TasksInner() {
  const { user } = useAuth();
  const [filter, setFilter] = useState("active");
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [drivers, setDrivers] = useState<DriverOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    title: "", details: "", priority: "medium", due: "", vehicle_id: "", driver_id: "",
  });

  const load = useCallback(() => {
    setError(null);
    api<Task[]>("/api/fleet/tasks", { params: filter === "all" ? {} : { status: filter } })
      .then(setTasks)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [filter]);

  useEffect(() => {
    if (!user) return;
    load();
  }, [user, load]);

  useEffect(() => {
    if (!user) return;
    api<VehicleOpt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
    api<DriverOpt[]>("/api/fleet/drivers").then(setDrivers).catch(() => {});
  }, [user]);

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionErr(null);
    try {
      await api("/api/fleet/tasks", {
        method: "POST",
        body: {
          title: form.title.trim(),
          details: form.details || null,
          priority: form.priority,
          due_at: form.due ? new Date(form.due).toISOString() : null,
          vehicle_id: form.vehicle_id || null,
          driver_id: form.driver_id || null,
        },
      });
      setForm({ title: "", details: "", priority: "medium", due: "", vehicle_id: "", driver_id: "" });
      setAddOpen(false);
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Failed to add task");
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(t: Task, status: string) {
    setActionErr(null);
    try {
      await api(`/api/fleet/tasks/${t.id}`, { method: "PATCH", body: { status } });
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Update failed");
    }
  }

  async function remove(t: Task) {
    if (!window.confirm(`Delete task "${t.title}"?`)) return;
    setActionErr(null);
    try {
      await api(`/api/fleet/tasks/${t.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Delete failed");
    }
  }

  if (error && tasks === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your tasks.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }

  const openCount = tasks?.filter((t) => t.status !== "done").length ?? 0;
  const overdueCount = tasks?.filter((t) => t.overdue && t.status !== "done").length ?? 0;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map(([val, label]) => (
            <button key={val} className="chip" data-on={filter === val}
                    onClick={() => { setTasks(null); setFilter(val); }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-steel">
            <strong className="display text-lg text-ink">{openCount}</strong> open
          </span>
          <span className={overdueCount > 0 ? "font-semibold text-danger" : "text-steel"}>
            <strong className={`display text-lg ${overdueCount > 0 ? "text-danger" : "text-ink"}`}>{overdueCount}</strong> overdue
          </span>
        </div>
      </div>

      {tasks === null ? (
        <Loader />
      ) : (
        <section className="card mt-5 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold">Tasks</h2>
              <p className="mt-0.5 text-sm text-steel">
                To-dos for the fleet — link them to a truck or a driver so nothing slips.
              </p>
            </div>
            <button className="btn !py-2 text-sm" onClick={() => setAddOpen(!addOpen)}>
              {addOpen ? "Close" : "+ Add task"}
            </button>
          </div>

          {addOpen && (
            <form onSubmit={addTask}
                  className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <label className="text-sm font-medium text-steel" htmlFor="tk-title">Task *</label>
                <input id="tk-title" required className="field mt-1" placeholder="e.g. Renew IFTA sticker"
                       value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="tk-pri">Priority</label>
                <select id="tk-pri" className="field mt-1" value={form.priority}
                        onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div className="sm:col-span-3">
                <label className="text-sm font-medium text-steel" htmlFor="tk-det">Details</label>
                <textarea id="tk-det" className="field mt-1" value={form.details}
                          onChange={(e) => setForm({ ...form, details: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="tk-due">Due</label>
                <input id="tk-due" type="datetime-local" className="field mt-1" value={form.due}
                       onChange={(e) => setForm({ ...form, due: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="tk-truck">Truck</label>
                <select id="tk-truck" className="field mt-1" value={form.vehicle_id}
                        onChange={(e) => setForm({ ...form, vehicle_id: e.target.value })}>
                  <option value="">—</option>
                  {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-steel" htmlFor="tk-driver">Driver</label>
                <select id="tk-driver" className="field mt-1" value={form.driver_id}
                        onChange={(e) => setForm({ ...form, driver_id: e.target.value })}>
                  <option value="">—</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="sm:col-span-3">
                <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add task"}</button>
              </div>
            </form>
          )}

          {actionErr && <p className="mt-3 text-sm font-medium text-danger">{actionErr}</p>}

          {tasks.length === 0 && !addOpen ? (
            <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
              {filter === "done" ? "Nothing finished yet." : "No tasks — enjoy the quiet, or add one above."}
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line/70">
              {tasks.map((t) => {
                const [pLabel, pCls] = PRIORITY_PILL[t.priority] ?? PRIORITY_PILL.medium;
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3.5">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${pCls}`}>{pLabel}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`font-semibold ${t.status === "done" ? "text-faint line-through" : ""}`}>
                        {t.title}
                      </p>
                      {t.details && <p className="mt-0.5 text-sm text-steel">{t.details}</p>}
                    </div>
                    {t.unit_number && (
                      <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">
                        #{t.unit_number}
                      </span>
                    )}
                    {t.driver_name && (
                      <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">
                        {t.driver_name}
                      </span>
                    )}
                    {t.due_at && (
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                        t.overdue && t.status !== "done"
                          ? "bg-danger-wash text-danger"
                          : "bg-mist text-steel"
                      }`}>
                        {t.overdue && t.status !== "done"
                          ? `${shortDate(t.due_at)} — overdue`
                          : `due ${shortDate(t.due_at)}`}
                      </span>
                    )}
                    <select
                      className="field !w-auto !py-1.5 text-sm"
                      value={t.status}
                      aria-label={`Status of "${t.title}"`}
                      onChange={(e) => void setStatus(t, e.target.value)}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="done">Done</option>
                    </select>
                    <button className="btn-danger !py-1.5 text-sm" onClick={() => void remove(t)}>Delete</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

export default function TasksPage() {
  return (
    <AppShell title="Tasks">
      <TasksInner />
    </AppShell>
  );
}
