"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { EngineFault, FaultRow } from "@/components/FaultCard";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";

export interface FleetFault extends EngineFault {
  vehicle_id: string;
  unit_number: string;
}

/* All engine fault codes across the fleet, in a modal. Replaces the old
   standalone /faults tab: it is opened from the dashboard's Fault codes card.
   Fetches on its own so the summary card stays cheap. */
export function FaultCodesModal({ onClose }: { onClose: () => void }) {
  const [faults, setFaults] = useState<FleetFault[] | null>(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFaults(null);
    api<FleetFault[]>("/api/fleet/faults", { params: { active } })
      .then((f) => { setFaults(f); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [active]);
  useEffect(() => { load(); }, [load]);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Group by unit so one truck's codes read together.
  const byUnit: { unit: string; vehicleId: string; faults: FleetFault[] }[] = [];
  for (const f of faults ?? []) {
    let g = byUnit.find((x) => x.vehicleId === f.vehicle_id);
    if (!g) { g = { unit: f.unit_number, vehicleId: f.vehicle_id, faults: [] }; byUnit.push(g); }
    g.faults.push(f);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-charcoal/40 px-4 py-6" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
           aria-label="Fault codes"
           className="card flex max-h-full w-full max-w-2xl flex-col overflow-hidden p-0">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="text-lg font-bold">Fault codes</h2>
            <p className="mt-0.5 text-sm text-steel">
              J1939 SPN/FMI from Samsara, newest first. Updates every 15 minutes.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-lg text-steel hover:bg-mist hover:text-ink">
            ×
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <div className="flex gap-1">
            {([["active", true], ["all", false]] as const).map(([label, v]) => (
              <button key={label} onClick={() => setActive(v)}
                      className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${
                        active === v ? "bg-charcoal text-white" : "bg-mist text-steel hover:text-ink"}`}>
                {label === "active" ? "Active" : "Active + cleared"}
              </button>
            ))}
          </div>
          {faults && (
            <span className="text-sm text-steel tabular-nums">
              {faults.length} code{faults.length === 1 ? "" : "s"}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {error ? (
            <p className="rounded-lg border border-dashed border-line bg-mist/50 px-4 py-10 text-center text-sm text-danger">
              {error}
            </p>
          ) : faults === null ? (
            <div className="py-6"><Loader /></div>
          ) : faults.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line bg-mist/50 px-4 py-12 text-center text-sm text-steel">
              {active ? "No active fault codes. 🎉" : "No fault history yet."}
            </p>
          ) : (
            <div className="space-y-4">
              {byUnit.map((g) => (
                <div key={g.vehicleId} className="card p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Link href={`/fleet/${g.vehicleId}?tab=faults`} onClick={onClose}
                          className="rounded bg-mist px-2 py-0.5 text-sm font-bold text-steel hover:text-ink">
                      #{g.unit}
                    </Link>
                    <span className="text-xs text-faint tabular-nums">
                      {g.faults.length} code{g.faults.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="space-y-3">
                    {g.faults.map((f) => <FaultRow key={f.id} f={f} />)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
