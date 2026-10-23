"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";

import { Stars, TrustBadges } from "@/components/badges";
import { api } from "@/lib/api";
import { CATEGORY_LABELS, fmtUsd, type SearchResponse } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-faint">Loading map…</div>,
});

const CHIP_FILTERS: [key: string, label: string][] = [
  ["partners", "Partners"],
  ["offers", "With offers"],
  ["verified", "Verified"],
  ["mobile", "Mobile service"],
  ["emergency", "Emergency"],
  ["open", "Open now"],
];

function SearchPageInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [location, setLocation] = useState(params.get("location") ?? "");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false); // mobile toggle

  const lat = params.get("lat");
  const lng = params.get("lng");
  const category = params.get("category") ?? "";
  const radius = params.get("radius") ?? "50";
  const sort = params.get("sort") ?? "distance";
  const page = Math.max(1, Number(params.get("page") ?? "1"));
  const PAGE_SIZE = 25;
  const flag = (k: string) => params.get(k) === "1";

  const setParam = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(updates)) {
        if (v === null || v === "") next.delete(k);
        else next.set(k, v);
      }
      if (!("page" in updates)) next.delete("page");
      router.replace(`/search?${next.toString()}`);
    },
    [params, router],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<SearchResponse>("/api/search", {
      params: {
        lat: lat ?? undefined,
        lng: lng ?? undefined,
        location: !lat ? (params.get("location") ?? undefined) : undefined,
        radius_miles: radius,
        category: category || undefined,
        partner_only: flag("partners"),
        has_offer: flag("offers"),
        verified_only: flag("verified"),
        mobile_only: flag("mobile"),
        emergency_only: flag("emergency"),
        open_now: flag("open"),
        sort,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      },
    })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Search failed");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  function submitLocation(e: React.FormEvent) {
    e.preventDefault();
    setParam({ location: location.trim() || null, lat: null, lng: null });
  }

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) =>
        setParam({
          lat: pos.coords.latitude.toFixed(5),
          lng: pos.coords.longitude.toFixed(5),
          location: null,
        }),
      () => setError("Location was blocked. Enter a city or ZIP instead."),
      { timeout: 10000 },
    );
  }

  const hasPoint = Boolean((lat && lng) || data?.resolved_location);
  const items = data?.items ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-[1600px] flex-col">
      {/* Toolbar */}
      <div className="border-b border-line bg-panel px-4 py-3">
        <form onSubmit={submitLocation} className="flex flex-wrap items-center gap-2">
          <input
            className="field !w-52"
            placeholder="City, ST or ZIP"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            aria-label="Search location"
          />
          <button type="submit" className="btn !py-2">Search</button>
          <button type="button" onClick={useMyLocation} className="btn-quiet !py-2">
            Near me
          </button>
          <select
            className="field !w-44"
            value={category}
            onChange={(e) => setParam({ category: e.target.value || null })}
            aria-label="Service category"
          >
            <option value="">All categories</option>
            {Object.entries(CATEGORY_LABELS).map(([slug, name]) => (
              <option key={slug} value={slug}>{name}</option>
            ))}
          </select>
          {hasPoint && (
            <select
              className="field !w-34"
              value={radius}
              onChange={(e) => setParam({ radius: e.target.value })}
              aria-label="Search radius"
            >
              {[25, 50, 100, 200, 300].map((r) => (
                <option key={r} value={r}>within {r} mi</option>
              ))}
            </select>
          )}
          <select
            className="field !w-44 ml-auto"
            value={sort}
            onChange={(e) => setParam({ sort: e.target.value })}
            aria-label="Sort order"
          >
            {hasPoint && <option value="distance">Nearest first</option>}
            <option value="rating">Highest rated</option>
            <option value="price">Lowest price first</option>
          </select>
        </form>
        <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label="Filters">
          {CHIP_FILTERS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="chip"
              data-on={flag(key)}
              aria-pressed={flag(key)}
              onClick={() => setParam({ [key]: flag(key) ? null : "1" })}
            >
              {flag(key) && <span aria-hidden>✓</span>}
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Mobile map/list toggle */}
      <div className="flex border-b border-line bg-panel lg:hidden">
        {(["List", "Map"] as const).map((label) => (
          <button
            key={label}
            className={`flex-1 py-2 text-sm font-semibold ${
              (label === "Map") === showMap ? "border-b-2 border-pine text-pine" : "text-steel"
            }`}
            onClick={() => setShowMap(label === "Map")}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Results list */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto bg-mist lg:max-w-[580px] lg:border-r lg:border-line ${showMap ? "hidden lg:block" : ""}`}
        >
          {loading ? (
            <p className="p-6 text-steel">Searching…</p>
          ) : error ? (
            <div className="p-6">
              <p className="font-semibold text-danger">{error}</p>
              <p className="mt-1 text-sm text-steel">Check the location spelling, or widen the radius.</p>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <p className="display text-lg font-semibold">No shops found here.</p>
              <p className="mt-1 text-sm text-steel">
                Try a wider radius, a nearby city, or clear a filter — &quot;Open now&quot; and
                &quot;Mobile service&quot; only match shops that have verified those details.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5 p-3">
              <p className="px-1 text-sm text-steel">
                {data!.total.toLocaleString()} shop{data!.total === 1 ? "" : "s"} found
              </p>
              {items.map((b) => (
                <Link
                  key={b.id}
                  href={`/business/${b.id}`}
                  className="shop-card"
                  data-active={b.id === activeId}
                  onMouseEnter={() => setActiveId(b.id)}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <h3 className="display font-semibold leading-snug">{b.name}</h3>
                    {b.distance_miles != null && (
                      <span className="shrink-0 rounded bg-mist px-1.5 py-0.5 text-sm font-semibold text-steel">
                        {b.distance_miles} mi
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-steel">
                    <Stars avg={b.rating_avg} count={b.rating_count} />
                    <span>{CATEGORY_LABELS[b.category] ?? b.category}</span>
                    {b.city && <span>{b.city}, {b.state}</span>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <TrustBadges b={b} compact />
                    {b.is_mobile_service && (
                      <span className="rounded bg-pine-wash px-1.5 py-0.5 text-xs font-medium text-pine">Mobile service</span>
                    )}
                    {b.accepts_emergency && (
                      <span className="rounded bg-danger-wash px-1.5 py-0.5 text-xs font-medium text-danger">Emergency</span>
                    )}
                    {b.price_from_cents != null && (
                      <span className="ml-auto text-sm font-semibold text-ink">
                        from {fmtUsd(b.price_from_cents)}
                      </span>
                    )}
                  </div>
                  {b.phone && (
                    <p className="mt-1.5 text-sm font-medium text-pine">{b.phone}</p>
                  )}
                </Link>
              ))}
              {totalPages > 1 && (
                <div className="flex items-center justify-between px-1 py-2">
                  <button className="btn-quiet" disabled={page <= 1}
                          onClick={() => setParam({ page: String(page - 1) })}>
                    Previous
                  </button>
                  <span className="text-sm text-steel">Page {page} of {totalPages}</span>
                  <button className="btn-quiet" disabled={page >= totalPages}
                          onClick={() => setParam({ page: String(page + 1) })}>
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Map */}
        <div className={`relative min-h-0 flex-1 ${showMap ? "" : "hidden lg:block"}`}>
          <MapView items={items} activeId={activeId} onSelect={setActiveId} />
          <div className="absolute bottom-3 left-3 z-[500] rounded-md border border-line bg-panel/95 px-3 py-2 text-xs text-steel shadow">
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-charcoal" /> Directory
            </span>
            <span className="mr-3 inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-amber" /> Partner
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-cta" /> Partner offer
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={<p className="p-6 text-steel">Loading…</p>}>
      <SearchPageInner />
    </Suspense>
  );
}
