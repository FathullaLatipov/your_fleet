"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/drivers. */
interface Driver {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  cdl_number: string | null;
  cdl_class: string | null;
  cdl_expires_at: string | null;
  medical_card_expires_at: string | null;
  status: "active" | "inactive";
  assigned_vehicle_id: string | null;
  assigned_unit: string | null;
  hired_at: string | null;
  notes: string | null;
  warnings: string[];
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

const STATUS_BADGE: Record<string, [string, string]> = {
  active: ["Active", "bg-pine-wash text-pine"],
  inactive: ["Inactive", "bg-mist text-faint"],
};

const dateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");
const toIsoOrNull = (v: string): string | null => (v ? new Date(v).toISOString() : null);

interface DriverForm {
  name: string;
  phone: string;
  email: string;
  cdl_number: string;
  cdl_class: string;
  cdl_expires: string;
  medical_expires: string;
  hired: string;
  assigned_vehicle_id: string;
  status: string;
  notes: string;
}

const emptyForm: DriverForm = {
  name: "", phone: "", email: "", cdl_number: "", cdl_class: "",
  cdl_expires: "", medical_expires: "", hired: "", assigned_vehicle_id: "",
  status: "active", notes: "",
};

function FormFields({
  f, setF, vehicles, idPrefix, withStatus,
}: {
  f: DriverForm;
  setF: (f: DriverForm) => void;
  vehicles: VehicleOpt[];
  idPrefix: string;
  withStatus: boolean;
}) {
  return (
    <>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-name`}>Name *</label>
        <input id={`${idPrefix}-name`} required className="field mt-1" value={f.name}
               onChange={(e) => setF({ ...f, name: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-phone`}>Phone</label>
        <input id={`${idPrefix}-phone`} type="tel" className="field mt-1" value={f.phone}
               onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-email`}>Email</label>
        <input id={`${idPrefix}-email`} type="email" className="field mt-1" value={f.email}
               onChange={(e) => setF({ ...f, email: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-cdl`}>CDL number</label>
        <input id={`${idPrefix}-cdl`} className="field mt-1" value={f.cdl_number}
               onChange={(e) => setF({ ...f, cdl_number: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-class`}>CDL class</label>
        <select id={`${idPrefix}-class`} className="field mt-1" value={f.cdl_class}
                onChange={(e) => setF({ ...f, cdl_class: e.target.value })}>
          <option value="">—</option>
          <option value="A">Class A</option>
          <option value="B">Class B</option>
          <option value="C">Class C</option>
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-cdlex`}>CDL expires</label>
        <input id={`${idPrefix}-cdlex`} type="date" className="field mt-1" value={f.cdl_expires}
               onChange={(e) => setF({ ...f, cdl_expires: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-med`}>Medical card expires</label>
        <input id={`${idPrefix}-med`} type="date" className="field mt-1" value={f.medical_expires}
               onChange={(e) => setF({ ...f, medical_expires: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-hired`}>Hired</label>
        <input id={`${idPrefix}-hired`} type="date" className="field mt-1" value={f.hired}
               onChange={(e) => setF({ ...f, hired: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-truck`}>Assigned truck</label>
        <select id={`${idPrefix}-truck`} className="field mt-1" value={f.assigned_vehicle_id}
                onChange={(e) => setF({ ...f, assigned_vehicle_id: e.target.value })}>
          <option value="">Unassigned</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
        </select>
      </div>
      {withStatus && (
        <div>
          <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-status`}>Status</label>
          <select id={`${idPrefix}-status`} className="field mt-1" value={f.status}
                  onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      )}
      <div className="sm:col-span-3">
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-notes`}>Notes</label>
        <textarea id={`${idPrefix}-notes`} className="field mt-1" value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </>
  );
}

function DriverRow({
  d, vehicles, onChanged, onError,
}: {
  d: Driver;
  vehicles: VehicleOpt[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<DriverForm>(emptyForm);

  function openEdit() {
    setF({
      name: d.name,
      phone: d.phone ?? "",
      email: d.email ?? "",
      cdl_number: d.cdl_number ?? "",
      cdl_class: d.cdl_class ?? "",
      cdl_expires: dateInput(d.cdl_expires_at),
      medical_expires: dateInput(d.medical_card_expires_at),
      hired: dateInput(d.hired_at),
      assigned_vehicle_id: d.assigned_vehicle_id ?? "",
      status: d.status,
      notes: d.notes ?? "",
    });
    setEdit(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/fleet/drivers/${d.id}`, {
        method: "PATCH",
        body: {
          name: f.name.trim(),
          phone: f.phone || null,
          email: f.email || null,
          cdl_number: f.cdl_number || null,
          cdl_class: f.cdl_class || null,
          cdl_expires_at: toIsoOrNull(f.cdl_expires),
          medical_card_expires_at: toIsoOrNull(f.medical_expires),
          hired_at: toIsoOrNull(f.hired),
          assigned_vehicle_id: f.assigned_vehicle_id || null,
          status: f.status,
          notes: f.notes || null,
        },
      });
      setEdit(false);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete driver ${d.name}? This can't be undone.`)) return;
    try {
      await api(`/api/fleet/drivers/${d.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const [sLabel, sCls] = STATUS_BADGE[d.status] ?? STATUS_BADGE.active;
  const cdlLine = [
    d.cdl_number,
    d.cdl_class && `Class ${d.cdl_class}`,
    d.cdl_expires_at && `expires ${new Date(d.cdl_expires_at).toLocaleDateString()}`,
  ].filter(Boolean).join(" · ");

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{d.name}</p>
          <p className="mt-0.5 text-sm text-steel">
            {[d.phone, d.email].filter(Boolean).join(" · ") || "No contact info"}
          </p>
          <p className="mt-0.5 text-sm text-steel">
            {cdlLine ? <>CDL {cdlLine}</> : "No CDL on file"}
            {d.medical_card_expires_at && (
              <> · Medical card {new Date(d.medical_card_expires_at).toLocaleDateString()}</>
            )}
          </p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${sCls}`}>{sLabel}</span>
        <span className="text-sm text-steel">
          {d.assigned_unit ? <>Drives <strong className="text-ink">#{d.assigned_unit}</strong></> : "No truck assigned"}
        </span>
        <button className="btn-quiet !py-1.5 text-sm" onClick={() => (edit ? setEdit(false) : openEdit())}>
          {edit ? "Cancel" : "Edit"}
        </button>
        <button className="btn-danger !py-1.5 text-sm" onClick={() => void remove()}>Delete</button>
      </div>
      {d.warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {d.warnings.map((w) => (
            <span key={w}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    /expired/i.test(w) ? "bg-danger-wash text-danger" : "bg-amber-wash text-amber-ink"
                  }`}>
              {w}
            </span>
          ))}
        </div>
      )}
      {!edit && d.notes && <p className="mt-2 rounded-lg bg-mist/70 p-3 text-sm text-steel">{d.notes}</p>}
      {edit && (
        <form onSubmit={save}
              className="mt-3 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
          <FormFields f={f} setF={setF} vehicles={vehicles} idPrefix={`de-${d.id}`} withStatus />
          <div className="sm:col-span-3">
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save driver"}</button>
          </div>
        </form>
      )}
    </li>
  );
}

function DriversInner() {
  const { user } = useAuth();
  const [drivers, setDrivers] = useState<Driver[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<DriverForm>(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<Driver[]>("/api/fleet/drivers").then(setDrivers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    api<VehicleOpt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
  }, [user, load]);

  async function addDriver(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionErr(null);
    try {
      await api("/api/fleet/drivers", {
        method: "POST",
        body: {
          name: form.name.trim(),
          phone: form.phone || null,
          email: form.email || null,
          cdl_number: form.cdl_number || null,
          cdl_class: form.cdl_class || null,
          cdl_expires_at: toIsoOrNull(form.cdl_expires),
          medical_card_expires_at: toIsoOrNull(form.medical_expires),
          hired_at: toIsoOrNull(form.hired),
          assigned_vehicle_id: form.assigned_vehicle_id || null,
          notes: form.notes || null,
        },
      });
      setForm(emptyForm);
      setAddOpen(false);
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Failed to add driver");
    } finally {
      setBusy(false);
    }
  }

  if (error && drivers === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your drivers.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (drivers === null) return <Loader />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Drivers</h2>
            <p className="mt-0.5 text-sm text-steel">
              {drivers.length} driver{drivers.length === 1 ? "" : "s"} — CDLs, medical cards
              and truck assignments in one place.
            </p>
          </div>
          <button className="btn !py-2 text-sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? "Close" : "+ Add driver"}
          </button>
        </div>

        {addOpen && (
          <form onSubmit={addDriver}
                className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
            <FormFields f={form} setF={setForm} vehicles={vehicles} idPrefix="da" withStatus={false} />
            <div className="sm:col-span-3">
              <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add driver"}</button>
            </div>
          </form>
        )}

        {actionErr && <p className="mt-3 text-sm font-medium text-danger">{actionErr}</p>}

        {drivers.length === 0 && !addOpen ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
            No drivers yet — add your drivers to track CDL and medical card expirations.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line/70">
            {drivers.map((d) => (
              <DriverRow key={d.id} d={d} vehicles={vehicles} onChanged={load} onError={setActionErr} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function DriversPage() {
  return (
    <AppShell title="Drivers">
      <DriversInner />
    </AppShell>
  );
}
