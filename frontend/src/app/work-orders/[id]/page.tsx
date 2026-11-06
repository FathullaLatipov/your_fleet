"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { fmtUsd } from "@/lib/types";
import {
  WO_PAY_LABELS,
  WO_PRIORITY_LABELS,
  WO_SERVICE_LABELS,
  WO_STATUS_LABELS,
  WO_STATUS_ORDER,
  WoAttachment,
  WoQuote,
  WorkOrder,
  statusPill,
  unitLabel,
} from "@/lib/workOrders";

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

function dollarsToCents(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number(s.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/* ------------------------------------------------------------- stepper */

function Stepper({ status }: { status: WorkOrder["status"] }) {
  const current = WO_STATUS_ORDER.indexOf(status);
  return (
    <ol className="mt-4 flex flex-wrap items-center gap-y-2">
      {WO_STATUS_ORDER.map((s, i) => {
        const done = i < current || status === "closed";
        const active = i === current && status !== "closed";
        return (
          <li key={s} className="flex items-center">
            {i > 0 && <span className={`mx-1.5 h-px w-4 sm:w-6 ${i <= current ? "bg-pine" : "bg-line"}`} />}
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
              active ? "bg-charcoal text-white"
              : done ? "bg-pine-wash text-pine"
              : "bg-mist text-faint"
            }`}>
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${
                active ? "bg-cta" : done ? "bg-pine" : "bg-line"
              }`} />
              {WO_STATUS_LABELS[s]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------- page */

function WorkOrderInner() {
  const { user } = useAuth();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  // Stage form state
  const [callType, setCallType] = useState<"scheduled" | "roadside">("scheduled");
  const [assignShop, setAssignShop] = useState("");
  const [qShop, setQShop] = useState("");
  const [qPrice, setQPrice] = useState("");
  const [qEta, setQEta] = useState("");
  const [qNote, setQNote] = useState("");
  const [negotiateId, setNegotiateId] = useState<string | null>(null);
  const [negotiateText, setNegotiateText] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const [updateNote, setUpdateNote] = useState("");
  const [finalAmount, setFinalAmount] = useState("");
  const [discount, setDiscount] = useState("");
  const [payMethod, setPayMethod] = useState("efs");
  const [closeNotes, setCloseNotes] = useState("");

  const load = useCallback(() => {
    setError(null);
    api<WorkOrder>(`/api/fleet/work-orders/${id}`)
      .then(setWo)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [id]);

  useEffect(() => {
    if (user) load();
  }, [user, load]);

  async function act(key: string, path: string, body?: unknown) {
    setBusy(key);
    setActionError(null);
    try {
      const updated = await api<WorkOrder>(`/api/fleet/work-orders/${id}${path}`, {
        method: "POST",
        body,
      });
      setWo(updated);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function upload(kind: "photo" | "invoice" | "payment_proof", file: File) {
    setBusy(`upload:${kind}`);
    setActionError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(
        `${API_URL}/api/fleet/work-orders/${id}/attachments?kind=${kind}`,
        { method: "POST", headers: authHeaders(), body: fd },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          data && typeof data === "object" && "detail" in data && typeof data.detail === "string"
            ? data.detail : `Upload failed (${res.status})`,
        );
      }
      const fresh = await api<WorkOrder>(`/api/fleet/work-orders/${id}`);
      setWo(fresh);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy("");
    }
  }

  async function downloadAttachment(a: WoAttachment) {
    setBusy(`dl:${a.id}`);
    try {
      const res = await fetch(
        `${API_URL}/api/fleet/work-orders/${id}/attachments/${a.id}`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const el = document.createElement("a");
      el.href = url;
      el.download = a.original_name ?? `${a.kind}-${a.id.slice(0, 8)}`;
      document.body.appendChild(el);
      el.click();
      el.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy("");
    }
  }

  if (error && wo === null) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="card p-6">
          <p className="font-semibold">Couldn&apos;t load this work order.</p>
          <p className="mt-1 text-sm text-steel">({error})</p>
          <button className="btn-quiet mt-4 !py-2 text-sm" onClick={load}>Try again</button>
        </div>
      </div>
    );
  }
  if (wo === null) return <div className="mx-auto max-w-4xl px-4 py-6"><Loader /></div>;

  const invoices = (wo.attachments ?? []).filter((a) => a.kind === "invoice");
  const proofs = (wo.attachments ?? []).filter((a) => a.kind === "payment_proof");
  const photos = (wo.attachments ?? []).filter((a) => a.kind === "photo");
  const acceptedQuote = (wo.quotes ?? []).find((q) => q.id === wo.accepted_quote_id) ?? null;

  const quoteRow = (q: WoQuote) => (
    <div key={q.id}
         className={`rounded-lg border p-3.5 ${
           q.status === "accepted" ? "border-pine/50 bg-pine-wash/60"
           : q.status === "declined" ? "border-line bg-mist/50 opacity-60"
           : "border-line"
         }`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold">
            {q.shop_name}
            {q.status === "accepted" && (
              <span className="ml-2 rounded bg-pine px-1.5 py-0.5 text-xs font-semibold text-white">Accepted</span>
            )}
            {q.status === "declined" && (
              <span className="ml-2 rounded bg-mist px-1.5 py-0.5 text-xs font-medium text-steel">Declined</span>
            )}
          </p>
          <p className="mt-0.5 text-sm text-steel">
            {q.price_cents != null ? <span className="font-semibold text-ink">{fmtUsd(q.price_cents)}</span> : "No price yet"}
            {q.eta && <span> · ETA: {q.eta}</span>}
          </p>
          {q.note && <p className="mt-1 text-sm text-steel">{q.note}</p>}
        </div>
        {wo.status === "quote_received" && q.status === "pending" && (
          <div className="flex gap-2">
            <button className="btn !py-1.5 !px-3 text-xs" disabled={busy !== ""}
                    onClick={() => void act(`accept:${q.id}`, `/quotes/${q.id}/accept`)}>
              {busy === `accept:${q.id}` ? "…" : "Accept Quote"}
            </button>
            <button className="btn-quiet !py-1.5 !px-3 text-xs" disabled={busy !== ""}
                    onClick={() => { setNegotiateId(negotiateId === q.id ? null : q.id); setNegotiateText(""); }}>
              Negotiate
            </button>
          </div>
        )}
      </div>
      {negotiateId === q.id && (
        <div className="mt-2.5 flex gap-2">
          <input className="field !py-2 text-sm" placeholder="Counter-offer / message for the shop log"
                 value={negotiateText} onChange={(e) => setNegotiateText(e.target.value)} />
          <button className="btn-forest !py-2 text-sm whitespace-nowrap"
                  disabled={busy !== "" || !negotiateText.trim()}
                  onClick={async () => {
                    if (await act(`neg:${q.id}`, `/quotes/${q.id}/negotiate`, { note: negotiateText.trim() })) {
                      setNegotiateId(null);
                    }
                  }}>
            {busy === `neg:${q.id}` ? "…" : "Log note"}
          </button>
        </div>
      )}
    </div>
  );

  const addQuoteForm = (
    <div className="mt-3 rounded-lg border border-dashed border-line bg-mist/50 p-3.5">
      <p className="text-sm font-semibold">Record a quote</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <input className="field !py-2 text-sm" placeholder="Shop name"
               value={qShop} onChange={(e) => setQShop(e.target.value)} />
        <input className="field !py-2 text-sm" placeholder="Quoted price, $ (optional)"
               inputMode="decimal" value={qPrice} onChange={(e) => setQPrice(e.target.value)} />
        <input className="field !py-2 text-sm" placeholder="Estimated time / completion date"
               value={qEta} onChange={(e) => setQEta(e.target.value)} />
        <input className="field !py-2 text-sm" placeholder="Note (optional)"
               value={qNote} onChange={(e) => setQNote(e.target.value)} />
      </div>
      <button className="btn mt-2.5 !py-2 text-sm" disabled={busy !== "" || qShop.trim().length < 2}
              onClick={async () => {
                const price = dollarsToCents(qPrice);
                if (qPrice.trim() && price === null) { setActionError("Enter the price as a number"); return; }
                if (await act("quote", "/quotes", {
                  shop_name: qShop.trim(), price_cents: price,
                  eta: qEta.trim() || null, note: qNote.trim() || null,
                })) {
                  setQShop(""); setQPrice(""); setQEta(""); setQNote("");
                }
              }}>
        {busy === "quote" ? "Saving…" : "Add Quote"}
      </button>
    </div>
  );

  /* -------------------------------------------- stage panel */

  let stagePanel: ReactNode = null;
  if (wo.status === "open") {
    stagePanel = (
      <div>
        <h3 className="font-bold">Looking for Shop</h3>
        <p className="mt-0.5 text-sm text-steel">Pick how this job goes out, then send it.</p>
        <div className="mt-3 flex gap-1.5">
          {([["scheduled", "Scheduled Service"], ["roadside", "Roadside Call"]] as const).map(([k, v]) => (
            <button key={k} onClick={() => setCallType(k)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                callType === k ? "bg-charcoal text-white" : "bg-mist text-steel hover:text-ink"
              }`}>
              {v}
            </button>
          ))}
        </div>
        <input className="field mt-3 !py-2 text-sm"
               placeholder="Preferred shop (optional — leave empty to shop around)"
               value={assignShop} onChange={(e) => setAssignShop(e.target.value)} />
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn !py-2 text-sm" disabled={busy !== ""}
                  onClick={() => void act("send", "/send", { call_type: callType, shop_name: assignShop.trim() || null })}>
            {busy === "send" ? "Sending…" : assignShop.trim() ? "Assign Shop" : "Send Request"}
          </button>
          <Link href={`/map?assign_wo=${wo.id}&wo=${wo.wo_number}${wo.priority === "roadside" ? "&service=towing" : ""}`}
                className="btn-quiet !py-2 text-sm">
            Select Preferred Shop on the map
          </Link>
        </div>
      </div>
    );
  } else if (wo.status === "looking_for_shop") {
    stagePanel = (
      <div>
        <h3 className="font-bold">Looking for Shop</h3>
        <p className="mt-0.5 text-sm text-steel">
          {wo.call_type === "roadside" ? "Roadside call" : "Scheduled service"}
          {wo.shop_name ? <> · assigned to <span className="font-semibold text-ink">{wo.shop_name}</span></> : " · collecting quotes"}
          . Record each quote as shops come back to you.
        </p>
        <Link href={`/map?assign_wo=${wo.id}&wo=${wo.wo_number}`}
              className="btn-quiet mt-3 inline-block !py-2 text-sm">
          {wo.shop_name ? "Change shop on the map" : "Pick a shop on the map"}
        </Link>
        {addQuoteForm}
      </div>
    );
  } else if (wo.status === "quote_received") {
    stagePanel = (
      <div>
        <h3 className="font-bold">{acceptedQuote ? "Approval" : "Quote Received"}</h3>
        {acceptedQuote ? (
          <div className="mt-2 rounded-lg border border-pine/40 bg-pine-wash/60 p-4">
            <p className="text-sm">
              <span className="font-semibold">{acceptedQuote.shop_name}</span>
              {acceptedQuote.price_cents != null && <> — <span className="font-bold">{fmtUsd(acceptedQuote.price_cents)}</span></>}
              {acceptedQuote.eta && <> · {acceptedQuote.eta}</>}
            </p>
            <p className="mt-1 text-xs text-steel">
              Approve to lock the job in. After the shop confirms receipt it moves to In Progress.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button className="btn !py-2 text-sm" disabled={busy !== ""}
                      onClick={() => void act("approve", "/approve")}>
                {busy === "approve" ? "…" : "Approve"}
              </button>
              <button className="btn-danger !py-2 text-sm" disabled={busy !== ""}
                      onClick={() => void act("reject", "/reject",
                        rejectNote.trim() ? { note: rejectNote.trim() } : { note: "Rejected" })}>
                {busy === "reject" ? "…" : "Reject"}
              </button>
              <input className="field !w-64 !py-2 text-sm" placeholder="Reject reason (optional)"
                     value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} />
            </div>
          </div>
        ) : (
          <p className="mt-0.5 text-sm text-steel">
            Accept the quote that works, negotiate, or keep collecting.
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="btn-quiet !py-2 text-sm" disabled={busy !== ""}
                  onClick={() => void act("another", "/request-another-quote")}>
            {busy === "another" ? "…" : "Request Another Quote"}
          </button>
        </div>
      </div>
    );
  } else if (wo.status === "approved") {
    stagePanel = (
      <div>
        <h3 className="font-bold">Approved — waiting on the shop</h3>
        <p className="mt-0.5 text-sm text-steel">
          {wo.shop_name ?? "The shop"} has the approved job. Once they confirm receipt, work starts
          and the unit is marked in repair.
        </p>
        <button className="btn mt-3 !py-2 text-sm" disabled={busy !== ""}
                onClick={() => void act("confirm", "/confirm")}>
          {busy === "confirm" ? "…" : "Shop Confirmed Receipt — Start Work"}
        </button>
      </div>
    );
  } else if (wo.status === "in_progress") {
    const lastEvent = (wo.events ?? []).slice(-1)[0];
    stagePanel = (
      <div>
        <h3 className="font-bold">In Progress at {wo.shop_name ?? "the shop"}</h3>
        {lastEvent && (
          <p className="mt-0.5 text-sm text-steel">
            Last update: {lastEvent.note ?? WO_STATUS_LABELS[(lastEvent.to_status ?? "open") as WorkOrder["status"]]}
            {" "}· {new Date(lastEvent.created_at).toLocaleString()}
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <input className="field !py-2 text-sm" placeholder="Log an update / request status from the shop"
                 value={updateNote} onChange={(e) => setUpdateNote(e.target.value)} />
          <button className="btn-quiet !py-2 text-sm whitespace-nowrap"
                  disabled={busy !== "" || !updateNote.trim()}
                  onClick={async () => {
                    if (await act("note", "/notes", { note: updateNote.trim() })) setUpdateNote("");
                  }}>
            {busy === "note" ? "…" : "Request Update"}
          </button>
        </div>
        <button className="btn mt-3 !py-2 text-sm" disabled={busy !== ""}
                onClick={() => void act("ready", "/ready")}>
          {busy === "ready" ? "…" : "Shop Says It's Ready"}
        </button>
      </div>
    );
  } else if (wo.status === "ready") {
    const amount = dollarsToCents(finalAmount);
    stagePanel = (
      <div>
        <h3 className="font-bold">Close Repair Request</h3>
        <p className="mt-0.5 text-sm text-steel">
          Upload the shop invoice, enter what was actually paid, and close the job.
          Closing puts the unit back to available.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs font-semibold text-steel">Shop Invoice <span className="text-danger">*</span></p>
            {invoices.map((a) => (
              <p key={a.id} className="mt-1 truncate text-sm">
                📄 {a.original_name ?? "invoice"}{" "}
                <button className="text-xs font-semibold text-pine hover:underline"
                        onClick={() => void downloadAttachment(a)}>view</button>
              </p>
            ))}
            <label className="btn-quiet mt-2 inline-block cursor-pointer !py-1.5 text-xs">
              {busy === "upload:invoice" ? "Uploading…" : "Upload Invoice"}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("invoice", f); e.target.value = ""; }} />
            </label>
          </div>
          <div className="rounded-lg border border-line p-3">
            <p className="text-xs font-semibold text-steel">Payment Proof / Check (optional)</p>
            {proofs.map((a) => (
              <p key={a.id} className="mt-1 truncate text-sm">
                🧾 {a.original_name ?? "proof"}{" "}
                <button className="text-xs font-semibold text-pine hover:underline"
                        onClick={() => void downloadAttachment(a)}>view</button>
              </p>
            ))}
            <label className="btn-quiet mt-2 inline-block cursor-pointer !py-1.5 text-xs">
              {busy === "upload:payment_proof" ? "Uploading…" : "Upload Payment Proof"}
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("payment_proof", f); e.target.value = ""; }} />
            </label>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="close-amount">Final Amount, $</label>
            <input id="close-amount" className="field mt-1 !py-2 text-sm" inputMode="decimal"
                   placeholder="0.00" value={finalAmount} onChange={(e) => setFinalAmount(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="close-discount">Discount, $ (if any)</label>
            <input id="close-discount" className="field mt-1 !py-2 text-sm" inputMode="decimal"
                   placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="close-pay">Payment Method</label>
            <select id="close-pay" className="field mt-1 !py-2 text-sm" value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value)}>
              {Object.entries(WO_PAY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <textarea rows={2} className="field mt-3 text-sm" placeholder="Notes (optional)"
                  value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />

        <button className="btn mt-3 !py-2 text-sm"
                disabled={busy !== "" || invoices.length === 0 || amount === null}
                onClick={() => void act("close", "/close", {
                  final_amount_cents: amount,
                  discount_cents: dollarsToCents(discount),
                  payment_method: payMethod,
                  notes: closeNotes.trim() || null,
                })}>
          {busy === "close" ? "Closing…" : "Close Request"}
        </button>
        {invoices.length === 0 && (
          <p className="mt-1.5 text-xs text-faint">The shop invoice is required to close.</p>
        )}
      </div>
    );
  } else {
    // closed
    stagePanel = (
      <div>
        <h3 className="font-bold">Closed</h3>
        <p className="mt-0.5 text-sm text-steel">
          Closed {wo.closed_at ? new Date(wo.closed_at).toLocaleString() : ""} — the unit is back to available.
          The final amount is on the truck&apos;s expense ledger and service records.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg bg-mist p-3">
            <p className="text-xs text-steel">Final Amount</p>
            <p className="text-lg font-bold tabular-nums">{fmtUsd(wo.final_amount_cents)}</p>
          </div>
          <div className="rounded-lg bg-mist p-3">
            <p className="text-xs text-steel">Discount</p>
            <p className="text-lg font-bold tabular-nums">{wo.discount_cents ? fmtUsd(wo.discount_cents) : "—"}</p>
          </div>
          <div className="rounded-lg bg-mist p-3">
            <p className="text-xs text-steel">Payment Method</p>
            <p className="text-lg font-bold">{wo.payment_method ? WO_PAY_LABELS[wo.payment_method] : "—"}</p>
          </div>
        </div>
        {wo.closing_notes && <p className="mt-3 text-sm text-steel">{wo.closing_notes}</p>}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      {/* Header card */}
      <section className="card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="text-lg font-bold">WO-{wo.wo_number}</h2>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusPill(wo.status)}`}>
                {WO_STATUS_LABELS[wo.status]}
              </span>
              {wo.priority !== "normal" && (
                <span className="rounded bg-cta/10 px-1.5 py-0.5 text-xs font-semibold text-cta">
                  {WO_PRIORITY_LABELS[wo.priority]}
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-steel">
              {unitLabel(wo)} · {WO_SERVICE_LABELS[wo.service_type] ?? wo.service_type}
              {wo.driver_name && <> · Driver: {wo.driver_name}</>}
              {" "}· opened {new Date(wo.created_at).toLocaleDateString()}
            </p>
          </div>
          <Link href="/work-orders" className="text-sm font-medium text-steel hover:text-ink">
            ← All work orders
          </Link>
        </div>
        <Stepper status={wo.status} />
        <p className="mt-4 whitespace-pre-wrap text-sm">{wo.description}</p>
        {wo.shop_name && wo.status !== "open" && (
          <p className="mt-2 text-sm text-steel">
            Shop: <span className="font-semibold text-ink">{wo.shop_name}</span>
            {wo.business_id && (
              <Link href={`/business/${wo.business_id}`} className="ml-2 text-xs font-semibold text-pine hover:underline">
                View profile
              </Link>
            )}
          </p>
        )}
      </section>

      {/* Stage panel */}
      <section className="card mt-4 p-5">
        {stagePanel}
        {actionError && <p className="mt-3 text-sm font-medium text-danger">{actionError}</p>}
      </section>

      {/* Quotes (kept visible after the quote stage too) */}
      {(wo.quotes ?? []).length > 0 && (
        <section className="card mt-4 p-5">
          <h3 className="font-bold">Quotes</h3>
          <div className="mt-3 space-y-2.5">{(wo.quotes ?? []).map(quoteRow)}</div>
        </section>
      )}

      {/* Photos & files */}
      <section className="card mt-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-bold">Photos & files</h3>
          {wo.status !== "closed" && (
            <label className="btn-quiet inline-block cursor-pointer !py-1.5 text-xs">
              {busy === "upload:photo" ? "Uploading…" : "Add photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload("photo", f); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {(wo.attachments ?? []).length === 0 ? (
          <p className="mt-2 text-sm text-faint">Nothing attached yet.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {(wo.attachments ?? []).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate">
                  {a.kind === "photo" ? "🖼" : a.kind === "invoice" ? "📄" : "🧾"}{" "}
                  {a.original_name ?? a.kind}
                  <span className="ml-1.5 text-xs text-faint">
                    {a.kind === "invoice" ? "Invoice" : a.kind === "payment_proof" ? "Payment proof" : "Photo"}
                  </span>
                </span>
                <button className="text-xs font-semibold text-pine hover:underline whitespace-nowrap"
                        disabled={busy !== ""}
                        onClick={() => void downloadAttachment(a)}>
                  {busy === `dl:${a.id}` ? "…" : "Download"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {photos.length === 0 && wo.status === "open" && (
          <p className="mt-2 text-xs text-faint">Tip: photos of the problem help shops quote faster.</p>
        )}
      </section>

      {/* Timeline */}
      <section className="card mt-4 p-5">
        <h3 className="font-bold">History</h3>
        <ol className="mt-3 space-y-2.5">
          {[...(wo.events ?? [])].reverse().map((e) => (
            <li key={e.id} className="flex gap-3 text-sm">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-pine" />
              <div>
                <p>
                  {e.note ?? (e.to_status ? `Status: ${WO_STATUS_LABELS[e.to_status as WorkOrder["status"]] ?? e.to_status}` : "")}
                  {e.note && e.to_status && e.from_status && (
                    <span className="ml-1.5 text-xs text-faint">
                      ({WO_STATUS_LABELS[e.from_status as WorkOrder["status"]] ?? e.from_status} →{" "}
                      {WO_STATUS_LABELS[e.to_status as WorkOrder["status"]] ?? e.to_status})
                    </span>
                  )}
                </p>
                <p className="text-xs text-faint">{new Date(e.created_at).toLocaleString()}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function WorkOrderDetailPage() {
  return (
    <AppShell title="Work order">
      <WorkOrderInner />
    </AppShell>
  );
}
