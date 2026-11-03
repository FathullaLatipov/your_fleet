"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/trailers. */
interface Trailer {
  id: string;
  unit_number: string;
  trailer_type: string | null;
  year: number | null;
  vin: string | null;
  license_plate: string | null;
  state: string | null;
  status: "active" | "in_repair" | "inactive";
  assigned_vehicle_id: string | null;
  assigned_unit: string | null;
  inspection_expires_at: string | null;
  registration_expires_at: string | null;
  notes: string | null;
  warnings: string[];
}

interface VehicleOpt {
  id: string;
  unit_number: string;
}

const TRAILER_TYPES: [string, string][] = [
  ["dry_van", "Dry van"],
  ["reefer", "Reefer"],
  ["flatbed", "Flatbed"],
  ["step_deck", "Step deck"],
  ["other", "Other"],
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TRAILER_TYPES);

const STATUS_BADGE: Record<string, [string, string]> = {
  active: ["Active", "bg-pine-wash text-pine"],
  in_repair: ["In repair", "bg-amber-wash text-amber-ink"],
  inactive: ["Inactive", "bg-mist text-faint"],
};

const dateInput = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

interface TrailerForm {
  unit_number: string;
  trailer_type: string;
  year: string;
  vin: string;
  license_plate: string;
  state: string;
  inspection: string;
  registration: string;
  notes: string;
  status: string;
  assigned_vehicle_id: string;
}

const emptyForm: TrailerForm = {
  unit_number: "", trailer_type: "dry_van", year: "", vin: "", license_plate: "",
  state: "", inspection: "", registration: "", notes: "", status: "active",
  assigned_vehicle_id: "",
};

function FormFields({
  f, setF, vehicles, idPrefix, withStatus,
}: {
  f: TrailerForm;
  setF: (f: TrailerForm) => void;
  vehicles: VehicleOpt[];
  idPrefix: string;
  withStatus: boolean;
}) {
  return (
    <>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-unit`}>Unit # *</label>
        <input id={`${idPrefix}-unit`} required className="field mt-1" placeholder="T-12"
               value={f.unit_number} onChange={(e) => setF({ ...f, unit_number: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-type`}>Type</label>
        <select id={`${idPrefix}-type`} className="field mt-1" value={f.trailer_type}
                onChange={(e) => setF({ ...f, trailer_type: e.target.value })}>
          {TRAILER_TYPES.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-year`}>Year</label>
        <input id={`${idPrefix}-year`} className="field mt-1" inputMode="numeric" value={f.year}
               onChange={(e) => setF({ ...f, year: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-vin`}>VIN</label>
        <input id={`${idPrefix}-vin`} className="field mt-1" maxLength={17} value={f.vin}
               onChange={(e) => setF({ ...f, vin: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-plate`}>Plate number</label>
        <input id={`${idPrefix}-plate`} className="field mt-1" value={f.license_plate}
               onChange={(e) => setF({ ...f, license_plate: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-state`}>State</label>
        <input id={`${idPrefix}-state`} className="field mt-1" placeholder="Ohio" value={f.state}
               onChange={(e) => setF({ ...f, state: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-insp`}>Inspection expires</label>
        <input id={`${idPrefix}-insp`} type="date" className="field mt-1" value={f.inspection}
               onChange={(e) => setF({ ...f, inspection: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-reg`}>Registration expires</label>
        <input id={`${idPrefix}-reg`} type="date" className="field mt-1" value={f.registration}
               onChange={(e) => setF({ ...f, registration: e.target.value })} />
      </div>
      {withStatus && (
        <>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-status`}>Status</label>
            <select id={`${idPrefix}-status`} className="field mt-1" value={f.status}
                    onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="active">Active</option>
              <option value="in_repair">In repair</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-truck`}>Hooked to truck</label>
            <select id={`${idPrefix}-truck`} className="field mt-1" value={f.assigned_vehicle_id}
                    onChange={(e) => setF({ ...f, assigned_vehicle_id: e.target.value })}>
              <option value="">Unassigned</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="sm:col-span-3">
        <label className="text-sm font-medium text-steel" htmlFor={`${idPrefix}-notes`}>Notes</label>
        <textarea id={`${idPrefix}-notes`} className="field mt-1" value={f.notes}
                  onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </div>
    </>
  );
}

function TrailerRow({
  t, vehicles, onChanged, onError,
}: {
  t: Trailer;
  vehicles: VehicleOpt[];
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState<TrailerForm>(emptyForm);

  function openEdit() {
    setF({
      unit_number: t.unit_number,
      trailer_type: t.trailer_type ?? "dry_van",
      year: t.year != null ? String(t.year) : "",
      vin: t.vin ?? "",
      license_plate: t.license_plate ?? "",
      state: t.state ?? "",
      inspection: dateInput(t.inspection_expires_at),
      registration: dateInput(t.registration_expires_at),
      notes: t.notes ?? "",
      status: t.status,
      assigned_vehicle_id: t.assigned_vehicle_id ?? "",
    });
    setEdit(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/fleet/trailers/${t.id}`, {
        method: "PATCH",
        body: {
          unit_number: f.unit_number.trim(),
          trailer_type: f.trailer_type || null,
          year: f.year ? Number(f.year) : null,
          vin: f.vin || null,
          license_plate: f.license_plate || null,
          state: f.state || null,
          inspection_expires_at: f.inspection ? new Date(f.inspection).toISOString() : null,
          registration_expires_at: f.registration ? new Date(f.registration).toISOString() : null,
          notes: f.notes || null,
          status: f.status,
          assigned_vehicle_id: f.assigned_vehicle_id || null,
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
    if (!window.confirm(`Delete trailer #${t.unit_number}? This can't be undone.`)) return;
    try {
      await api(`/api/fleet/trailers/${t.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const [sLabel, sCls] = STATUS_BADGE[t.status] ?? STATUS_BADGE.active;
  const idLine = [
    t.year, t.vin && `VIN ${t.vin}`,
    [t.license_plate, t.state].filter(Boolean).join(" · "),
  ].filter(Boolean).join(" · ");

  return (
    <li className="py-3.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="rounded bg-mist px-2 py-0.5 text-sm font-bold text-steel">#{t.unit_number}</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{t.trailer_type ? TYPE_LABEL[t.trailer_type] ?? t.trailer_type : "Trailer"}</p>
          <p className="mt-0.5 text-sm text-steel">{idLine || "—"}</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-xs font-semibold ${sCls}`}>{sLabel}</span>
        <span className="text-sm text-steel">
          {t.assigned_unit ? <>Hooked to <strong className="text-ink">#{t.assigned_unit}</strong></> : "Unassigned"}
        </span>
        <button className="btn-quiet !py-1.5 text-sm" onClick={() => (edit ? setEdit(false) : openEdit())}>
          {edit ? "Cancel" : "Edit"}
        </button>
        <button className="btn-danger !py-1.5 text-sm" onClick={() => void remove()}>Delete</button>
      </div>
      {t.warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {t.warnings.map((w) => (
            <span key={w}
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    /expired/i.test(w) ? "bg-danger-wash text-danger" : "bg-amber-wash text-amber-ink"
                  }`}>
              {w}
            </span>
          ))}
        </div>
      )}
      {!edit && t.notes && <p className="mt-2 rounded-lg bg-mist/70 p-3 text-sm text-steel">{t.notes}</p>}
      {edit && (
        <form onSubmit={save}
              className="mt-3 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
          <FormFields f={f} setF={setF} vehicles={vehicles} idPrefix={`te-${t.id}`} withStatus />
          <div className="sm:col-span-3">
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save trailer"}</button>
          </div>
        </form>
      )}
    </li>
  );
}

function TrailersInner() {
  const { user } = useAuth();
  const [trailers, setTrailers] = useState<Trailer[] | null>(null);
  const [vehicles, setVehicles] = useState<VehicleOpt[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState<TrailerForm>(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api<Trailer[]>("/api/fleet/trailers").then(setTrailers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (!user) return;
    load();
    api<VehicleOpt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
  }, [user, load]);

  async function addTrailer(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setActionErr(null);
    try {
      await api("/api/fleet/trailers", {
        method: "POST",
        body: {
          unit_number: form.unit_number.trim(),
          trailer_type: form.trailer_type || null,
          year: form.year ? Number(form.year) : null,
          vin: form.vin || null,
          license_plate: form.license_plate || null,
          state: form.state || null,
          inspection_expires_at: form.inspection ? new Date(form.inspection).toISOString() : null,
          registration_expires_at: form.registration ? new Date(form.registration).toISOString() : null,
          notes: form.notes || null,
        },
      });
      setForm(emptyForm);
      setAddOpen(false);
      load();
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : "Failed to add trailer");
    } finally {
      setBusy(false);
    }
  }

  if (error && trailers === null) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load your trailers.</p>
          <p className="mt-1 text-sm text-steel">The fleet service didn&apos;t respond. ({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (trailers === null) return <Loader />;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Trailers</h2>
            <p className="mt-0.5 text-sm text-steel">
              {trailers.length} trailer{trailers.length === 1 ? "" : "s"} — inspections, registrations
              and which truck each one is hooked to.
            </p>
          </div>
          <button className="btn !py-2 text-sm" onClick={() => setAddOpen(!addOpen)}>
            {addOpen ? "Close" : "+ Add trailer"}
          </button>
        </div>

        {addOpen && (
          <form onSubmit={addTrailer}
                className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
            <FormFields f={form} setF={setForm} vehicles={vehicles} idPrefix="ta" withStatus={false} />
            <div className="sm:col-span-3">
              <button className="btn" disabled={busy}>{busy ? "Adding…" : "Add trailer"}</button>
            </div>
          </form>
        )}

        {actionErr && <p className="mt-3 text-sm font-medium text-danger">{actionErr}</p>}

        {trailers.length === 0 && !addOpen ? (
          <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
            No trailers yet — add your dry vans, reefers and flatbeds to track inspections and assignments.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line/70">
            {trailers.map((t) => (
              <TrailerRow key={t.id} t={t} vehicles={vehicles} onChanged={load} onError={setActionErr} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function TrailersPage() {
  return (
    <AppShell title="Trailers">
      <TrailersInner />
    </AppShell>
  );
}
