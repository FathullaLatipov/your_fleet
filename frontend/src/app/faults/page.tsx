"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { EngineFault, FaultRow } from "@/components/FaultCard";
import { Loader } from "@/components/Loader";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

interface FleetFault extends EngineFault {
  vehicle_id: string;
  unit_number: string;
}

function FaultsInner() {
  const { user } = useAuth();
  const [faults, setFaults] = useState<FleetFault[] | null>(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api<FleetFault[]>("/api/fleet/faults", { params: { active } })
      .then((f) => { setFaults(f); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [active]);
  useEffect(() => { if (user) load(); }, [user, load]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
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
          {active ? "No active engine faults. 🎉" : "No fault history yet."}
        </p>
      ) : (
        <div className="mt-5 space-y-3">
          {faults.map((f) => (
            <div key={f.id} className="card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Link href={`/fleet/${f.vehicle_id}?tab=faults`}
                      className="rounded bg-mist px-2 py-0.5 text-sm font-bold text-steel hover:text-ink">
                  #{f.unit_number}
                </Link>
              </div>
              <FaultRow f={f} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FaultsPage() {
  return (
    <AppShell title="Engine faults">
      <FaultsInner />
    </AppShell>
  );
}
