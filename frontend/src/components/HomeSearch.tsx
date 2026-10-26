"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function HomeSearch() {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const [geoError, setGeoError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  function go(params: URLSearchParams) {
    if (category) params.set("category", category);
    router.push(`/search?${params.toString()}`);
  }

  function searchByText(e: React.FormEvent) {
    e.preventDefault();
    const params = new URLSearchParams();
    if (location.trim()) params.set("location", location.trim());
    go(params);
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setGeoError("Your browser doesn't support location. Enter a city or ZIP instead.");
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const params = new URLSearchParams({
          lat: pos.coords.latitude.toFixed(5),
          lng: pos.coords.longitude.toFixed(5),
        });
        go(params);
      },
      () => {
        setLocating(false);
        setGeoError("Location was blocked. Enter a city or ZIP instead.");
      },
      { timeout: 10000 },
    );
  }

  return (
    <form
      onSubmit={searchByText}
      className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-panel p-6 shadow-(--shadow-pop)"
      aria-label="Search for truck repair"
    >
      <h2 className="display text-lg font-bold">Where&apos;s the truck?</h2>
      <label className="text-sm font-medium text-steel" htmlFor="home-loc">
        City, state, or ZIP
      </label>
      <input
        id="home-loc"
        className="field !py-2.5"
        placeholder="e.g. Dallas, TX or 75201"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      <label className="text-sm font-medium text-steel" htmlFor="home-cat">
        What do you need?
      </label>
      <select id="home-cat" className="field !py-2.5" value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="">Any service</option>
        <option value="truck_trailer">Truck & trailer repair</option>
        <option value="tire">Tires</option>
        <option value="towing">Towing</option>
        <option value="mobile_mechanic">Mobile mechanic</option>
        <option value="pickup_auto">Pickup & auto</option>
      </select>
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="submit" className="btn flex-1 !py-2.5">
          Search shops
        </button>
        <button type="button" onClick={useMyLocation} disabled={locating} className="btn-forest flex-1 !py-2.5">
          {locating ? "Locating…" : "Use my location"}
        </button>
      </div>
      {geoError && <p className="text-sm text-danger">{geoError}</p>}
      <p className="text-xs text-faint">
        Location is used only to find nearby shops. It isn&apos;t shared with anyone until you
        send a request and choose to share it.
      </p>
    </form>
  );
}
