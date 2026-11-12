"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { StatusBadge } from "@/components/badges";
import { Loader } from "@/components/Loader";
import {
  LOAN_FOOTNOTE,
  LoanScheduleTable,
  LoanSummary,
  loanTermsLine,
  type LoanDetail,
} from "@/components/LoanSchedule";
import { ApiError, api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  fmtUsd,
  type BusinessListItem,
  type Defect,
  type Vehicle,
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

type Tab = "overview" | "maintenance" | "defects" | "docs" | "loan" | "history";

/* Loan schedule tab: the truck's financing and full amortization table. */
function LoanTab({ vehicleId }: { vehicleId: string }) {
  const [loan, setLoan] = useState<LoanDetail | null>(null);
  const [none, setNone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState("");

  useEffect(() => {
    api<LoanDetail>(`/api/fleet/vehicles/${vehicleId}/loan`)
      .then(setLoan)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setNone(true);
        else setErr(e instanceof Error ? e.message : "Failed to load");
      });
  }, [vehicleId]);

  async function download(format: "pdf" | "xlsx") {
    setBusy(format);
    setErr(null);
    try {
      const res = await fetch(
        `${DOCS_API_URL}/api/fleet/reports/loan?vehicle_id=${vehicleId}&format=${format}`,
        { headers: docsAuth() },
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? `loan-schedule.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy("");
    }
  }

  if (err && !loan) return <p className="card p-5 text-sm font-medium text-danger">{err}</p>;
  if (none) {
    return (
      <section className="card p-5">
        <h2 className="text-lg font-bold">Loan schedule</h2>
        <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-8 text-center text-sm text-steel">
          No loan on this truck — it&apos;s owned outright, or the financing hasn&apos;t been added yet.
          <Link href={`/loans/${vehicleId}?edit=1`} className="btn ml-3 !py-1.5 text-xs">Add loan</Link>
        </p>
      </section>
    );
  }
  if (!loan) return <Loader />;

  return (
    <section className="card p-0">
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Loan schedule · {loan.lender}</h2>
            <p className="mt-0.5 text-sm text-steel">{loanTermsLine(loan)}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-quiet !py-1.5 text-xs" disabled={busy !== ""}
                    onClick={() => void download("pdf")}>
              {busy === "pdf" ? "…" : "PDF"}
            </button>
            <button className="btn-quiet !py-1.5 text-xs" disabled={busy !== ""}
                    onClick={() => void download("xlsx")}>
              {busy === "xlsx" ? "…" : "Excel"}
            </button>
            <Link href={`/loans/${vehicleId}?edit=1`} className="btn-quiet !py-1.5 text-xs">Edit loan</Link>
          </div>
        </div>
        {err && <p className="mt-2 text-sm font-medium text-danger">{err}</p>}
        <div className="mt-4"><LoanSummary loan={loan} /></div>
      </div>
      <div className="border-t border-line"><LoanScheduleTable loan={loan} maxHeight={420} /></div>
      <p className="border-t border-line px-5 py-3 text-xs text-faint">{LOAN_FOOTNOTE}</p>
    </section>
  );
}

/* Contract for /api/fleet/vehicles/{id}/documents. */
interface VehicleDoc {
  id: string;
  kind: string;
  label: string;
  expires_at: string | null;
  status: "valid" | "due_soon" | "overdue" | "no_expiry";
  has_file: boolean;
  original_name: string | null;
}
interface DocsResponse {
  documents: VehicleDoc[];
  kinds: { kind: string; label: string }[];
}

const DOCS_API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");

function docsAuth(): Record<string, string> {
  try {
    const t = localStorage.getItem("yf_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

const DOC_STATUS_BADGE: Record<VehicleDoc["status"], [string, string]> = {
  valid: ["valid", "bg-pine-wash text-pine"],
  due_soon: ["due soon", "bg-amber-wash text-amber-ink"],
  overdue: ["overdue", "bg-danger-wash text-danger"],
  no_expiry: ["no expiry", "bg-mist text-steel"],
};

function DocumentsSection({ vehicleId }: { vehicleId: string }) {
  const [data, setData] = useState<DocsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ kind: "registration", title: "", expires: "" });

  const base = `/api/fleet/vehicles/${vehicleId}/documents`;
  const load = useCallback(() => {
    api<DocsResponse>(base).then(setData).catch((e) => setErr(e instanceof Error ? e.message : "Failed"));
  }, [base]);
  useEffect(load, [load]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy("add");
    setErr(null);
    try {
      await api(base, {
        method: "POST",
        body: {
          kind: form.kind,
          title: form.kind === "other" ? form.title.trim() || null : null,
          expires_at: form.expires ? new Date(form.expires).toISOString() : null,
        },
      });
      setForm({ kind: "registration", title: "", expires: "" });
      setAddOpen(false);
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't add the document");
    } finally {
      setBusy("");
    }
  }

  async function uploadFile(doc: VehicleDoc, file: File) {
    setBusy(`up:${doc.id}`);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${DOCS_API_URL}${base}/${doc.id}/file`, {
        method: "POST", headers: docsAuth(), body: fd,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d && typeof d === "object" && "detail" in d && typeof d.detail === "string"
          ? d.detail : `Upload failed (${res.status})`);
      }
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Upload failed");
    } finally {
      setBusy("");
    }
  }

  async function downloadFile(doc: VehicleDoc) {
    setBusy(`dl:${doc.id}`);
    try {
      const res = await fetch(`${DOCS_API_URL}${base}/${doc.id}/file`, { headers: docsAuth() });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.original_name ?? `${doc.kind}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Download failed");
    } finally {
      setBusy("");
    }
  }

  async function removeDoc(doc: VehicleDoc) {
    if (!window.confirm(`Remove "${doc.label}"${doc.has_file ? " and its file" : ""}?`)) return;
    try {
      await api(`${base}/${doc.id}`, { method: "DELETE" });
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Delete failed");
    }
  }

  async function setExpiry(doc: VehicleDoc, value: string) {
    try {
      await api(`${base}/${doc.id}`, {
        method: "PATCH",
        body: { expires_at: value ? new Date(value).toISOString() : null },
      });
      load();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Save failed");
    }
  }

  if (!data) return <Loader />;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">Documents</h2>
          <p className="mt-0.5 text-sm text-steel">
            Registration, insurance, inspections, IFTA, 2290 — expiry dates feed the Deadlines board.
          </p>
        </div>
        <button className="btn !py-2 text-sm" onClick={() => setAddOpen(!addOpen)}>
          {addOpen ? "Close" : "+ Add document"}
        </button>
      </div>

      {addOpen && (
        <form onSubmit={add}
              className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-3">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="vd-kind">Type</label>
            <select id="vd-kind" className="field mt-1" value={form.kind}
                    onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {data.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            </select>
          </div>
          {form.kind === "other" && (
            <div>
              <label className="text-sm font-medium text-steel" htmlFor="vd-title">Name</label>
              <input id="vd-title" className="field mt-1" placeholder="What is this document?"
                     value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
          )}
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="vd-exp">Expires</label>
            <input id="vd-exp" type="date" className="field mt-1" value={form.expires}
                   onChange={(e) => setForm({ ...form, expires: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button className="btn" disabled={busy === "add"}>{busy === "add" ? "Adding…" : "Add"}</button>
          </div>
        </form>
      )}

      {err && <p className="mt-3 text-sm font-medium text-danger">{err}</p>}

      {data.documents.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-8 text-center text-sm text-steel">
          No documents on file for this truck yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line/60">
          {data.documents.map((doc) => {
            const [sLabel, sCls] = DOC_STATUS_BADGE[doc.status];
            return (
              <li key={doc.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{doc.label}</p>
                  <p className="mt-0.5 text-sm text-steel">
                    {doc.has_file ? (doc.original_name ?? "file attached") : "No file uploaded"}
                  </p>
                </div>
                <label className="text-xs text-steel">
                  expires{" "}
                  <input type="date" className="field inline-block !w-36 !py-1 text-xs"
                         defaultValue={doc.expires_at ? doc.expires_at.slice(0, 10) : ""}
                         onBlur={(e) => {
                           const cur = doc.expires_at ? doc.expires_at.slice(0, 10) : "";
                           if (e.target.value !== cur) void setExpiry(doc, e.target.value);
                         }} />
                </label>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${sCls}`}>{sLabel}</span>
                <label className="btn-quiet inline-block cursor-pointer !py-1.5 text-xs">
                  {busy === `up:${doc.id}` ? "Uploading…" : doc.has_file ? "Replace file" : "Upload file"}
                  <input type="file" className="hidden"
                         accept="application/pdf,image/jpeg,image/png,image/webp"
                         onChange={(e) => {
                           const f = e.target.files?.[0];
                           if (f) void uploadFile(doc, f);
                           e.target.value = "";
                         }} />
                </label>
                {doc.has_file && (
                  <button className="btn-quiet !py-1.5 text-xs" disabled={busy !== ""}
                          onClick={() => void downloadFile(doc)}>
                    {busy === `dl:${doc.id}` ? "…" : "Download"}
                  </button>
                )}
                <button className="btn-danger !py-1.5 text-xs" onClick={() => void removeDoc(doc)}>
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* Schedule title -> service-catalog slug, so "Find a shop" lands pre-filtered. */
const TITLE_SERVICE: [string, string][] = [
  ["oil", "pm-service"], ["pm", "pm-service"], ["lube", "pm-service"],
  ["tire", "tires"], ["brake", "brakes"], ["transmission", "transmission"],
  ["electrical", "electrical"], ["dpf", "aftertreatment"], ["coolant", "diesel-engine"],
];

function shopLinkFor(title: string): string {
  const t = title.toLowerCase();
  for (const [key, slug] of TITLE_SERVICE) {
    if (t.includes(key)) return `/map?service=${slug}`;
  }
  return "/search";
}

/* ------------------------------------------------------------------ */

function TruckDetails({ v, onSaved, editSignal = 0 }: { v: Vehicle; onSaved: () => void; editSignal?: number }) {
  const [edit, setEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState<Record<string, string>>({});

  // A warning chip can jump here and open the editor directly.
  useEffect(() => {
    if (editSignal > 0) openEdit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editSignal]);

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
    ["Ownership", [v.ownership, v.owner_name].filter(Boolean).join(" · ") || null],
    ["MC / carrier", v.mc_number],
    ["Plate", [v.license_plate, v.state].filter(Boolean).join(" · ") || null],
    ["Trailer", v.trailer_unit],
    ["Dispatch status", v.dispatch_status ? v.dispatch_status.replace("_", " ") : null],
    ["Tags", v.tags],
    ["Insurance until", v.insurance_expires_at ? new Date(v.insurance_expires_at).toLocaleDateString() : null],
    ["Inspection until", v.inspection_expires_at ? new Date(v.inspection_expires_at).toLocaleDateString() : null],
  ];

  return (
    <section className="card p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">Truck details</h2>
        <button className="btn-quiet !py-1.5 text-sm" onClick={() => (edit ? setEdit(false) : openEdit())}>
          {edit ? "Cancel" : "Edit details"}
        </button>
      </div>
      {!edit ? (
        <>
          <dl className="mt-4 grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-steel">{label}</dt>
                <dd className={`mt-0.5 font-medium ${value ? "" : "text-faint"}`}>{value ?? "—"}</dd>
              </div>
            ))}
          </dl>
          {v.notes && <p className="mt-4 rounded-lg bg-mist/70 p-3 text-sm text-steel">{v.notes}</p>}
        </>
      ) : (
        <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-3">
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

/* ------------------------------------------------------------------ */

function VehicleInner() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const [d, setD] = useState<VehicleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [odo, setOdo] = useState("");
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedForm, setSchedForm] = useState({ title: "", miles: "", months: "" });
  const [defOpen, setDefOpen] = useState(false);
  const [defForm, setDefForm] = useState({ type: "", comment: "" });
  const [options, setOptions] = useState<Record<string, ShopOptions | "loading">>({});
  const [highlightSched, setHighlightSched] = useState<string | null>(null);
  const [editSignal, setEditSignal] = useState(0);

  // After jumping to the Maintenance tab, scroll the highlighted schedule into view.
  useEffect(() => {
    if (tab === "maintenance" && highlightSched) {
      const el = document.getElementById(`sched-${highlightSched}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      const t = setTimeout(() => setHighlightSched(null), 2600);
      return () => clearTimeout(t);
    }
  }, [tab, highlightSched]);

  const load = useCallback(() => {
    api<VehicleDetail>(`/api/fleet/vehicles/${id}`).then(setD).catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  if (loading) return <Loader />;
  if (!user) return <p className="mx-auto max-w-5xl px-4 py-10 text-steel">Sign in to view your fleet.</p>;
  if (error) return <p className="mx-auto max-w-5xl px-4 py-10 font-medium text-danger">{error}</p>;
  if (!d) return <Loader />;

  const v = d.vehicle;
  const openDefects = d.defects.filter((x) => x.status !== "resolved").length;
  const dueCount = d.schedules.filter((s) => s.status === "due_soon" || s.status === "overdue").length;

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

  const TABS: [Tab, string, number | string | null][] = [
    ["overview", "Overview", null],
    ["maintenance", "Maintenance", dueCount || null],
    ["defects", "PTI defects", openDefects || null],
    ["docs", "Documents", null],
    ["loan", "Loan schedule", null],
    ["history", "History", d.bookings.length || null],
  ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      <Link href="/fleet" className="text-sm font-medium text-pine hover:underline">← Fleet</Link>

      {/* Truck header: identity + odometer in one place */}
      <div className="card mt-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="display text-3xl font-bold">#{v.unit_number}</h1>
              <span className="text-lg text-steel">{[v.year, v.make, v.model].filter(Boolean).join(" ")}</span>
              <StatusBadge status={v.status} />
              {v.dispatch_status && (
                <span className="rounded-full bg-mist px-2.5 py-0.5 text-xs font-semibold text-steel">
                  {v.dispatch_status.replace("_", " ")}
                </span>
              )}
            </div>
            <p className="mt-1.5 text-sm text-steel">
              {v.vin && <>VIN {v.vin} · </>}
              {v.operator_name && <>{v.operator_name} · </>}
              {v.samsara_vehicle_id ? "Samsara connected" : "Not connected to Samsara"}
              {v.last_location_at && v.last_lat != null && (
                <>
                  {" · "}
                  <a className="text-pine hover:underline" target="_blank" rel="noopener noreferrer"
                     href={`https://www.google.com/maps/search/?api=1&query=${v.last_lat},${v.last_lng}`}>
                    last seen on the map
                  </a>
                </>
              )}
            </p>
          </div>
          <div className="flex items-end gap-4">
            <div className="text-right">
              <p className="text-xs text-steel">Odometer</p>
              <p className="display text-3xl font-bold leading-none tabular-nums">
                {v.odometer_miles != null ? Math.round(v.odometer_miles).toLocaleString() : "—"}
                <span className="ml-1 text-base font-semibold text-steel">mi</span>
              </p>
              {v.odometer_updated_at && (
                <p className="mt-0.5 text-xs text-faint">
                  {v.odometer_source === "samsara" ? "Samsara" : "Manual"} · {new Date(v.odometer_updated_at).toLocaleDateString()}
                </p>
              )}
            </div>
            <form
              className="flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (odo) void post(`/api/fleet/vehicles/${v.id}/odometer`, { odometer_miles: Number(odo) });
                setOdo("");
              }}
            >
              <input className="field !w-28 !py-2" inputMode="numeric" placeholder="New miles"
                     value={odo} onChange={(e) => setOdo(e.target.value)} aria-label="New odometer reading" />
              <button className="btn-quiet !px-3 !py-2">Update</button>
            </form>
          </div>
        </div>
        {(() => {
          /* Clickable alerts: each chip jumps to the place where it's fixed. */
          const alerts: { key: string; text: string; tone: "danger" | "amber"; go: () => void }[] = [];
          for (const s of d.schedules) {
            if (s.status === "overdue" || s.status === "due_soon") {
              alerts.push({
                key: `sched-${s.id}`,
                text: `${s.title} ${s.status === "overdue" ? "overdue" : "due soon"}`,
                tone: s.status === "overdue" ? "danger" : "amber",
                go: () => { setTab("maintenance"); setHighlightSched(s.id); },
              });
            }
          }
          if (openDefects > 0) {
            alerts.push({
              key: "defects",
              text: `${openDefects} open PTI defect${openDefects > 1 ? "s" : ""}`,
              tone: "danger",
              go: () => setTab("defects"),
            });
          }
          for (const w of v.warnings) {
            alerts.push({
              key: w,
              text: w,
              tone: /expired/i.test(w) ? "danger" : "amber",
              go: () => { setTab("overview"); setEditSignal((n) => n + 1); },
            });
          }
          if (alerts.length === 0) return null;
          return (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-danger-wash/70 px-3 py-2.5">
              <span className="text-sm font-bold text-danger">⚠ Needs attention:</span>
              {alerts.map((a) => (
                <button
                  key={a.key}
                  onClick={a.go}
                  className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-[transform,box-shadow] hover:-translate-y-px hover:shadow-[0_2px_6px_rgb(22_24_27/0.15)] ${
                    a.tone === "danger" ? "bg-panel text-danger" : "bg-amber-wash text-amber-ink"
                  }`}
                >
                  {a.text} →
                </button>
              ))}
            </div>
          );
        })()}
      </div>

      {/* Tabs */}
      <div className="mt-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
        {TABS.map(([key, label, badge]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`flex shrink-0 items-center gap-2 rounded-t-lg px-4 py-2.5 text-[15px] font-semibold transition-colors ${
              tab === key
                ? "border-b-2 border-pine bg-panel text-pine"
                : "text-steel hover:bg-panel/60 hover:text-ink"
            }`}
          >
            {label}
            {badge != null && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                key === "defects" || (key === "maintenance" && dueCount > 0)
                  ? "bg-danger-wash text-danger" : "bg-mist text-steel"}`}>
                {badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-5 space-y-5">
        {tab === "overview" && <TruckDetails v={v} onSaved={load} editSignal={editSignal} />}

        {tab === "maintenance" && (
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Maintenance plan</h2>
                <p className="mt-0.5 text-sm text-steel">
                  Set intervals by miles, months or both — YourFleet warns you before they're due.
                </p>
              </div>
              <button className="btn !py-2 text-sm" onClick={() => setSchedOpen(!schedOpen)}>
                {schedOpen ? "Close" : "+ Add schedule"}
              </button>
            </div>
            {schedOpen && (
              <form
                className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-[1fr_120px_120px_auto]"
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
                  setSchedOpen(false);
                }}
              >
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="sc-t">Service</label>
                  <input id="sc-t" required className="field mt-1" placeholder="e.g. Oil change & PM"
                         value={schedForm.title}
                         onChange={(e) => setSchedForm({ ...schedForm, title: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="sc-mi">Every (mi)</label>
                  <input id="sc-mi" className="field mt-1" inputMode="numeric" placeholder="15000"
                         value={schedForm.miles}
                         onChange={(e) => setSchedForm({ ...schedForm, miles: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="sc-mo">Every (months)</label>
                  <input id="sc-mo" className="field mt-1" inputMode="numeric" placeholder="6"
                         value={schedForm.months}
                         onChange={(e) => setSchedForm({ ...schedForm, months: e.target.value })} />
                </div>
                <button className="btn self-end !py-2.5">Add</button>
              </form>
            )}
            {d.schedules.length === 0 && !schedOpen ? (
              <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
                No schedules yet — add oil changes, PM services, DOT inspections.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line/70">
                {d.schedules.map((s) => (
                  <li key={s.id} id={`sched-${s.id}`}
                      className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3.5 transition-colors duration-700 ${
                        highlightSched === s.id ? "-mx-3 rounded-lg bg-amber-wash px-3" : ""}`}>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{s.title}</p>
                      <p className="mt-0.5 text-sm text-steel">
                        Every {[s.interval_miles && `${s.interval_miles.toLocaleString()} mi`,
                                s.interval_months && `${s.interval_months} mo`].filter(Boolean).join(" / ")}
                        {s.miles_left != null && ` · ${Math.round(s.miles_left).toLocaleString()} mi left`}
                        {s.days_left != null && ` · ${Math.round(s.days_left)} days left`}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${SCHED_CLS[s.status]}`}>
                      {s.status === "ok" ? "OK" : s.status === "due_soon" ? "Due soon" : s.status === "overdue" ? "Overdue" : "—"}
                    </span>
                    {(s.status === "due_soon" || s.status === "overdue") && (
                      <Link href={shopLinkFor(s.title)} className="btn !py-1.5 text-sm">Find a shop</Link>
                    )}
                    <button className="btn-quiet !py-1.5 text-sm"
                            onClick={() => post(`/api/fleet/schedules/${s.id}/done`, {})}>
                      Mark done
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {tab === "defects" && (
          <section className="card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">PTI / inspection defects</h2>
                <p className="mt-0.5 text-sm text-steel">
                  With Samsara connected, DVIR defects land here automatically; the system then
                  finds nearby shops with prices for the fix.
                </p>
              </div>
              <button className="btn !py-2 text-sm" onClick={() => setDefOpen(!defOpen)}>
                {defOpen ? "Close" : "+ Report defect"}
              </button>
            </div>
            {defOpen && (
              <form
                className="mt-4 grid gap-3 rounded-lg border border-dashed border-line bg-mist/50 p-4 sm:grid-cols-[200px_1fr_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void post(`/api/fleet/vehicles/${v.id}/defects`, {
                    defect_type: defForm.type, comment: defForm.comment || null,
                  });
                  setDefForm({ type: "", comment: "" });
                  setDefOpen(false);
                }}
              >
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="df-t">What&apos;s wrong</label>
                  <input id="df-t" required className="field mt-1" placeholder="e.g. tire, brakes"
                         value={defForm.type}
                         onChange={(e) => setDefForm({ ...defForm, type: e.target.value })} />
                </div>
                <div>
                  <label className="text-sm font-medium text-steel" htmlFor="df-c">Details (optional)</label>
                  <input id="df-c" className="field mt-1" value={defForm.comment}
                         onChange={(e) => setDefForm({ ...defForm, comment: e.target.value })} />
                </div>
                <button className="btn self-end !py-2.5">Report</button>
              </form>
            )}
            {d.defects.length === 0 && !defOpen ? (
              <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
                No defects reported. That&apos;s how we like it.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {d.defects.map((def) => {
                  const opt = options[def.id];
                  return (
                    <li key={def.id} className="rounded-xl border border-line/70 p-4">
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
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          <button className="btn !py-1.5 text-sm" onClick={() => void findShops(def)}>
                            Find shops & prices
                          </button>
                          <button className="btn-quiet !py-1.5 text-sm"
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
                        <p className="mt-3 text-sm text-steel">Finding shops…</p>
                      ) : opt ? (
                        <div className="mt-3 rounded-lg bg-mist/60 p-3">
                          {opt.options.length === 0 ? (
                            <p className="text-sm text-steel">
                              No shops with a published price for this service nearby yet — try the
                              general <Link className="text-pine underline" href="/map">search</Link>.
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
            )}
          </section>
        )}

        {tab === "docs" && <DocumentsSection vehicleId={id} />}

        {tab === "loan" && <LoanTab vehicleId={id} />}

        {tab === "history" && (
          <section className="card p-5">
            <h2 className="text-lg font-bold">Repair history</h2>
            <p className="mt-0.5 text-sm text-steel">Marketplace repair requests for this truck.</p>
            {d.bookings.length === 0 ? (
              <p className="mt-4 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
                No marketplace repairs yet. Open a PTI defect and hit “Find shops & prices”,
                or <Link href="/map" className="text-pine underline">find a shop</Link> directly.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-line/70">
                {d.bookings.map((b) => (
                  <li key={b.id}>
                    <Link href={`/bookings/${b.id}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-3 transition-colors hover:bg-mist">
                      <span className="text-sm font-medium">
                        {b.issue_description.slice(0, 70)}{b.issue_description.length > 70 ? "…" : ""}
                      </span>
                      <span className="flex items-center gap-2 text-sm">
                        {b.final_price_cents != null && <span className="font-semibold">{fmtUsd(b.final_price_cents)}</span>}
                        <StatusBadge status={b.status} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

export default function VehiclePage() {
  return (
    <AppShell title="My trucks">
      <VehicleInner />
    </AppShell>
  );
}
