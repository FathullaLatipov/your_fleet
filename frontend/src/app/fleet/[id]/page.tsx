"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StatusBadge } from "@/components/badges";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  EXPENSE_LABELS,
  fmtUsd,
  type BusinessListItem,
  type Defect,
  type VehicleDetail,
} from "@/lib/types";

const SCHED_CLS: Record<string, string> = {
  ok: "bg-pine-wash text-pine",
  due_soon: "bg-amber-wash text-amber-ink",
  overdue: "bg-danger-wash text-danger",
  unknown: "bg-mist text-faint",
};

interface ShopOptions {
  suggested_service_slug: string | null;
  used_location: { lat: number; lng: number } | null;
  options: BusinessListItem[];
}

/* Carrier profile fields, modeled after standard TMS truck exports. */
function TruckDetails({ v, onSaved }: { v: import("@/lib/types").Vehicle; onSaved: () => void }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});

  function openEdit() {
    setF({
      operator_name: v.operator_name ?? "", ownership: v.ownership ?? "",
      mc_number: v.mc_number ?? "", license_plate: v.license_plate ?? "",
      state: v.state ?? "", trailer_unit: v.trailer_unit ?? "",
      dispatch_status: v.dispatch_status ?? "", tags: v.tags ?? "",
      notes: v.notes ?? "",
      insurance: v.insurance_expires_at ? v.insurance_expires_at.slice(0, 10) : "",
      inspection: v.inspection_expires_at ? v.inspection_expires_at.slice(0, 10) : "",
    });
    setEdit(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/fleet/vehicles/${v.id}`, {
        method: "PATCH",
        body: {
          operator_name: f.operator_name || null,
          ownership: f.ownership || null,
          mc_number: f.mc_number || null,
          license_plate: f.license_plate || null,
          state: f.state || null,
          trailer_unit: f.trailer_unit || null,
          dispatch_status: f.dispatch_status || null,
          tags: f.tags || null,
          notes: f.notes || null,
          insurance_expires_at: f.insurance ? new Date(f.insurance).toISOString() : null,
          inspection_expires_at: f.inspection ? new Date(f.inspection).toISOString() : null,
        },
      });
      setEdit(false);
      onSaved();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string | null][] = [
    ["Operator (driver)", v.operator_name],
    ["Ownership", v.ownership],
    ["MC / carrier", v.mc_number],
    ["Plate", [v.license_plate, v.state].filter(Boolean).join(" · ") || null],
    ["Trailer", v.trailer_unit],
    ["Dispatch status", v.dispatch_status ? v.dispatch_status.replace("_", " ") : null],
    ["Tags", v.tags],
    ["Insurance until", v.insurance_expires_at ? new Date(v.insurance_expires_at).toLocaleDateString() : null],
    ["Inspection until", v.inspection_expires_at ? new Date(v.inspection_expires_at).toLocaleDateString() : null],
  ];

  return (
    <section className="card mt-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Truck details</h2>
        <button className="btn-quiet !py-1.5 text-sm" onClick={() => (edit ? setEdit(false) : openEdit())}>
          {edit ? "Cancel" : "Edit details"}
        </button>
      </div>
      {!edit ? (
        <>
          <dl className="mt-3 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-steel">{label}</dt>
                <dd className={`font-medium ${value ? "" : "text-faint"}`}>{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {v.notes && <p className="mt-3 rounded-lg bg-mist/70 p-3 text-sm text-steel">{v.notes}</p>}
        </>
      ) : (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-3">
          {([
            ["operator_name", "Operator (driver)"], ["mc_number", "MC / carrier"],
            ["license_plate", "Plate number"], ["state", "State"],
            ["trailer_unit", "Trailer unit"], ["tags", "Tags"],
          ] as const).map(([key, label]) => (
            <div key={key}>
              <label className="text-sm font-medium text-steel" htmlFor={`td-${key}`}>{label}</label>
              <input id={`td-${key}`} className="field mt-1" value={f[key] ?? ""}
                     onChange={(e) => setF({ ...f, [key]: e.target.value })} />
            </div>
          ))}
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="td-own">Ownership</label>
            <select id="td-own" className="field mt-1" value={f.ownership}
                    onChange={(e) => setF({ ...f, ownership: e.target.value })}>
              <option value="">—</option>
              <option value="Owner">Owner</option>
              <option value="Owner-operator">Owner-operator</option>
              <option value="Leased">Leased</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="td-disp">Dispatch status</label>
            <select id="td-disp" className="field mt-1" value={f.dispatch_status}
                    onChange={(e) => setF({ ...f, dispatch_status: e.target.value })}>
              <option value="">—</option>
              <option value="available">Available</option>
              <option value="in_transit">In transit</option>
              <option value="parked">Parked</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="td-ins">Insurance until</label>
            <input id="td-ins" type="date" className="field mt-1" value={f.insurance}
                   onChange={(e) => setF({ ...f, insurance: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="td-insp">Inspection until</label>
            <input id="td-insp" type="date" className="field mt-1" value={f.inspection}
                   onChange={(e) => setF({ ...f, inspection: e.target.value })} />
          </div>
          <div className="sm:col-span-3">
            <label className="text-sm font-medium text-steel" htmlFor="td-notes">Notes</label>
            <textarea id="td-notes" className="field mt-1" maxLength={5000} value={f.notes}
                      onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </div>
          {err && <p className="text-sm font-medium text-danger sm:col-span-3">{err}</p>}
          <div className="sm:col-span-3">
            <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
          </div>
        </form>
      )}
    </section>
  );
}

export default function VehiclePage() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [d, setD] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [odo, setOdo] = useState("");
  const [schedForm, setSchedForm] = useState({ title: "", miles: "", months: "" });
  const [expForm, setExpForm] = useState({ category: "repair", description: "", amount: "" });
  const [defForm, setDefForm] = useState({ type: "", comment: "" });
  const [options, setOptions] = useState<Record<string, ShopOptions | "loading">>({});

  const load = useCallback(() => {
    api<VehicleDetail>(`/api/fleet/vehicles/${id}`).then(setD).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>;
  if (!user) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Sign in to view your fleet.</p>;
  if (error) return <p className="mx-auto max-w-5xl px-4 py-10 font-medium text-danger">{error}</p>;
  if (!d) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Loading…</p>;

  const v = d.vehicle;

  const post = (path: string, body: unknown) =>
    api(path, { method: "POST", body }).then(load).catch((e) => setError(e.message));

  async function findShops(defect: Defect) {
    setOptions((o) => ({ ...o, [defect.id]: "loading" }));
    try {
      const params: Record<string, string | number> = {};
      if (v.last_lat == null && typeof navigator !== "undefined" && navigator.geolocation) {
        await new Promise<void>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              params.lat = pos.coords.latitude;
              params.lng = pos.coords.longitude;
              resolve();
            },
            () => resolve(),
            { timeout: 8000 },
          );
        });
      }
      const res = await api<ShopOptions>(`/api/fleet/defects/${defect.id}/shop-options`, { params });
      setOptions((o) => ({ ...o, [defect.id]: res }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shops");
      setOptions((o) => {
        const { [defect.id]: _, ...rest } = o;
        return rest;
      });
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/fleet" className="text-sm font-medium text-pine hover:underline">← Fleet</Link>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-bold">
          Unit #{v.unit_number}
          <span className="ml-3 text-lg font-medium text-steel">
            {[v.year, v.make, v.model].filter(Boolean).join(" ")}
          </span>
        </h1>
        <StatusBadge status={v.status} />
      </div>
      <p className="mt-1 text-sm text-steel">
        {v.vin && <>VIN {v.vin} · </>}
        {v.license_plate && <>Plate {v.license_plate} · </>}
        {v.samsara_vehicle_id ? "Connected to Samsara" : "Not connected to Samsara"}
        {v.last_location_at && v.last_lat != null && (
          <>
            {" · last seen "}
            <a className="text-pine hover:underline" target="_blank" rel="noopener noreferrer"
               href={`https://www.google.com/maps/search/?api=1&query=${v.last_lat},${v.last_lng}`}>
              on the map
            </a>{" "}
            {new Date(v.last_location_at).toLocaleString()}
          </>
        )}
      </p>

      {v.warnings.length > 0 && (
        <div className="mt-4 rounded-xl border border-danger/30 bg-danger-wash p-4">
          <p className="font-semibold text-danger">Document warnings</p>
          <ul className="mt-1 list-inside list-disc text-sm text-danger/90">
            {v.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}

      <TruckDetails v={v} onSaved={load} />

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        {/* Odometer + maintenance */}
        <section>
          <div className="card p-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-steel">Odometer</p>
                <p className="display text-3xl font-bold">
                  {v.odometer_miles != null ? `${Math.round(v.odometer_miles).toLocaleString()} mi` : "—"}
                </p>
                {v.odometer_updated_at && (
                  <p className="text-xs text-faint">
                    {v.odometer_source === "samsara" ? "From Samsara" : "Manual"} ·{" "}
                    {new Date(v.odometer_updated_at).toLocaleString()}
                  </p>
                )}
              </div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (odo) void post(`/api/fleet/vehicles/${v.id}/odometer`, { odometer_miles: Number(odo) });
                  setOdo("");
                }}
              >
                <input className="field !w-32" inputMode="numeric" placeholder="New miles"
                       value={odo} onChange={(e) => setOdo(e.target.value)} aria-label="New odometer reading" />
                <button className="btn-quiet">Update</button>
              </form>
            </div>
          </div>

          <h2 className="mt-6 text-lg font-bold">Maintenance plan</h2>
          {d.schedules.length === 0 && (
            <p className="mt-1 text-sm text-steel">
              No schedules yet — add oil changes, PM services, DOT inspections below.
            </p>
          )}
          <ul className="mt-2 space-y-2">
            {d.schedules.map((s) => (
              <li key={s.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold">{s.title}</p>
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${SCHED_CLS[s.status]}`}>
                    {s.status === "ok" ? "OK" : s.status === "due_soon" ? "Due soon" : s.status === "overdue" ? "Overdue" : "—"}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-steel">
                  Every {[s.interval_miles && `${s.interval_miles.toLocaleString()} mi`,
                          s.interval_months && `${s.interval_months} mo`].filter(Boolean).join(" / ")}
                  {s.miles_left != null && ` · ${Math.round(s.miles_left).toLocaleString()} mi left`}
                  {s.days_left != null && ` · ${Math.round(s.days_left)} days left`}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(s.status === "due_soon" || s.status === "overdue") && (
                    <Link href="/search" className="btn !py-1 text-sm">Find a shop nearby</Link>
                  )}
                  <button className="btn-quiet !py-1 text-sm"
                          onClick={() => post(`/api/fleet/schedules/${s.id}/done`, {})}>
                    Mark done today
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <form
            className="mt-3 grid grid-cols-[1fr_90px_90px_auto] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post(`/api/fleet/vehicles/${v.id}/schedules`, {
                title: schedForm.title,
                interval_miles: schedForm.miles ? Number(schedForm.miles) : null,
                interval_months: schedForm.months ? Number(schedForm.months) : null,
                last_done_miles: v.odometer_miles,
                last_done_at: new Date().toISOString(),
              });
              setSchedForm({ title: "", miles: "", months: "" });
            }}
          >
            <input required className="field" placeholder="e.g. Oil change" value={schedForm.title}
                   onChange={(e) => setSchedForm({ ...schedForm, title: e.target.value })} aria-label="Schedule title" />
            <input className="field" inputMode="numeric" placeholder="mi" value={schedForm.miles}
                   onChange={(e) => setSchedForm({ ...schedForm, miles: e.target.value })} aria-label="Interval miles" />
            <input className="field" inputMode="numeric" placeholder="mo" value={schedForm.months}
                   onChange={(e) => setSchedForm({ ...schedForm, months: e.target.value })} aria-label="Interval months" />
            <button className="btn-quiet">Add</button>
          </form>
        </section>

        {/* Defects */}
        <section>
          <h2 className="text-lg font-bold">PTI / inspection defects</h2>
          <p className="mt-1 text-sm text-steel">
            Defects from pre-trip inspections. With Samsara connected, DVIR defects land here
            automatically; the system then finds nearby shops with prices for the fix.
          </p>
          <ul className="mt-2 space-y-2">
            {d.defects.map((def) => {
              const opt = options[def.id];
              return (
                <li key={def.id} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">{def.defect_type}</p>
                    <StatusBadge status={def.status} />
                  </div>
                  {def.comment && <p className="mt-0.5 text-sm text-steel">{def.comment}</p>}
                  <p className="mt-0.5 text-xs text-faint">
                    {def.source === "samsara_dvir" ? "From Samsara DVIR" : "Manual"} ·{" "}
                    {new Date(def.reported_at).toLocaleDateString()}
                  </p>
                  {def.status === "open" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button className="btn !py-1 text-sm" onClick={() => void findShops(def)}>
                        Find shops & prices
                      </button>
                      <button className="btn-quiet !py-1 text-sm"
                              onClick={() => post(`/api/fleet/defects/${def.id}/resolve`, {})}>
                        Resolved elsewhere
                      </button>
                    </div>
                  )}
                  {def.booking_id && (
                    <Link href={`/bookings/${def.booking_id}`}
                          className="mt-2 inline-block text-sm font-medium text-pine hover:underline">
                      View repair request
                    </Link>
                  )}
                  {opt === "loading" ? (
                    <p className="mt-2 text-sm text-steel">Finding shops…</p>
                  ) : opt ? (
                    <div className="mt-3 border-t border-line pt-2">
                      {opt.options.length === 0 ? (
                        <p className="text-sm text-steel">
                          No shops with a published price for this service nearby yet — try the
                          general <Link className="text-pine underline" href="/search">search</Link>.
                        </p>
                      ) : (
                        <ul className="space-y-1.5">
                          {opt.options.slice(0, 5).map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                              <span>
                                <Link href={`/business/${o.id}?vehicle=${v.id}&defect=${def.id}&issue=${encodeURIComponent(`PTI defect: ${def.defect_type}${def.comment ? ` — ${def.comment}` : ""}`)}`}
                                      className="font-medium text-pine hover:underline">
                                  {o.name}
                                </Link>
                                {o.distance_miles != null && <span className="text-steel"> · {o.distance_miles} mi</span>}
                              </span>
                              <span className="font-semibold">
                                {o.service_price_cents != null ? `from ${fmtUsd(o.service_price_cents)}` : "quote"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <form
            className="mt-3 grid grid-cols-[1fr_1.4fr_auto] gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void post(`/api/fleet/vehicles/${v.id}/defects`, {
                defect_type: defForm.type, comment: defForm.comment || null,
              });
              setDefForm({ type: "", comment: "" });
            }}
          >
            <input required className="field" placeholder="e.g. tire, brakes" value={defForm.type}
                   onChange={(e) => setDefForm({ ...defForm, type: e.target.value })} aria-label="Defect type" />
            <input className="field" placeholder="Details (optional)" value={defForm.comment}
                   onChange={(e) => setDefForm({ ...defForm, comment: e.target.value })} aria-label="Defect details" />
            <button className="btn-quiet">Report</button>
          </form>

          <h2 className="mt-8 text-lg font-bold">Repair history</h2>
          {d.bookings.length === 0 ? (
            <p className="mt-1 text-sm text-steel">No marketplace repairs for this truck yet.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line card">
              {d.bookings.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <Link href={`/bookings/${b.id}`} className="text-sm font-medium hover:text-pine hover:underline">
                    {b.issue_description.slice(0, 60)}{b.issue_description.length > 60 ? "…" : ""}
                  </Link>
                  <span className="flex items-center gap-2 text-sm">
                    {b.final_price_cents != null && <span className="font-semibold">{fmtUsd(b.final_price_cents)}</span>}
                    <StatusBadge status={b.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Expenses ledger */}
      <section className="mt-10">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Cost ledger</h2>
          <p className="text-sm text-steel">
            Total: <span className="display text-lg font-bold text-ink">{fmtUsd(v.expenses_total_cents)}</span>
          </p>
        </div>
        {Object.keys(d.expenses_by_category).length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(d.expenses_by_category).map(([cat, cents]) => (
              <span key={cat} className="rounded bg-mist px-2 py-1 text-sm">
                {EXPENSE_LABELS[cat] ?? cat}: <strong>{fmtUsd(cents)}</strong>
              </span>
            ))}
          </div>
        )}
        <form
          className="mt-3 grid grid-cols-[150px_1fr_120px_auto] gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void post(`/api/fleet/vehicles/${v.id}/expenses`, {
              category: expForm.category,
              description: expForm.description,
              amount_cents: Math.round(Number(expForm.amount) * 100),
              odometer_miles: v.odometer_miles,
            });
            setExpForm({ category: "repair", description: "", amount: "" });
          }}
        >
          <select className="field" value={expForm.category} aria-label="Expense category"
                  onChange={(e) => setExpForm({ ...expForm, category: e.target.value })}>
            {Object.entries(EXPENSE_LABELS).map(([val, label]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
          <input required className="field" placeholder="What was it? (receipt line)" value={expForm.description}
                 onChange={(e) => setExpForm({ ...expForm, description: e.target.value })} aria-label="Expense description" />
          <input required className="field" inputMode="decimal" placeholder="$ amount" value={expForm.amount}
                 onChange={(e) => setExpForm({ ...expForm, amount: e.target.value })} aria-label="Expense amount" />
          <button className="btn-quiet">Add</button>
        </form>
        {d.expenses.length === 0 ? (
          <p className="mt-3 text-sm text-steel">
            No costs recorded. Completed marketplace repairs appear here automatically.
          </p>
        ) : (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-steel">
                <th className="py-1.5 pr-3 font-medium">Date</th>
                <th className="py-1.5 pr-3 font-medium">Category</th>
                <th className="py-1.5 pr-3 font-medium">Description</th>
                <th className="py-1.5 pr-3 font-medium">Odometer</th>
                <th className="py-1.5 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {d.expenses.map((e) => (
                <tr key={e.id} className="border-b border-line">
                  <td className="py-1.5 pr-3 text-steel">{new Date(e.incurred_at).toLocaleDateString()}</td>
                  <td className="py-1.5 pr-3">{EXPENSE_LABELS[e.category] ?? e.category}</td>
                  <td className="py-1.5 pr-3">
                    {e.description}
                    {e.booking_id && (
                      <Link href={`/bookings/${e.booking_id}`} className="ml-1.5 text-xs font-medium text-pine hover:underline">
                        booking
                      </Link>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-steel">
                    {e.odometer_miles != null ? `${Math.round(e.odometer_miles).toLocaleString()} mi` : "—"}
                  </td>
                  <td className="py-1.5 text-right font-semibold">{fmtUsd(e.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
