"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "";

interface Truck { id: string; unit_number: string }
interface Check { key: string; label: string }
interface Ctx { driver_name: string; trucks: Truck[]; checklist: Check[] }

type ItemState = { photos: File[]; urls: string[]; issue: boolean; note: string; skipped: boolean; done: boolean };

/* eslint-disable @typescript-eslint/no-explicit-any */
function tgApp(): any {
  if (typeof window === "undefined") return null;
  return (window as any).Telegram?.WebApp ?? null;
}

export default function PtiMiniApp() {
  const [stage, setStage] = useState<"loading" | "error" | "setup" | "checklist" | "summary" | "done">("loading");
  const [error, setError] = useState<string>("");
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const initDataRef = useRef<string>("");

  const [truckId, setTruckId] = useState<string>("");
  const [inspType, setInspType] = useState<"pre" | "post">("pre");
  const [items, setItems] = useState<Record<string, ItemState>>({});
  const [idx, setIdx] = useState(0);
  const [overall, setOverall] = useState<"" | "all_good" | "found_issue">("");
  const [sending, setSending] = useState(false);
  const [doneResult, setDoneResult] = useState<{ result: string; defects: number } | null>(null);

  // Boot: wait for the Telegram SDK, then load context.
  useEffect(() => {
    let tries = 0;
    const boot = async () => {
      const tg = tgApp();
      if (!tg) {
        if (tries++ < 40) { setTimeout(boot, 100); return; }
        setError("Open this from the YourFleet bot in Telegram."); setStage("error"); return;
      }
      try { tg.ready(); tg.expand(); } catch { /* ignore */ }
      initDataRef.current = tg.initData || "";
      if (!initDataRef.current) {
        setError("Open this from the YourFleet bot in Telegram."); setStage("error"); return;
      }
      try {
        const fd = new FormData();
        fd.append("init_data", initDataRef.current);
        const res = await fetch(`${API}/api/tg/context`, { method: "POST", body: fd });
        if (res.status === 403) { setError("You're not connected yet. Ask dispatch for a connect code."); setStage("error"); return; }
        if (!res.ok) { setError("Couldn't load your fleet. Try again from the bot."); setStage("error"); return; }
        const data: Ctx = await res.json();
        setCtx(data);
        setItems(Object.fromEntries(data.checklist.map((c) => [c.key,
          { photos: [], urls: [], issue: false, note: "", skipped: false, done: false }])));
        setTruckId(data.trucks[0]?.id ?? "");
        setStage("setup");
      } catch { setError("Network error. Try again from the bot."); setStage("error"); }
    };
    boot();
  }, []);

  const checklist = ctx?.checklist ?? [];
  const cur = checklist[idx];
  const curState = cur ? items[cur.key] : undefined;

  const setItem = useCallback((key: string, patch: Partial<ItemState>) => {
    setItems((m) => ({ ...m, [key]: { ...m[key], ...patch } }));
  }, []);

  const addPhotos = (key: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setItems((m) => ({
      ...m, [key]: {
        ...m[key],
        photos: [...m[key].photos, ...arr],
        urls: [...m[key].urls, ...arr.map((f) => URL.createObjectURL(f))],
      },
    }));
  };

  const advance = (key: string, how: "next" | "skip") => {
    setItem(key, how === "skip" ? { skipped: true, done: true } : { skipped: false, done: true });
    if (idx + 1 < checklist.length) setIdx(idx + 1);
    else setStage("summary");
  };

  const summary = useMemo(() => {
    const flagged = checklist.filter((c) => items[c.key]?.issue);
    const photos = checklist.reduce((n, c) => n + (items[c.key]?.photos.length ?? 0), 0);
    return { flagged, photos };
  }, [checklist, items]);

  const send = async () => {
    if (!overall || sending) return;
    setSending(true); setError("");
    try {
      const payloadItems = checklist.map((c) => {
        const s = items[c.key];
        const status = s.issue ? "defect" : s.skipped ? "skipped" : "ok";
        return { key: c.key, label: c.label, status, note: s.issue ? s.note : "" };
      });
      const fd = new FormData();
      fd.append("init_data", initDataRef.current);
      fd.append("payload", JSON.stringify({ vehicle_id: truckId || null, inspection_type: inspType, overall, items: payloadItems }));
      checklist.forEach((c) => {
        items[c.key].photos.forEach((f, i) => fd.append("photos", f, `${c.key}__${i}.jpg`));
      });
      const res = await fetch(`${API}/api/tg/submit`, { method: "POST", body: fd });
      if (!res.ok) { setError("Couldn't submit. Please try again."); setSending(false); return; }
      const r = await res.json();
      setDoneResult({ result: r.result, defects: r.defects });
      setStage("done");
      setTimeout(() => { try { tgApp()?.close(); } catch { /* ignore */ } }, 2500);
    } catch { setError("Network error. Please try again."); setSending(false); }
  };

  // ---- render ----
  const Shell = ({ children }: { children: React.ReactNode }) => (
    <div className="mx-auto max-w-lg px-4 py-5">{children}</div>
  );

  if (stage === "loading") return <Shell><p className="py-16 text-center text-steel">Loading…</p></Shell>;
  if (stage === "error") return (
    <Shell>
      <div className="card p-6 text-center">
        <p className="text-4xl">🔌</p>
        <p className="mt-3 font-semibold">{error}</p>
      </div>
    </Shell>
  );

  if (stage === "setup" && ctx) return (
    <Shell>
      <h1 className="text-xl font-bold">Hi {ctx.driver_name} 👋</h1>
      <p className="mt-0.5 text-sm text-steel">Let&apos;s run your inspection.</p>

      <p className="mt-5 text-sm font-semibold">Which truck?</p>
      {ctx.trucks.length === 0 ? (
        <p className="mt-2 text-sm text-steel">No trucks on your fleet yet — ask dispatch.</p>
      ) : (
        <select className="field mt-2 w-full" value={truckId} onChange={(e) => setTruckId(e.target.value)}>
          {ctx.trucks.map((t) => <option key={t.id} value={t.id}>#{t.unit_number}</option>)}
        </select>
      )}

      <p className="mt-5 text-sm font-semibold">Which inspection is this?</p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        {([["pre", "Pre-trip", "Before you roll out"], ["post", "Post-trip", "After your run"]] as const).map(([k, t, s]) => (
          <button key={k} onClick={() => setInspType(k)}
            className={`rounded-xl border p-4 text-left transition-colors ${
              inspType === k ? "border-pine bg-pine-wash" : "border-line bg-panel"}`}>
            <span className="block font-bold">{t}</span>
            <span className="mt-0.5 block text-xs text-steel">{s}</span>
          </button>
        ))}
      </div>

      <button className="btn mt-6 w-full !py-3" disabled={!truckId}
        onClick={() => { setIdx(0); setStage("checklist"); }}>
        Start inspection
      </button>
    </Shell>
  );

  if (stage === "checklist" && cur && curState) return (
    <Shell>
      <div className="flex items-center justify-between text-xs text-steel">
        <span>Step {idx + 1} of {checklist.length}</span>
        <span>#{ctx?.trucks.find((t) => t.id === truckId)?.unit_number}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-pine" style={{ width: `${((idx) / checklist.length) * 100}%` }} />
      </div>

      <h2 className="mt-4 text-lg font-bold">{cur.label}</h2>
      <p className="mt-0.5 text-sm text-steel">Take a clear photo, or skip if not applicable.</p>

      {curState.urls.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {curState.urls.map((u, i) => <img key={i} src={u} alt="" className="h-20 w-20 rounded-lg object-cover" />)}
        </div>
      )}

      <label className="btn-quiet mt-3 block w-full cursor-pointer text-center !py-3">
        📷 {curState.photos.length ? "Add another photo" : "Take photo"}
        <input type="file" accept="image/*" capture="environment" multiple className="hidden"
          onChange={(e) => addPhotos(cur.key, e.target.files)} />
      </label>

      <button onClick={() => setItem(cur.key, { issue: !curState.issue })}
        className={`mt-3 w-full rounded-lg border px-3 py-2.5 text-sm font-semibold ${
          curState.issue ? "border-danger bg-danger-wash text-danger" : "border-line bg-panel text-steel"}`}>
        {curState.issue ? "⚠️ Problem flagged" : "⚠️ Report a problem"}
      </button>
      {curState.issue && (
        <textarea className="field mt-2 w-full" rows={2} placeholder="What's wrong? (optional)"
          value={curState.note} onChange={(e) => setItem(cur.key, { note: e.target.value })} />
      )}

      <div className="mt-5 flex gap-2">
        <button className="btn-quiet flex-1 !py-3" onClick={() => advance(cur.key, "skip")}>Skip</button>
        <button className="btn flex-1 !py-3" onClick={() => advance(cur.key, "next")}>
          {idx + 1 < checklist.length ? "Next" : "Review"}
        </button>
      </div>
    </Shell>
  );

  if (stage === "summary") return (
    <Shell>
      <h1 className="text-xl font-bold">Review & send</h1>
      <p className="mt-0.5 text-sm text-steel">
        #{ctx?.trucks.find((t) => t.id === truckId)?.unit_number} · {inspType === "pre" ? "Pre-trip" : "Post-trip"} · {summary.photos} photo{summary.photos === 1 ? "" : "s"}
      </p>

      <ul className="mt-4 divide-y divide-line rounded-lg border border-line bg-panel">
        {checklist.map((c) => {
          const s = items[c.key];
          return (
            <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 truncate">{c.label}</span>
              <span className="shrink-0 text-xs font-semibold">
                {s.issue ? <span className="text-danger">⚠️ Issue</span>
                  : s.skipped ? <span className="text-faint">Skipped</span>
                  : <span className="text-pine">✓ OK{s.photos.length ? ` · ${s.photos.length}📷` : ""}</span>}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-5 text-sm font-semibold">Anything wrong? <span className="font-normal text-steel">Your office sees this first.</span></p>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <button onClick={() => setOverall("all_good")}
          className={`rounded-xl border p-4 font-bold transition-colors ${
            overall === "all_good" ? "border-pine bg-pine-wash text-pine" : "border-line bg-panel"}`}>👍 All good</button>
        <button onClick={() => setOverall("found_issue")}
          className={`rounded-xl border p-4 font-bold transition-colors ${
            overall === "found_issue" ? "border-danger bg-danger-wash text-danger" : "border-line bg-panel"}`}>⚠️ Found an issue</button>
      </div>

      {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
      <button className="btn mt-5 w-full !py-3" disabled={!overall || sending} onClick={send}>
        {sending ? "Sending…" : "Send"}
      </button>
      {!overall && <p className="mt-2 text-center text-xs text-faint">Answer the question above first.</p>}
      <button className="mt-3 w-full text-sm text-steel" onClick={() => { setIdx(0); setStage("checklist"); }}>← Back to checklist</button>
    </Shell>
  );

  if (stage === "done") return (
    <Shell>
      <div className="card p-8 text-center">
        <p className="text-5xl">{doneResult?.result === "pass" ? "✅" : "⚠️"}</p>
        <p className="mt-3 text-lg font-bold">Inspection sent</p>
        <p className="mt-1 text-sm text-steel">
          {doneResult?.result === "pass" ? "All good — safe travels!"
            : `${doneResult?.defects} issue(s) reported. Dispatch has been notified.`}
        </p>
      </div>
    </Shell>
  );

  return null;
}
