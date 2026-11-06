"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/* Contract for /api/fleet/reports. */
interface ReportMeta {
  key: string;
  name: string;
  desc: string;
  filters: ("truck" | "period" | "service_type")[];
}
interface Catalog {
  reports: ReportMeta[];
  periods: { key: string; label: string }[];
  service_types: { key: string; label: string }[];
  trucks: { vehicle_id: string; unit_number: string; financed: boolean }[];
}
interface ReportColumn { h: string; t: string; w?: number }
interface ReportSection {
  heading: string | null;
  columns: ReportColumn[];
  rows: (string | number | null)[][];
  totals: (string | number | null)[] | null;
}
interface Report {
  title: string;
  subtitle: string;
  summary: [string, string][];
  sections: ReportSection[];
}

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");

const NUM_TYPES = new Set(["money", "int", "dec1"]);

function fmtCell(v: string | number | null, t: string): string {
  if (v == null || v === "") return "";
  if (t === "money" && typeof v === "number")
    return `$${(v / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (t === "date") return new Date(String(v)).toLocaleDateString();
  if (t === "int" && typeof v === "number") return Math.round(v).toLocaleString();
  if (t === "dec1" && typeof v === "number") return v.toFixed(1);
  return String(v);
}

function ReportsInner() {
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<Record<string, { truck: string; period: string; serviceType: string }>>({});
  const [preview, setPreview] = useState<{ key: string; rep: Report } | null>(null);
  const [busy, setBusy] = useState("");
  const previewRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    setError(null);
    api<Catalog>("/api/fleet/reports")
      .then(setCatalog)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  useEffect(() => {
    if (preview && previewRef.current) previewRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [preview]);

  const optFor = (key: string) => opts[key] ?? { truck: "", period: "ytd", serviceType: "" };

  function queryFor(key: string): string {
    const o = optFor(key);
    const qs = new URLSearchParams();
    if (o.truck) qs.set("vehicle_id", o.truck);
    qs.set("period", o.period);
    if (o.serviceType) qs.set("service_type", o.serviceType);
    return qs.toString();
  }

  async function showPreview(key: string) {
    setBusy(`prev:${key}`);
    setError(null);
    try {
      const rep = await api<Report>(`/api/fleet/reports/${key}?${queryFor(key)}`);
      setPreview({ key, rep });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't build the report");
    } finally {
      setBusy("");
    }
  }

  async function download(key: string, format: "xlsx" | "pdf") {
    setBusy(`${key}:${format}`);
    setError(null);
    try {
      let auth: Record<string, string> = {};
      try {
        const t = localStorage.getItem("yf_token");
        if (t) auth = { Authorization: `Bearer ${t}` };
      } catch { /* ignore */ }
      const res = await fetch(
        `${API_URL}/api/fleet/reports/${key}?${queryFor(key)}&format=${format}`,
        { headers: auth },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => null);
        throw new Error(d && typeof d === "object" && "detail" in d && typeof d.detail === "string"
          ? d.detail : `Download failed (${res.status})`);
      }
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1]
        ?? `report.${format}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy("");
    }
  }

  if (error && catalog === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load reports.</p>
          <p className="mt-1 text-sm text-steel">({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (catalog === null) return <div className="mx-auto max-w-6xl px-4 py-6"><Loader /></div>;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <p className="text-sm text-steel">
        Pick a report, choose the trucks and dates, then download it as a PDF or an Excel file.
      </p>
      {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}

      {/* Preview */}
      {preview && (
        <section ref={previewRef} className="card mt-4 scroll-mt-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">{preview.rep.title}</h3>
              <p className="mt-0.5 text-sm text-steel">{preview.rep.subtitle}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn !py-1.5 text-xs" disabled={busy !== ""}
                      onClick={() => void download(preview.key, "xlsx")}>
                {busy === `${preview.key}:xlsx` ? "…" : "Excel"}
              </button>
              <button className="btn-quiet !py-1.5 text-xs" disabled={busy !== ""}
                      onClick={() => void download(preview.key, "pdf")}>
                {busy === `${preview.key}:pdf` ? "…" : "PDF"}
              </button>
              <button className="btn-quiet !py-1.5 text-xs" onClick={() => setPreview(null)}>Close</button>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {preview.rep.summary.map(([l, v]) => (
              <div key={l} className="min-w-[130px] rounded-lg bg-mist p-3">
                <p className="text-xs text-steel">{l}</p>
                <p className="text-lg font-bold tabular-nums">{v}</p>
              </div>
            ))}
          </div>
          {preview.rep.sections.map((sec, si) => (
            <div key={si} className="mt-5">
              {sec.heading && preview.rep.sections.length > 1 && (
                <p className="font-bold">{sec.heading}</p>
              )}
              <div className="mt-2 max-h-[420px] overflow-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-mist">
                    <tr className="text-left text-steel">
                      {sec.columns.map((c) => (
                        <th key={c.h}
                            className={`px-3 py-2 font-medium ${NUM_TYPES.has(c.t) ? "text-right" : ""}`}>
                          {c.h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sec.rows.map((row, ri) => (
                      <tr key={ri} className="border-t border-line/60">
                        {row.map((v, ci) => (
                          <td key={ci}
                              className={`px-3 py-1.5 ${NUM_TYPES.has(sec.columns[ci].t) ? "text-right tabular-nums" : ""}`}>
                            {fmtCell(v, sec.columns[ci].t)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {sec.totals && (
                      <tr className="border-t-2 border-ink font-bold">
                        {sec.totals.map((v, ci) => (
                          <td key={ci}
                              className={`px-3 py-2 ${NUM_TYPES.has(sec.columns[ci].t) ? "text-right tabular-nums" : ""}`}>
                            {fmtCell(v, sec.columns[ci].t)}
                          </td>
                        ))}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Report cards */}
      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {catalog.reports.map((r) => {
          const o = optFor(r.key);
          const trucks = r.key === "loan"
            ? catalog.trucks.filter((t) => t.financed)
            : catalog.trucks;
          return (
            <section key={r.key} className="card flex flex-col p-5">
              <h3 className="text-lg font-bold">{r.name}</h3>
              <p className="mt-0.5 text-sm text-steel">{r.desc}</p>
              {(r.filters.length > 0) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {r.filters.includes("truck") && (
                    <select className="field !w-auto !py-1.5 text-sm" aria-label="Truck filter"
                            value={o.truck}
                            onChange={(e) => setOpts({ ...opts, [r.key]: { ...o, truck: e.target.value } })}>
                      <option value="">{r.key === "loan" ? "All financed trucks" : "All trucks"}</option>
                      {trucks.map((t) => (
                        <option key={t.vehicle_id} value={t.vehicle_id}>#{t.unit_number}</option>
                      ))}
                    </select>
                  )}
                  {r.filters.includes("service_type") && (
                    <select className="field !w-auto !py-1.5 text-sm" aria-label="Service type filter"
                            value={o.serviceType}
                            onChange={(e) => setOpts({ ...opts, [r.key]: { ...o, serviceType: e.target.value } })}>
                      <option value="">All service types</option>
                      {catalog.service_types.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  )}
                  {r.filters.includes("period") && (
                    <select className="field !w-auto !py-1.5 text-sm" aria-label="Period filter"
                            value={o.period}
                            onChange={(e) => setOpts({ ...opts, [r.key]: { ...o, period: e.target.value } })}>
                      {catalog.periods.map((p) => (
                        <option key={p.key} value={p.key}>{p.label}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <div className="mt-4 flex gap-2 pt-1">
                <button className="btn-quiet !py-2 text-sm" disabled={busy !== ""}
                        onClick={() => void showPreview(r.key)}>
                  {busy === `prev:${r.key}` ? "Building…" : "Preview"}
                </button>
                <button className="btn !py-2 text-sm" disabled={busy !== ""}
                        onClick={() => void download(r.key, "xlsx")}>
                  {busy === `${r.key}:xlsx` ? "…" : "Excel"}
                </button>
                <button className="btn-quiet !py-2 text-sm" disabled={busy !== ""}
                        onClick={() => void download(r.key, "pdf")}>
                  {busy === `${r.key}:pdf` ? "…" : "PDF"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default function ReportsPage() {
  return (
    <AppShell title="Reports">
      <ReportsInner />
    </AppShell>
  );
}
