"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { WO_PRIORITY_LABELS, WO_SERVICE_LABELS, WorkOrder } from "@/lib/workOrders";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  (process.env.NODE_ENV === "production" ? "" : "http://localhost:8000");

interface Opt { id: string; unit_number?: string; name?: string }

function NewRequestInner() {
  const { user } = useAuth();
  const router = useRouter();
  const [vehicles, setVehicles] = useState<Opt[]>([]);
  const [trailers, setTrailers] = useState<Opt[]>([]);
  const [drivers, setDrivers] = useState<Opt[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [trailerId, setTrailerId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [serviceType, setServiceType] = useState("repair");
  const [priority, setPriority] = useState("normal");
  const [description, setDescription] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    api<Opt[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
    api<Opt[]>("/api/fleet/trailers").then(setTrailers).catch(() => {});
    api<Opt[]>("/api/fleet/drivers").then(setDrivers).catch(() => {});
  }, [user]);

  async function submit() {
    if (!vehicleId && !trailerId) {
      setError("Pick a truck or a trailer for the request.");
      return;
    }
    if (description.trim().length < 3) {
      setError("Describe what needs service.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const wo = await api<WorkOrder>("/api/fleet/work-orders", {
        method: "POST",
        body: {
          vehicle_id: vehicleId || null,
          trailer_id: trailerId || null,
          driver_id: driverId || null,
          service_type: serviceType,
          priority,
          description: description.trim(),
        },
      });
      // Photos are optional; upload failures shouldn't lose the created order.
      let token: string | null = null;
      try { token = localStorage.getItem("yf_token"); } catch { /* ignore */ }
      for (const f of photos) {
        const fd = new FormData();
        fd.append("file", f);
        await fetch(
          `${API_URL}/api/fleet/work-orders/${wo.id}/attachments?kind=photo`,
          { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body: fd },
        ).catch(() => {});
      }
      router.push(`/work-orders/${wo.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't create the request");
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">
      <section className="card p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">New Repair Request</h2>
          <Link href="/work-orders" className="text-sm font-medium text-steel hover:text-ink">
            ← Back to work orders
          </Link>
        </div>
        <p className="mt-0.5 text-sm text-steel">
          Opens a work order; next you&apos;ll pick a shop and collect quotes.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="wo-truck">Truck</label>
            <select id="wo-truck" className="field mt-1 !py-2 text-sm" value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">— none —</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>#{v.unit_number}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="wo-trailer">Trailer</label>
            <select id="wo-trailer" className="field mt-1 !py-2 text-sm" value={trailerId}
                    onChange={(e) => setTrailerId(e.target.value)}>
              <option value="">— none —</option>
              {trailers.map((t) => <option key={t.id} value={t.id}>#{t.unit_number}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="wo-driver">
              Driver <span className="text-faint">(optional)</span>
            </label>
            <select id="wo-driver" className="field mt-1 !py-2 text-sm" value={driverId}
                    onChange={(e) => setDriverId(e.target.value)}>
              <option value="">— none —</option>
              {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-steel" htmlFor="wo-type">Service Type</label>
            <select id="wo-type" className="field mt-1 !py-2 text-sm" value={serviceType}
                    onChange={(e) => setServiceType(e.target.value)}>
              {Object.entries(WO_SERVICE_LABELS).map(([k, v]) =>
                <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <span className="text-xs font-medium text-steel">Priority</span>
          <div className="mt-1.5 flex gap-1.5">
            {Object.entries(WO_PRIORITY_LABELS).map(([k, v]) => (
              <button key={k} type="button" onClick={() => setPriority(k)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                  priority === k
                    ? k === "normal" ? "bg-charcoal text-white" : "bg-cta text-white"
                    : "bg-mist text-steel hover:text-ink"
                }`}>
                {v}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-steel" htmlFor="wo-desc">Description</label>
          <textarea id="wo-desc" rows={4} className="field mt-1 text-sm"
                    placeholder="What's wrong / what needs to be done"
                    value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>

        <div className="mt-4">
          <label className="text-xs font-medium text-steel" htmlFor="wo-photos">
            Photos <span className="text-faint">(optional, JPEG/PNG/WebP)</span>
          </label>
          <input id="wo-photos" type="file" accept="image/jpeg,image/png,image/webp" multiple
                 className="mt-1 block w-full text-sm text-steel file:mr-3 file:rounded-lg file:border-0 file:bg-mist file:px-3 file:py-2 file:text-sm file:font-semibold file:text-ink hover:file:bg-line/60"
                 onChange={(e) => setPhotos(Array.from(e.target.files ?? []))} />
          {photos.length > 0 && (
            <p className="mt-1 text-xs text-faint">{photos.length} photo{photos.length === 1 ? "" : "s"} selected</p>
          )}
        </div>

        {error && <p className="mt-4 text-sm font-medium text-danger">{error}</p>}

        <button className="btn mt-5 w-full sm:w-auto" disabled={busy} onClick={() => void submit()}>
          {busy ? "Creating…" : "Create Request"}
        </button>
      </section>
    </div>
  );
}

export default function NewWorkOrderPage() {
  return (
    <AppShell title="New repair request">
      <NewRequestInner />
    </AppShell>
  );
}
