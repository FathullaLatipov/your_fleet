"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { Booking, BusinessDetail, Vehicle } from "@/lib/types";

export function BookingForm({
  business,
  offerId,
  onClose,
  initialIssue = "",
  initialVehicleId = null,
  defectId = null,
}: {
  business: BusinessDetail;
  offerId: string | null;
  onClose: () => void;
  initialIssue?: string;
  initialVehicleId?: string | null;
  defectId?: string | null;
}) {
  const router = useRouter();
  const [issue, setIssue] = useState(initialIssue);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState<string>(initialVehicleId ?? "");

  useEffect(() => {
    api<Vehicle[]>("/api/fleet/vehicles").then(setVehicles).catch(() => {});
  }, []);
  const [urgency, setUrgency] = useState<"scheduled" | "emergency">("scheduled");
  const [truckMake, setTruckMake] = useState("");
  const [truckModel, setTruckModel] = useState("");
  const [truckYear, setTruckYear] = useState("");
  const [locationText, setLocationText] = useState("");
  const [preferred, setPreferred] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offer = offerId ? business.offers.find((o) => o.id === offerId) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const truck_info: Record<string, string> = {};
      if (truckMake) truck_info.make = truckMake;
      if (truckModel) truck_info.model = truckModel;
      if (truckYear) truck_info.year = truckYear;
      const booking = await api<Booking>("/api/bookings", {
        method: "POST",
        body: {
          business_id: business.id,
          offer_id: offerId,
          vehicle_id: vehicleId || null,
          defect_id: vehicleId && vehicleId === (initialVehicleId ?? "") ? defectId : null,
          issue_description: issue,
          urgency,
          truck_info: Object.keys(truck_info).length ? truck_info : null,
          location_text: locationText || null,
          preferred_time: preferred ? new Date(preferred).toISOString() : null,
          share_contact_consent: consent,
        },
      });
      router.push(`/bookings/${booking.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-ink/50 p-0 sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Request repair at ${business.name}`}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <form
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t border border-line bg-panel p-6 sm:rounded"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">Request repair</h2>
            <p className="text-sm text-steel">{business.name}</p>
            {offer && (
              <p className="mt-1 rounded bg-amber-wash px-2 py-1 text-sm font-medium text-amber-ink">
                Using offer: {offer.title}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="btn-quiet !px-2.5 !py-1" aria-label="Close">
            ✕
          </button>
        </div>

        <label className="mt-4 block text-sm font-medium text-steel" htmlFor="bk-issue">
          What&apos;s wrong with the truck? <span className="text-danger">*</span>
        </label>
        <textarea
          id="bk-issue"
          className="field mt-1 min-h-28"
          required
          minLength={10}
          maxLength={5000}
          placeholder="e.g. 2019 Freightliner Cascadia, check engine light with DPF code, losing power uphill"
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
        />

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-steel">Urgency</legend>
          <div className="mt-1 flex gap-2">
            <label className={`flex-1 cursor-pointer rounded border px-3 py-2 text-sm font-medium ${urgency === "scheduled" ? "border-pine bg-pine-wash text-pine" : "border-line"}`}>
              <input type="radio" name="urgency" className="sr-only" checked={urgency === "scheduled"}
                     onChange={() => setUrgency("scheduled")} />
              Scheduled visit
            </label>
            <label className={`flex-1 cursor-pointer rounded border px-3 py-2 text-sm font-medium ${urgency === "emergency" ? "border-danger bg-danger-wash text-danger" : "border-line"}`}>
              <input type="radio" name="urgency" className="sr-only" checked={urgency === "emergency"}
                     onChange={() => setUrgency("emergency")} />
              Emergency — broken down now
            </label>
          </div>
          {urgency === "emergency" && (
            <p className="mt-1.5 text-xs text-steel">
              An emergency request alerts the shop but is not a guarantee of immediate help.
              If you&apos;re in danger, call 911. Calling the shop directly is often faster.
            </p>
          )}
        </fieldset>

        {vehicles.length > 0 && (
          <div className="mt-4">
            <label className="text-sm font-medium text-steel" htmlFor="bk-vehicle">
              Which truck? (links the repair to your fleet records)
            </label>
            <select id="bk-vehicle" className="field mt-1" value={vehicleId}
                    onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Not from my fleet list</option>
              {vehicles.map((veh) => (
                <option key={veh.id} value={veh.id}>
                  #{veh.unit_number} {[veh.year, veh.make, veh.model].filter(Boolean).join(" ")}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="mt-4 grid grid-cols-3 gap-2">
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="bk-make">Truck make</label>
            <input id="bk-make" className="field mt-1" value={truckMake} onChange={(e) => setTruckMake(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="bk-model">Model</label>
            <input id="bk-model" className="field mt-1" value={truckModel} onChange={(e) => setTruckModel(e.target.value)} />
          </div>
          <div>
            <label className="text-sm font-medium text-steel" htmlFor="bk-year">Year</label>
            <input id="bk-year" className="field mt-1" inputMode="numeric" value={truckYear} onChange={(e) => setTruckYear(e.target.value)} />
          </div>
        </div>

        <label className="mt-4 block text-sm font-medium text-steel" htmlFor="bk-loc">
          Where is the truck? (optional)
        </label>
        <input
          id="bk-loc"
          className="field mt-1"
          placeholder="e.g. I-35 mile marker 412, northbound shoulder"
          value={locationText}
          onChange={(e) => setLocationText(e.target.value)}
        />

        <label className="mt-4 block text-sm font-medium text-steel" htmlFor="bk-time">
          Preferred time (optional)
        </label>
        <input
          id="bk-time"
          type="datetime-local"
          className="field mt-1"
          value={preferred}
          onChange={(e) => setPreferred(e.target.value)}
        />

        <label className="mt-4 flex items-start gap-2 text-sm text-steel">
          <input type="checkbox" className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          Share my name and phone number with this shop so they can contact me about this request.
        </label>

        {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}

        <div className="mt-5 flex gap-2">
          <button type="submit" className="btn flex-1" disabled={submitting}>
            {submitting ? "Sending…" : "Send request"}
          </button>
          <button type="button" className="btn-quiet" onClick={onClose}>
            Cancel
          </button>
        </div>
        <p className="mt-3 text-xs text-faint">
          You pay the shop directly. Any additional labor, parts, or taxes must be explained to
          you by the shop before you approve them.
        </p>
      </form>
    </div>
  );
}
