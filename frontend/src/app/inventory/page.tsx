"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/inventory. */
interface InvItem {
  id: string;
  name: string;
  item_type: string;
  type_label: string;
  reference: string | null;
  mc_number: string | null;
  amount_cents: number;
  quantity: number;
  total_cents: number;
  location_kind: "warehouse" | "vehicle" | "driver";
  vehicle_id: string | null;
  driver_id: string | null;
  location_label: string;
  note: string | null;
  archived: boolean;
  created_at: string;
  document_count: number;
}
interface InvList {
  items: InvItem[];
  total: number;
  page: number;
  page_size: number;
  totals: { quantity: number; amount_cents: number };
}
interface InvOptions {
  types: { key: string; label: string }[];
  vehicles: { id: string; unit_number: string }[];
  drivers: { id: string; name: string }[];
  mc_numbers: string[];
  default_mc: string | null;
}
interface InvGroup {
  item_type: string;
  type_label: string;
  rows: number;
  quantity: number;
  total_cents: number;
  in_warehouse: number;
  on_trucks: number;
  with_drivers: number;
}
interface InvDoc { id: string; original_name: string | null; content_type: string | null }

type Tab = "inventory" | "groups" | "archived";
type SortKey = "name" | "item_type" | "quantity" | "reference" | "mc_number" | "note" | "created_at" | "amount" | "total";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");

function authHeaders(): Record<string, string> {
  try {
    const t = localStorage.getItem("yf_token");
    return t ? { Authorization: `Bearer ${t}` } : {};
  } catch {
    return {};
  }
}

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function toCents(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

/* "warehouse" | "vehicle:<id>" | "driver:<id>" <-> API fields */
function locationValue(i: Pick<InvItem, "location_kind" | "vehicle_id" | "driver_id">): string {
  if (i.location_kind === "vehicle") return `vehicle:${i.vehicle_id}`;
  if (i.location_kind === "driver") return `driver:${i.driver_id}`;
  return "warehouse";
}
function locationBody(v: string) {
  const [kind, id] = v.split(":");
  return {
    location_kind: kind,
    vehicle_id: kind === "vehicle" ? id : null,
    driver_id: kind === "driver" ? id : null,
  };
}

async function errorText(res: Response, fallback: string): Promise<string> {
  const d = await res.json().catch(() => null);
  return d && typeof d === "object" && "detail" in d && typeof d.detail === "string" ? d.detail : fallback;
}

/* ------------------------------------------------------------- small parts */

function Glyph({ d, className = "h-3.5 w-3.5" }: { d: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor"
         strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}
const G = {
  warehouse: <path d="M3 21V9l9-5 9 5v12M7 21v-7h10v7M7 17h10" />,
  truck: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  person: <><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>,
  download: <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  dots: <><circle cx="12" cy="5" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="12" cy="19" r="1.2" /></>,
  close: <path d="M18 6 6 18M6 6l12 12" />,
};

function LocationChip({ item }: { item: Pick<InvItem, "location_kind" | "location_label"> }) {
  const warehouse = item.location_kind === "warehouse";
  return (
    <span className={`inline-flex max-w-[180px] items-center gap-1.5 truncate rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${
      warehouse ? "border-pine/50 bg-pine-wash text-pine" : "border-cta/50 bg-cta/5 text-cta"}`}>
      <Glyph d={warehouse ? G.warehouse : item.location_kind === "vehicle" ? G.truck : G.person} />
      <span className="truncate">{item.location_label}</span>
    </span>
  );
}

function LocationSelect({
  value, onChange, options, id, exclude, allowAll, className = "field !py-2 text-sm",
}: {
  value: string;
  onChange: (v: string) => void;
  options: InvOptions;
  id?: string;
  exclude?: string;
  allowAll?: boolean;
  className?: string;
}) {
  return (
    <select id={id} className={className} value={value} onChange={(e) => onChange(e.target.value)}
            aria-label={allowAll ? "Location" : undefined}>
      {allowAll && <option value="">All locations</option>}
      {exclude !== "warehouse" && <option value="warehouse">Warehouse</option>}
      {allowAll && <option value="vehicle">Any truck</option>}
      {allowAll && <option value="driver">Any driver</option>}
      {options.vehicles.length > 0 && (
        <optgroup label="Trucks">
          {options.vehicles.filter((v) => `vehicle:${v.id}` !== exclude).map((v) => (
            <option key={v.id} value={`vehicle:${v.id}`}>Unit {v.unit_number}</option>
          ))}
        </optgroup>
      )}
      {options.drivers.length > 0 && (
        <optgroup label="Drivers">
          {options.drivers.filter((d) => `driver:${d.id}` !== exclude).map((d) => (
            <option key={d.id} value={`driver:${d.id}`}>{d.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  );
}

function SortTh({
  k, label, right, sort, order, onSort,
}: {
  k: SortKey;
  label: string;
  right?: boolean;
  sort: SortKey;
  order: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-semibold ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => onSort(k)}
              className={`inline-flex items-center gap-1 hover:text-ink ${sort === k ? "text-ink" : ""}`}>
        {label}
        <span className="text-[10px] text-faint">{sort === k ? (order === "asc" ? "▲" : "▼") : "↕"}</span>
      </button>
    </th>
  );
}

/* ------------------------------------------------------------- drawer */

function AssetDrawer({
  mode, item, options, onClose, onSaved,
}: {
  mode: "add" | "edit";
  item: InvItem | null;
  options: InvOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    mc: item?.mc_number ?? options.default_mc ?? "",
    type: item?.item_type ?? options.types[0]?.key ?? "other",
    name: item?.name ?? "",
    reference: item?.reference ?? "",
    amount: item ? String(item.amount_cents / 100) : "",
    quantity: item ? String(item.quantity) : "",
    location: item ? locationValue(item) : "warehouse",
    note: item?.note ?? "",
  });
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [docs, setDocs] = useState<InvDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadDocs = useCallback(() => {
    if (item) api<InvDoc[]>(`/api/fleet/inventory/${item.id}/documents`).then(setDocs).catch(() => {});
  }, [item]);
  useEffect(loadDocs, [loadDocs]);

  async function uploadAll(itemId: string, files: File[]) {
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`${API_URL}/api/fleet/inventory/${itemId}/documents`,
                              { method: "POST", headers: authHeaders(), body: fd });
      if (!res.ok) throw new Error(`${file.name}: ${await errorText(res, `upload failed (${res.status})`)}`);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const amount = toCents(f.amount);
    const qty = Number(f.quantity);
    if (amount === null) { setErr("Enter the amount (price per unit)."); return; }
    if (!Number.isInteger(qty) || qty < (mode === "add" ? 1 : 0)) { setErr("Quantity must be a whole number."); return; }
    setBusy(true);
    setErr(null);
    try {
      const fields = {
        name: f.name.trim(), item_type: f.type, reference: f.reference.trim() || null,
        mc_number: f.mc.trim() || null, amount_cents: amount, quantity: qty,
        note: f.note.trim() || null,
      };
      let id = item?.id;
      if (mode === "add") {
        const created = await api<InvItem>("/api/fleet/inventory", {
          method: "POST", body: { ...fields, ...locationBody(f.location) },
        });
        id = created.id;
      } else {
        await api(`/api/fleet/inventory/${id}`, { method: "PATCH", body: fields });
      }
      if (newFiles.length && id) await uploadAll(id, newFiles);
      onSaved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't save");
      setBusy(false);
    }
  }

  async function openDoc(d: InvDoc) {
    if (!item) return;
    const res = await fetch(`${API_URL}/api/fleet/inventory/${item.id}/documents/${d.id}`, { headers: authHeaders() });
    if (!res.ok) { setErr(`Download failed (${res.status})`); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = d.original_name ?? "document";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function removeDoc(d: InvDoc) {
    if (!item || !window.confirm(`Remove "${d.original_name ?? "document"}"?`)) return;
    await api(`/api/fleet/inventory/${item.id}/documents/${d.id}`, { method: "DELETE" }).catch(() => {});
    loadDocs();
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-charcoal/40" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
            className="flex h-full w-full max-w-md flex-col bg-mist shadow-2xl">
        <div className="flex items-center justify-between border-b border-line bg-panel px-5 py-4">
          <h2 className="text-lg font-bold">{mode === "add" ? "Add new asset" : "Edit asset"}</h2>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="grid h-8 w-8 place-items-center rounded-full text-steel hover:bg-mist hover:text-ink">
            <Glyph d={G.close} className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <datalist id="inv-mc-list">
            {options.mc_numbers.map((m) => <option key={m} value={m} />)}
          </datalist>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-mc">MC Number</label>
            <input id="inv-mc" list="inv-mc-list" className="field mt-1 !py-2 text-sm" placeholder="IQS Group LLC"
                   value={f.mc} onChange={(e) => setF({ ...f, mc: e.target.value })} />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-type">Type</label>
            <select id="inv-type" className="field mt-1 !py-2 text-sm" value={f.type}
                    onChange={(e) => setF({ ...f, type: e.target.value })}>
              {options.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-name">
              Name <span className="text-danger">*</span>
            </label>
            <input id="inv-name" required className="field mt-1 !py-2 text-sm"
                   value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-ref">Reference</label>
            <input id="inv-ref" className="field mt-1 !py-2 text-sm"
                   value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-amount">
                Amount, $ <span className="text-danger">*</span>
              </label>
              <input id="inv-amount" required inputMode="decimal" className="field mt-1 !py-2 text-sm" placeholder="per unit"
                     value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-qty">
                Quantity <span className="text-danger">*</span>
              </label>
              <input id="inv-qty" required inputMode="numeric" className="field mt-1 !py-2 text-sm"
                     value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value.replace(/\D/g, "") })} />
            </div>
          </div>
          {mode === "add" && (
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-loc">Location</label>
              <div className="mt-1">
                <LocationSelect id="inv-loc" value={f.location} options={options}
                                onChange={(v) => setF({ ...f, location: v })} />
              </div>
            </div>
          )}
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wide text-steel" htmlFor="inv-note">Note</label>
            <textarea id="inv-note" rows={3} className="field mt-1 text-sm"
                      value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-steel">Documents</p>
            {docs.length > 0 && (
              <ul className="mt-1.5 space-y-1">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">📄 {d.original_name ?? "document"}</span>
                    <button type="button" className="text-xs font-semibold text-pine hover:underline"
                            onClick={() => void openDoc(d)}>view</button>
                    <button type="button" className="text-xs font-semibold text-danger hover:underline"
                            onClick={() => void removeDoc(d)}>remove</button>
                  </li>
                ))}
              </ul>
            )}
            <label className="btn-quiet mt-1.5 flex w-full cursor-pointer items-center justify-center gap-2 !py-2 text-sm">
              <Glyph d={<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />} className="h-4 w-4" />
              Upload documents
              <input type="file" multiple className="hidden" accept="application/pdf,image/jpeg,image/png,image/webp"
                     onChange={(e) => { setNewFiles([...newFiles, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
            </label>
            {newFiles.length > 0 && (
              <p className="mt-1 text-xs text-steel">
                {newFiles.length} file{newFiles.length === 1 ? "" : "s"} will upload on {mode === "add" ? "Create" : "Save"}:{" "}
                {newFiles.map((x) => x.name).join(", ")}
              </p>
            )}
          </div>
          {err && <p className="text-sm font-medium text-danger">{err}</p>}
        </div>

        <div className="border-t border-line bg-panel px-5 py-4">
          <button className="btn w-full" disabled={busy}>
            {busy ? "Saving…" : mode === "add" ? "Create" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- move dialog */

function MoveDialog({
  item, options, onClose, onMoved,
}: {
  item: InvItem;
  options: InvOptions;
  onClose: () => void;
  onMoved: () => void;
}) {
  const current = locationValue(item);
  const [to, setTo] = useState(current === "warehouse" ? (options.vehicles[0] ? `vehicle:${options.vehicles[0].id}` : "") : "warehouse");
  const [qty, setQty] = useState(String(item.quantity));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(qty);
    if (!to) { setErr("Pick where it goes."); return; }
    if (!Number.isInteger(n) || n < 1 || n > item.quantity) { setErr(`Quantity must be 1–${item.quantity}.`); return; }
    setBusy(true);
    setErr(null);
    try {
      await api(`/api/fleet/inventory/${item.id}/move`, { method: "POST", body: { ...locationBody(to), quantity: n } });
      onMoved();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Couldn't move it");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-charcoal/40 px-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="card w-full max-w-sm p-5">
        <h2 className="text-lg font-bold">Move / assign</h2>
        <p className="mt-1 text-sm text-steel">
          <span className="font-semibold text-ink">{item.name}</span> — {item.quantity} at{" "}
          <LocationChip item={item} />
        </p>
        <label className="mt-4 block text-xs font-medium text-steel" htmlFor="mv-to">Move to</label>
        <div className="mt-1">
          <LocationSelect id="mv-to" value={to} onChange={setTo} options={options} exclude={current} />
        </div>
        <label className="mt-3 block text-xs font-medium text-steel" htmlFor="mv-qty">
          Quantity <span className="text-faint">(of {item.quantity})</span>
        </label>
        <input id="mv-qty" inputMode="numeric" className="field mt-1 !py-2 text-sm"
               value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))} />
        <p className="mt-1 text-xs text-faint">Moving part of it splits the row; the rest stays where it is.</p>
        {err && <p className="mt-2 text-sm font-medium text-danger">{err}</p>}
        <div className="mt-4 flex gap-2">
          <button className="btn !py-2 text-sm" disabled={busy}>{busy ? "Moving…" : "Move"}</button>
          <button type="button" className="btn-quiet !py-2 text-sm" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

/* ------------------------------------------------------------- page */

function InventoryInner() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>("inventory");
  const [options, setOptions] = useState<InvOptions | null>(null);
  const [data, setData] = useState<InvList | null>(null);
  const [groups, setGroups] = useState<InvGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [locFilter, setLocFilter] = useState("");
  const [mcFilter, setMcFilter] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [sort, setSort] = useState<SortKey>("created_at");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [drawer, setDrawer] = useState<{ mode: "add" | "edit"; item: InvItem | null } | null>(null);
  const [moving, setMoving] = useState<InvItem | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [qInput]);

  // Close the row menu on any outside click.
  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);

  const loadOptions = useCallback(() => {
    api<InvOptions>("/api/fleet/inventory/options").then(setOptions).catch(() => {});
  }, []);

  const filterParams = useCallback(() => ({
    tab: tab === "archived" ? "archived" : "active",
    q: q || undefined,
    item_type: typeFilter || undefined,
    location: locFilter || undefined,
    mc: mcFilter || undefined,
  }), [tab, q, typeFilter, locFilter, mcFilter]);

  const load = useCallback(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : "Failed to load");
    if (tab === "groups") {
      api<InvGroup[]>("/api/fleet/inventory/groups")
        .then((g) => { setGroups(g); setError(null); }).catch(fail);
      return;
    }
    api<InvList>("/api/fleet/inventory", {
      params: { ...filterParams(), sort, order, page, page_size: pageSize },
    }).then((d) => { setData(d); setError(null); }).catch(fail);
  }, [tab, filterParams, sort, order, page, pageSize]);

  useEffect(() => { if (user) loadOptions(); }, [user, loadOptions]);
  useEffect(() => { if (user) load(); }, [user, load]);

  function refreshAll() {
    setDrawer(null);
    setMoving(null);
    load();
    loadOptions();
  }

  function sortBy(key: SortKey) {
    if (sort === key) setOrder(order === "asc" ? "desc" : "asc");
    else { setSort(key); setOrder(key === "created_at" || key === "total" || key === "amount" ? "desc" : "asc"); }
    setPage(1);
  }

  async function rowAction(item: InvItem, action: "archive" | "restore" | "delete") {
    setMenuFor(null);
    if (action === "delete" && !window.confirm(`Delete "${item.name}" permanently? Its documents go too.`)) return;
    try {
      if (action === "delete") await api(`/api/fleet/inventory/${item.id}`, { method: "DELETE" });
      else await api(`/api/fleet/inventory/${item.id}/${action}`, { method: "POST" });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    }
  }

  async function exportXlsx() {
    setExporting(true);
    try {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(filterParams())) if (v) qs.set(k, v);
      const res = await fetch(`${API_URL}/api/fleet/inventory/export?${qs}`, { headers: authHeaders() });
      if (!res.ok) throw new Error(await errorText(res, `Export failed (${res.status})`));
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "inventory.xlsx";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }

  const filtersOn = [typeFilter, locFilter, mcFilter].filter(Boolean).length;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const from = data && data.total ? (data.page - 1) * data.page_size + 1 : 0;
  const to = data ? Math.min(data.total, data.page * data.page_size) : 0;

  const thProps = { sort, order, onSort: sortBy };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <section className="card p-0">
        {/* Title row */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-5">
          <h2 className="text-lg font-bold">Inventory</h2>
          <button className="btn inline-flex items-center gap-1.5 !py-2 text-sm"
                  disabled={!options} onClick={() => setDrawer({ mode: "add", item: null })}>
            <Glyph d={G.plus} className="h-4 w-4" /> Add inventory asset
          </button>
        </div>

        {/* Tabs */}
        <div className="mt-3 flex gap-1 border-b border-line px-5">
          {([["inventory", "Inventory"], ["groups", "Asset Groups"], ["archived", "Archived"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setPage(1); }}
                    className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                      tab === k ? "border-pine text-ink" : "border-transparent text-steel hover:text-ink"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab !== "groups" && (
          <>
            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 px-5 py-3">
              <input className="field !w-64 !py-2 text-sm" placeholder="Search name, reference, note"
                     value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search inventory" />
              <button className={`btn-quiet !py-2 text-sm ${filtersOn ? "!border-pine/50 !text-pine" : ""}`}
                      onClick={() => setShowFilters(!showFilters)}>
                Filters{filtersOn ? ` · ${filtersOn}` : ""}
              </button>
              <button className="btn-quiet ml-auto inline-flex items-center gap-1.5 !py-2 text-sm"
                      disabled={exporting} onClick={() => void exportXlsx()}>
                <Glyph d={G.download} className="h-4 w-4" /> {exporting ? "Exporting…" : "Export"}
              </button>
            </div>
            {showFilters && options && (
              <div className="flex flex-wrap items-center gap-2 border-t border-line bg-mist/50 px-5 py-3">
                <select className="field !w-auto !py-2 text-sm" aria-label="Type" value={typeFilter}
                        onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
                  <option value="">All types</option>
                  {options.types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                </select>
                <LocationSelect value={locFilter} options={options} allowAll
                                className="field !w-auto !py-2 text-sm"
                                onChange={(v) => { setLocFilter(v); setPage(1); }} />
                <select className="field !w-auto !py-2 text-sm" aria-label="MC number" value={mcFilter}
                        onChange={(e) => { setMcFilter(e.target.value); setPage(1); }}>
                  <option value="">All MC numbers</option>
                  {options.mc_numbers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
                {filtersOn > 0 && (
                  <button className="text-sm font-medium text-steel hover:text-ink"
                          onClick={() => { setTypeFilter(""); setLocFilter(""); setMcFilter(""); setPage(1); }}>
                    Clear
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {error && <p className="px-5 py-2 text-sm font-medium text-danger">{error}</p>}

        {/* Asset groups */}
        {tab === "groups" && (
          groups === null ? <Loader /> : groups.length === 0 ? (
            <p className="m-5 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-10 text-center text-sm text-steel">
              No inventory yet — add assets and they&apos;ll roll up here by type.
            </p>
          ) : (
            <div className="overflow-x-auto px-5 pb-5 pt-3">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-line bg-mist text-left text-steel">
                    <th className="px-3 py-2.5 font-semibold">Type</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Rows</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total QTY</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Warehouse</th>
                    <th className="px-3 py-2.5 text-right font-semibold">On trucks</th>
                    <th className="px-3 py-2.5 text-right font-semibold">With drivers</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Total amount</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <tr key={g.item_type} className="cursor-pointer border-b border-line/60 hover:bg-mist/60"
                        onClick={() => { setTypeFilter(g.item_type); setShowFilters(true); setTab("inventory"); setPage(1); }}>
                      <td className="px-3 py-2.5 font-semibold">{g.type_label}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{g.rows}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{g.quantity.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{g.in_warehouse.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{g.on_trucks.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{g.with_drivers.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{money(g.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-faint">Click a type to see its items.</p>
            </div>
          )
        )}

        {/* Inventory / archived table */}
        {tab !== "groups" && (
          data === null ? <Loader /> : data.total === 0 ? (
            <p className="m-5 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-10 text-center text-sm text-steel">
              {tab === "archived" ? "Nothing archived."
                : q || filtersOn ? "No items match these filters."
                : "No inventory yet. Add tablets, ELDs, snow chains or toll passes and track where each one is."}
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-y border-line bg-mist text-left text-steel">
                      <SortTh {...thProps} k="name" label="Name" />
                      <SortTh {...thProps} k="item_type" label="Type" />
                      <th className="px-3 py-2.5 font-semibold">Location</th>
                      <SortTh {...thProps} k="quantity" label="QTY" right />
                      <SortTh {...thProps} k="reference" label="Reference" />
                      <SortTh {...thProps} k="mc_number" label="MC Number" />
                      <SortTh {...thProps} k="note" label="Note" />
                      <SortTh {...thProps} k="created_at" label="Date added" />
                      <SortTh {...thProps} k="amount" label="Amount" right />
                      <SortTh {...thProps} k="total" label="Total amount" right />
                      <th className="w-10 px-2 py-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((it) => (
                      <tr key={it.id} className="border-b border-line/60 transition-colors hover:bg-mist/60">
                        <td className="max-w-[180px] truncate px-3 py-2 font-medium">
                          {it.name}
                          {it.document_count > 0 && (
                            <span className="ml-1.5 text-xs text-faint" title={`${it.document_count} document(s)`}>📎{it.document_count}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">{it.type_label}</td>
                        <td className="px-3 py-2"><LocationChip item={it} /></td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{it.quantity.toLocaleString()}</td>
                        <td className="max-w-[140px] truncate px-3 py-2 text-steel">{it.reference ?? "—"}</td>
                        <td className="max-w-[160px] truncate px-3 py-2">{it.mc_number ?? "—"}</td>
                        <td className="max-w-[200px] truncate px-3 py-2 text-steel" title={it.note ?? ""}>{it.note ?? "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-steel">
                          {new Date(it.created_at).toLocaleDateString("en-US")}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(it.amount_cents)}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{money(it.total_cents)}</td>
                        <td className="relative px-2 py-2 text-right">
                          <button type="button" aria-label="Actions"
                                  onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === it.id ? null : it.id); }}
                                  className="grid h-7 w-7 place-items-center rounded border border-line text-steel hover:text-ink">
                            <Glyph d={G.dots} className="h-4 w-4" />
                          </button>
                          {menuFor === it.id && (
                            <div className="absolute right-2 top-9 z-20 w-40 overflow-hidden rounded-lg border border-line bg-panel text-left shadow-(--shadow-pop)"
                                 onClick={(e) => e.stopPropagation()}>
                              {!it.archived ? (
                                <>
                                  <button className="block w-full px-3 py-2 text-left text-sm hover:bg-mist"
                                          onClick={() => { setMenuFor(null); setDrawer({ mode: "edit", item: it }); }}>Edit</button>
                                  <button className="block w-full px-3 py-2 text-left text-sm hover:bg-mist"
                                          onClick={() => { setMenuFor(null); setMoving(it); }}>Move / assign</button>
                                  <button className="block w-full px-3 py-2 text-left text-sm hover:bg-mist"
                                          onClick={() => void rowAction(it, "archive")}>Archive</button>
                                </>
                              ) : (
                                <>
                                  <button className="block w-full px-3 py-2 text-left text-sm hover:bg-mist"
                                          onClick={() => void rowAction(it, "restore")}>Restore</button>
                                  <button className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-mist"
                                          onClick={() => void rowAction(it, "delete")}>Delete</button>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line font-semibold">
                      <td className="px-3 py-2.5" colSpan={3}>Total ({data.total} rows, all pages)</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{data.totals.quantity.toLocaleString()}</td>
                      <td colSpan={5} />
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(data.totals.amount_cents)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Pagination */}
              <div className="flex flex-wrap items-center justify-end gap-4 px-5 py-3 text-sm text-steel">
                <label className="flex items-center gap-2">
                  Rows per page
                  <select className="field !w-auto !py-1 text-sm" value={pageSize}
                          onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}>
                    {[25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <span className="tabular-nums">{from}–{to} of {data.total}</span>
                <div className="flex items-center gap-1">
                  {([["«", 1], ["‹", page - 1], ["›", page + 1], ["»", pages]] as const).map(([label, target]) => (
                    <button key={label} type="button" disabled={target < 1 || target > pages || target === page}
                            onClick={() => setPage(target)}
                            className="grid h-7 w-7 place-items-center rounded text-base hover:bg-mist disabled:opacity-30">
                      {label}
                    </button>
                  ))}
                </div>
                <span className="tabular-nums">Page {page} of {pages}</span>
              </div>
            </>
          )
        )}
      </section>

      {drawer && options && (
        <AssetDrawer mode={drawer.mode} item={drawer.item} options={options}
                     onClose={() => setDrawer(null)} onSaved={refreshAll} />
      )}
      {moving && options && (
        <MoveDialog item={moving} options={options} onClose={() => setMoving(null)} onMoved={refreshAll} />
      )}
    </div>
  );
}

export default function InventoryPage() {
  return (
    <AppShell title="Inventory">
      <InventoryInner />
    </AppShell>
  );
}
