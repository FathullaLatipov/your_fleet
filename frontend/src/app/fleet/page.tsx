"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd, type Vehicle } from "@/lib/types";

const MAINT_BADGE: Record<string, [string, string]> = {
  ok: ["Maintenance OK", "bg-pine-wash text-pine"],
  due_soon: ["Service due soon", "bg-amber-wash text-amber-ink"],
  overdue: ["Service overdue", "bg-danger-wash text-danger"],
  unknown: ["No service plan", "bg-mist text-faint"],
};

const STATUS_BADGE: Record<string, [string, string]> = {
  active: ["Active", "bg-pine-wash text-pine"],
  in_repair: ["In repair", "bg-amber-wash text-amber-ink"],
  inactive: ["Inactive", "bg-mist text-faint"],
};

export default function FleetPage() {
  const { user, loading } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[] | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    unit_number: "", make: "", model: "", year: "", vin: "", odometer: "",
    plate: "", state: "", driver: "", ownership: "", mc: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api<Vehicle[]>("/api/fleet/vehicles").then(setVehicles).catch(() => setVehicles([]));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>;
  if (!user || (user.role !== "driver" && user.role !== "fleet_manager")) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16">
        <h1 className="text-2xl font-bold">Fleet</h1>
        <p className="mt-2 text-steel">
          The fleet dashboard is for driver and fleet-manager accounts.
        </p>
        {!user && <Link href="/login?next=/fleet" className="btn mt-4">Sign in</Link>}
      </div>
    );
  }

  async function addVehicle(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/fleet/vehicles", {
        method: "POST",
        body: {
          unit_number: form.unit_number.trim(),
          make: form.make || null,
          model: form.model || null,
          year: form.year ? Number(form.year) : null,
          vin: form.vin || null,
          odometer_miles: form.odometer ? Number(form.odometer) : null,
          license_plate: form.plate || null,
          state: form.state || null,
          operator_name: form.driver || null,
          ownership: form.ownership || null,
          mc_number: form.mc || null,
        },
      });
      setForm({ unit_number: "", make: "", model: "", year: "", vin: "", odometer: "",
                plate: "", state: "", driver: "", ownership: "", mc: "" });
      setShowAdd(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add vehicle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Fleet</h1>
          <p className="mt-1 text-sm text-steel">
            Trucks, maintenance schedules, repair costs. Odometer updates automatically
            when Samsara is connected.
          </p>
        </div>
        <button className="btn" onClick={() => setShowAdd(!showAdd)}>
          {showAdd ? "Close" : "Add truck"}
        </button>
      </div>

      {showAdd && (
        <form onSubmit={addVehicle} className="mt-5 grid gap-3 card p-5 sm:grid-cols-3">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-unit">Unit # *</label>
            <input id="fv-unit" required className="field mt-1" value={form.unit_number}
                   onChange={(e) => setForm({ ...form, unit_number: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-make">Make</label>
            <input id="fv-make" className="field mt-1" placeholder="Freightliner" value={form.make}
                   onChange={(e) => setForm({ ...form, make: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-model">Model</label>
            <input id="fv-model" className="field mt-1" placeholder="Cascadia" value={form.model}
                   onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-year">Year</label>
            <input id="fv-year" className="field mt-1" inputMode="numeric" value={form.year}
                   onChange={(e) => setForm({ ...form, year: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-vin">VIN</label>
            <input id="fv-vin" className="field mt-1" maxLength={17} value={form.vin}
                   onChange={(e) => setForm({ ...form, vin: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-odo">Odometer (mi)</label>
            <input id="fv-odo" className="field mt-1" inputMode="numeric" value={form.odometer}
                   onChange={(e) => setForm({ ...form, odometer: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-plate">Plate number</label>
            <input id="fv-plate" className="field mt-1" value={form.plate}
                   onChange={(e) => setForm({ ...form, plate: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-state">State</label>
            <input id="fv-state" className="field mt-1" placeholder="Ohio" value={form.state}
                   onChange={(e) => setForm({ ...form, state: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-own">Ownership</label>
            <select id="fv-own" className="field mt-1" value={form.ownership}
                    onChange={(e) => setForm({ ...form, ownership: e.target.value })}>
              <option value="">—</option>
              <option value="Owner">Owner</option>
              <option value="Owner-operator">Owner-operator</option>
              <option value="Leased">Leased</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="fv-driver">Operator (driver)</label>
            <input id="fv-driver" className="field mt-1" value={form.driver}
                   onChange={(e) => setForm({ ...form, driver: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-steel" htmlFor="fv-mc">MC / carrier</label>
            <input id="fv-mc" className="field mt-1" placeholder="e.g. VKL TRUCKING INC" value={form.mc}
                   onChange={(e) => setForm({ ...form, mc: e.target.value })} />
          </div>
          {error && <p className="text-sm font-medium text-danger sm:col-span-3">{error}</p>}
          <div className="sm:col-span-3">
            <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add truck"}</button>
          </div>
        </form>
      )}

      {vehicles === null ? (
        <p className="mt-6 text-steel">Loading…</p>
      ) : vehicles.length === 0 ? (
        <div className="mt-6 card p-6">
          <p className="font-semibold">No trucks yet.</p>
          <p className="mt-1 text-sm text-steel">
            Add your first truck to track maintenance, PTI defects and repair costs —
            or connect Samsara and your trucks sync in automatically.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {vehicles.map((v) => {
            const [mLabel, mCls] = MAINT_BADGE[v.maintenance_status] ?? MAINT_BADGE.unknown;
            const [sLabel, sCls] = STATUS_BADGE[v.status] ?? STATUS_BADGE.active;
            return (
              <li key={v.id}>
                <Link href={`/fleet/${v.id}`} className="shop-card flex flex-wrap items-center gap-x-6 gap-y-2">
                  <div className="min-w-32">
                    <p className="display text-lg font-bold">#{v.unit_number}</p>
                    <p className="text-sm text-steel">
                      {[v.year, v.make, v.model].filter(Boolean).join(" ") || v.name || "—"}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-steel">Odometer</p>
                    <p className="font-semibold">
                      {v.odometer_miles != null ? `${Math.round(v.odometer_miles).toLocaleString()} mi` : "—"}
                      {v.odometer_source === "samsara" && <span className="ml-1 text-xs text-pine">· Samsara</span>}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p className="text-steel">Total spent</p>
                    <p className="font-semibold">{fmtUsd(v.expenses_total_cents)}</p>
                  </div>
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    {v.open_defects > 0 && (
                      <span className="rounded bg-danger-wash px-2 py-0.5 text-xs font-bold text-danger">
                        {v.open_defects} defect{v.open_defects > 1 ? "s" : ""}
                      </span>
                    )}
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${mCls}`}>{mLabel}</span>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${sCls}`}>{sLabel}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
