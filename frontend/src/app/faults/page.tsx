"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { FaultRow, FleetFault } from "@/components/FaultCard";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

function FaultsInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [faults, setFaults] = useState<FleetFault[] | null>(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setFaults(null);
    api<FleetFault[]>("/api/fleet/faults", { params: { active } })
      .then((f) => { setFaults(f); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [active]);
  useEffect(() => { if (user) load(); }, [user, load]);

  // Group by truck so one unit's codes read together.
  const byUnit: { unit: string; vehicleId: string; faults: FleetFault[] }[] = [];
  for (const f of faults ?? []) {
    let g = byUnit.find((x) => x.vehicleId === f.vehicle_id);
    if (!g) { g = { unit: f.unit_number, vehicleId: f.vehicle_id, faults: [] }; byUnit.push(g); }
    g.faults.push(f);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      {/* Back to wherever they came from (dashboard, fuel, …). */}
      <button type="button" onClick={() => router.back()}
              className="text-sm font-medium text-steel hover:text-ink">
        ← Back
      </button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-steel">
          Engine fault codes (J1939 SPN/FMI) from Samsara, newest first. Updates every 15 minutes.
        </p>
        <div className="flex gap-1">
          {([["active", true], ["all", false]] as const).map(([label, v]) => (
            <button key={label} onClick={() => setActive(v)}
                    className={`rounded-full px-3 py-1 text-sm font-semibold transition-colors ${
                      active === v ? "bg-charcoal text-white" : "bg-mist text-steel hover:text-ink"}`}>
              {label === "active" ? "Active" : "Active + cleared"}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}
      {faults === null ? (
        <div className="mt-6"><Loader /></div>
      ) : faults.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line bg-mist/50 px-4 py-12 text-center text-sm text-steel">
          {active ? "No active fault codes. 🎉" : "No fault history yet."}
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {byUnit.map((g) => (
            <div key={g.vehicleId} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Link href={`/fleet/${g.vehicleId}?tab=faults`}
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
  );
}

export default function FaultsPage() {
  return (
    <AppShell title="Fault codes">
      <FaultsInner />
    </AppShell>
  );
}
