"use client";

import { useState } from "react";

/* Contract for POST /api/fleet/import/{trucks|trailers}. */
interface ImportRow {
  row: number;
  unit: string | null;
  action: "create" | "update" | "error";
  messages: string[];
}
interface ImportResult {
  dry_run: boolean;
  total_rows: number;
  created: number;
  updated: number;
  errors: number;
  ignored_columns: string[];
  rows: ImportRow[];
}

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

const ACTION_BADGE: Record<ImportRow["action"], [string, string]> = {
  create: ["new", "bg-pine-wash text-pine"],
  update: ["update", "bg-amber-wash text-amber-ink"],
  error: ["skipped", "bg-danger-wash text-danger"],
};

/* Upload an Excel/CSV file, preview what will happen row by row, then import. */
export function ImportDialog({
  kind, onClose, onImported,
}: {
  kind: "trucks" | "trailers";
  onClose: () => void;
  onImported: () => void;
}) {
  const noun = kind === "trucks" ? "truck" : "trailer";
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState<string | null>(null);

  async function send(f: File, dryRun: boolean): Promise<ImportResult> {
    const fd = new FormData();
    fd.append("file", f);
    const res = await fetch(`${API_URL}/api/fleet/import/${kind}?dry_run=${dryRun}`,
                            { method: "POST", headers: authHeaders(), body: fd });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(data && typeof data === "object" && typeof data.detail === "string"
        ? data.detail : `Import failed (${res.status})`);
    }
    return data as ImportResult;
  }

  async function check(f: File) {
    setFile(f);
    setPreview(null);
    setErr(null);
    setBusy("check");
    try {
      setPreview(await send(f, true));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read the file");
    } finally {
      setBusy("");
    }
  }

  async function runImport() {
    if (!file) return;
    setBusy("import");
    setErr(null);
    try {
      const result = await send(file, false);
      setDone(result);
      onImported();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy("");
    }
  }

  async function downloadTemplate() {
    const res = await fetch(`${API_URL}/api/fleet/import/template/${kind}`, { headers: authHeaders() });
    if (!res.ok) { setErr(`Couldn't download the template (${res.status})`); return; }
    const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? `${noun}s.xlsx`;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  const ready = preview ? preview.created + preview.updated : 0;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-charcoal/40 px-4 py-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="card flex max-h-full w-full max-w-3xl flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">Import {noun}s from Excel</h2>
            <p className="mt-0.5 text-sm text-steel">
              One row per {noun}. Existing units are updated; empty cells never erase what&apos;s saved.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg text-steel hover:bg-mist hover:text-ink">
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {done ? (
            <div className="rounded-lg border border-pine/40 bg-pine-wash/60 p-5 text-center">
              <p className="text-lg font-bold text-pine">Import complete</p>
              <p className="mt-1 text-sm text-steel">
                {done.created} new {noun}{done.created === 1 ? "" : "s"} added,{" "}
                {done.updated} updated{done.errors ? `, ${done.errors} row${done.errors === 1 ? "" : "s"} skipped` : ""}.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="btn inline-block cursor-pointer !py-2 text-sm">
                  {busy === "check" ? "Reading…" : file ? "Choose another file" : "Choose Excel file"}
                  <input type="file" className="hidden" accept=".xlsx,.csv"
                         onChange={(e) => { const f = e.target.files?.[0]; if (f) void check(f); e.target.value = ""; }} />
                </label>
                <button type="button" className="btn-quiet !py-2 text-sm" onClick={() => void downloadTemplate()}>
                  Download template
                </button>
                {file && <span className="truncate text-sm text-steel">{file.name}</span>}
              </div>
              <p className="mt-2 text-xs text-faint">
                {kind === "trucks"
                  ? "Columns: Make/Model, Unit Number, Plate #, VIN, Year, State, MC Number, Driver, Owner, Odometer, Trailer, Status."
                  : "Columns: Make/Model, Unit Number, MC Number, Plate #, Type, VIN, Year, Ownership, State, Assigned Truck, Status, Fleet Status."}
                {" "}Only Unit Number is required. .xlsx or .csv, up to 2,000 rows.
              </p>

              {preview && (
                <div className="mt-4">
                  <div className="flex flex-wrap gap-2 text-sm">
                    <span className="rounded-full bg-pine-wash px-3 py-1 font-semibold text-pine">{preview.created} new</span>
                    <span className="rounded-full bg-amber-wash px-3 py-1 font-semibold text-amber-ink">{preview.updated} to update</span>
                    {preview.errors > 0 && (
                      <span className="rounded-full bg-danger-wash px-3 py-1 font-semibold text-danger">{preview.errors} will be skipped</span>
                    )}
                  </div>
                  {preview.ignored_columns.length > 0 && (
                    <p className="mt-2 text-xs text-steel">
                      Not imported (unknown columns): {preview.ignored_columns.join(", ")}
                    </p>
                  )}
                  {preview.total_rows === 0 ? (
                    <p className="mt-3 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-6 text-center text-sm text-steel">
                      The file has headers but no {noun} rows yet — fill it in and choose it again.
                    </p>
                  ) : (
                    <div className="mt-3 max-h-[45vh] overflow-auto rounded-lg border border-line">
                      <table className="w-full border-collapse text-sm">
                        <thead className="sticky top-0 bg-mist">
                          <tr className="text-left text-steel">
                            <th className="px-3 py-2 font-medium">Row</th>
                            <th className="px-3 py-2 font-medium">Unit</th>
                            <th className="px-3 py-2 font-medium">Result</th>
                            <th className="px-3 py-2 font-medium">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.rows.map((r) => {
                            const [label, cls] = ACTION_BADGE[r.action];
                            return (
                              <tr key={r.row} className="border-t border-line/60 align-top">
                                <td className="px-3 py-1.5 tabular-nums text-faint">{r.row}</td>
                                <td className="px-3 py-1.5 font-medium">{r.unit ?? "—"}</td>
                                <td className="px-3 py-1.5">
                                  <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
                                </td>
                                <td className="px-3 py-1.5 text-xs text-steel">{r.messages.join(" · ")}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {err && <p className="mt-3 text-sm font-medium text-danger">{err}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          {done ? (
            <button className="btn !py-2 text-sm" onClick={onClose}>Done</button>
          ) : (
            <>
              <button className="btn-quiet !py-2 text-sm" onClick={onClose}>Cancel</button>
              <button className="btn !py-2 text-sm" disabled={!preview || ready === 0 || busy !== ""}
                      onClick={() => void runImport()}>
                {busy === "import" ? "Importing…" : `Import ${ready} ${noun}${ready === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
