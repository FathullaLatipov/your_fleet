"use client";

/* Contract for engine faults from /api/fleet/faults and
   /api/fleet/vehicles/{id}/faults. */
export interface EngineFault {
  id: string;
  protocol: string;
  spn: number | null;
  fmi: number | null;
  tx_id: number | null;
  source_name: string | null;
  spn_description: string | null;
  fmi_description: string | null;
  occurrence_count: number | null;
  mil_status: number | null;
  check_engine_light: boolean;
  is_active: boolean;
  first_seen_at: string | null;
  last_seen_at: string | null;
  cleared_at: string | null;
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

/* One fault laid out like the Samsara "Active Faults" panel. */
export function FaultRow({ f }: { f: EngineFault }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {f.tx_id != null && (
          <span className="rounded bg-mist px-1.5 py-0.5 text-xs font-semibold text-steel">TxId {f.tx_id}</span>
        )}
        {f.spn != null && <span className="font-semibold tabular-nums">SPN {f.spn}</span>}
        {f.spn_description && <span className="text-steel">· {f.spn_description}</span>}
        {f.check_engine_light && (
          <span className="rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink">
            Check engine
          </span>
        )}
        {!f.is_active && (
          <span className="rounded bg-pine-wash px-1.5 py-0.5 text-xs font-semibold text-pine">cleared</span>
        )}
      </div>
      <p className="mt-1 text-sm text-steel">
        {f.fmi != null && <span className="font-medium text-ink">FMI {f.fmi}</span>}
        {f.fmi_description && <> ({f.fmi_description})</>}
        {f.occurrence_count != null && <> · Count: <span className="tabular-nums">{f.occurrence_count}</span></>}
        {f.source_name && <> · {f.source_name}</>}
      </p>
      <p className="mt-1 text-xs text-faint">
        {f.is_active
          ? <>Active since {fmtDate(f.first_seen_at)} · last seen {fmtDate(f.last_seen_at)}</>
          : <>Cleared {fmtDate(f.cleared_at)}</>}
      </p>
    </div>
  );
}
