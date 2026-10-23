"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { BusinessDetail } from "@/lib/types";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_LABELS: Record<string, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

interface ServiceOption { id: string; slug: string; name: string }
interface Row { service_id: string; price: string; note: string }

export default function EditBusinessPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, loading } = useAuth();
  const [b, setB] = useState<BusinessDetail | null>(null);
  const [catalog, setCatalog] = useState<ServiceOption[]>([]);
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [description, setDescription] = useState("");
  const [mobile, setMobile] = useState<string>("unknown");
  const [emergency, setEmergency] = useState<string>("unknown");
  const [hours, setHours] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<ServiceOption[]>("/api/services").then(setCatalog).catch(() => {});
    api<BusinessDetail>(`/api/businesses/${id}`).then((data) => {
      setB(data);
      setPhone(data.phone ?? "");
      setWebsite(data.website ?? "");
      setDescription(data.description ?? "");
      setMobile(data.is_mobile_service == null ? "unknown" : String(data.is_mobile_service));
      setEmergency(data.accepts_emergency == null ? "unknown" : String(data.accepts_emergency));
      const h: Record<string, string> = {};
      for (const d of DAYS) {
        h[d] = data.hours?.[d]?.map((r) => r.join("-")).join(", ") ?? "";
      }
      setHours(h);
      setRows(data.services.map((s) => ({
        service_id: s.service.id,
        price: s.standard_price_cents != null ? String(s.standard_price_cents / 100) : "",
        note: s.price_note ?? "",
      })));
    }).catch((e) => setMsg({ kind: "err", text: e.message }));
  }, [id]);

  if (loading || !b) return <p className="mx-auto max-w-2xl px-4 py-10 text-steel">Loading…</p>;
  if (!user) return <p className="mx-auto max-w-2xl px-4 py-10 text-steel">Sign in first.</p>;

  function parseHours(): Record<string, [string, string][]> | null {
    const out: Record<string, [string, string][]> = {};
    let any = false;
    for (const d of DAYS) {
      const raw = (hours[d] ?? "").trim();
      if (!raw) continue;
      const ranges: [string, string][] = [];
      for (const part of raw.split(",")) {
        const m = part.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
        if (!m) throw new Error(`Hours for ${DAY_LABELS[d]} must look like 07:00-19:00`);
        ranges.push([m[1].padStart(5, "0"), m[2].padStart(5, "0")]);
      }
      out[d] = ranges;
      any = true;
    }
    return any ? out : null;
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const parsedHours = parseHours();
      await api(`/api/businesses/${id}`, {
        method: "PATCH",
        body: {
          phone: phone || null,
          website: website || null,
          description: description || null,
          hours: parsedHours,
          is_mobile_service: mobile === "unknown" ? null : mobile === "true",
          accepts_emergency: emergency === "unknown" ? null : emergency === "true",
        },
      });
      await api(`/api/businesses/${id}/services`, {
        method: "PUT",
        body: rows
          .filter((r) => r.service_id)
          .map((r) => ({
            service_id: r.service_id,
            standard_price_cents: r.price ? Math.round(parseFloat(r.price) * 100) : null,
            price_note: r.note || null,
          })),
      });
      setMsg({ kind: "ok", text: "Listing saved." });
    } catch (err) {
      setMsg({ kind: "err", text: err instanceof Error ? err.message : "Save failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Edit listing</h1>
      <p className="mt-1 text-steel">{b.name} — {b.address_raw}</p>

      <form onSubmit={save} className="mt-6 space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="eb-phone">Phone</label>
            <input id="eb-phone" className="field mt-1" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="eb-web">Website</label>
            <input id="eb-web" className="field mt-1" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-steel" htmlFor="eb-desc">About the shop</label>
          <textarea id="eb-desc" className="field mt-1 min-h-24" maxLength={5000}
                    value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="eb-mobile">Mobile service</label>
            <select id="eb-mobile" className="field mt-1" value={mobile} onChange={(e) => setMobile(e.target.value)}>
              <option value="unknown">Not specified</option>
              <option value="true">Yes — we come to the truck</option>
              <option value="false">No — shop visits only</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="eb-emerg">Emergency requests</label>
            <select id="eb-emerg" className="field mt-1" value={emergency} onChange={(e) => setEmergency(e.target.value)}>
              <option value="unknown">Not specified</option>
              <option value="true">Yes — we take emergency calls</option>
              <option value="false">No</option>
            </select>
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-medium text-steel">
            Hours — e.g. <code className="rounded bg-mist px-1">07:00-19:00</code>, blank = closed
          </legend>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {DAYS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm">
                <span className="w-9 text-steel">{DAY_LABELS[d]}</span>
                <input className="field !py-1.5" placeholder="closed" value={hours[d] ?? ""}
                       onChange={(e) => setHours({ ...hours, [d]: e.target.value })} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-steel">Services & standard prices</legend>
          <p className="mt-0.5 text-xs text-faint">
            Leave the price blank for quote-on-request. Published standard prices are what
            marketplace discounts are measured against.
          </p>
          <div className="mt-2 space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <select className="field flex-1" value={r.service_id}
                        onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, service_id: e.target.value } : x)))}>
                  <option value="">Choose service…</option>
                  {catalog.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="field !w-28" placeholder="$ from" inputMode="decimal" value={r.price}
                       onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, price: e.target.value } : x)))} />
                <button type="button" className="btn-quiet !px-2.5" aria-label="Remove service"
                        onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="btn-quiet"
                    onClick={() => setRows([...rows, { service_id: "", price: "", note: "" }])}>
              Add service
            </button>
          </div>
        </fieldset>

        {msg && (
          <p className={`text-sm font-medium ${msg.kind === "ok" ? "text-pine" : "text-danger"}`}>{msg.text}</p>
        )}
        <div className="flex gap-2">
          <button className="btn" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          <button type="button" className="btn-quiet" onClick={() => router.push("/provider")}>Back</button>
        </div>
      </form>
    </div>
  );
}
