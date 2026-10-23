"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { Stars, TrustBadges } from "@/components/badges";
import { api } from "@/lib/api";
import { CATEGORY_LABELS, type SearchResponse } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-faint">Loading map…</div>,
});

function SearchPageInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [location, setLocation] = useState(params.get("location") ?? "");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showMap, setShowMap] = useState(false); // mobile toggle
  const listRef = useRef<HTMLDivElement>(null);

  const lat = params.get("lat");
  const lng = params.get("lng");
  const category = params.get("category") ?? "";
  const radius = params.get("radius") ?? "50";
  const partnerOnly = params.get("partners") === "1";
  const offersOnly = params.get("offers") === "1";
  const verifiedOnly = params.get("verified") === "1";
  const sort = params.get("sort") ?? "distance";
  const page = Math.max(1, Number(params.get("page") ?? "1"));
  const PAGE_SIZE = 25;

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
        partner_only: partnerOnly,
        has_offer: offersOnly,
        verified_only: verifiedOnly,
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
  }, [lat, lng, radius, category, partnerOnly, offersOnly, verifiedOnly, sort, page, params]);

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
            className="field !w-56"
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
              className="field !w-36"
              value={radius}
              onChange={(e) => setParam({ radius: e.target.value })}
              aria-label="Search radius"
            >
              {[25, 50, 100, 200, 300].map((r) => (
                <option key={r} value={r}>within {r} mi</option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1.5 text-sm font-medium text-steel">
            <input type="checkbox" checked={partnerOnly}
                   onChange={(e) => setParam({ partners: e.target.checked ? "1" : null })} />
            Partners
          </label>
          <label className="flex items-center gap-1.5 text-sm font-medium text-steel">
            <input type="checkbox" checked={offersOnly}
                   onChange={(e) => setParam({ offers: e.target.checked ? "1" : null })} />
            With offers
          </label>
          <label className="flex items-center gap-1.5 text-sm font-medium text-steel">
            <input type="checkbox" checked={verifiedOnly}
                   onChange={(e) => setParam({ verified: e.target.checked ? "1" : null })} />
            Verified
          </label>
          {hasPoint && (
            <select className="field !w-40 ml-auto" value={sort}
                    onChange={(e) => setParam({ sort: e.target.value })} aria-label="Sort order">
              <option value="distance">Nearest first</option>
              <option value="rating">Highest rated</option>
            </select>
          )}
        </form>
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
          ref={listRef}
          className={`min-h-0 flex-1 overflow-y-auto lg:max-w-[560px] lg:border-r lg:border-line ${showMap ? "hidden lg:block" : ""}`}
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
              <p className="font-semibold">No shops found here.</p>
              <p className="mt-1 text-sm text-steel">
                Try a wider radius, a nearby city, or clear the filters.
              </p>
            </div>
          ) : (
            <>
              <p className="px-4 pt-3 text-sm text-steel">
                {data!.total.toLocaleString()} shop{data!.total === 1 ? "" : "s"} found
              </p>
              <ul>
                {items.map((b) => (
                  <li
                    key={b.id}
                    className={`border-b border-line px-4 py-3 ${b.id === activeId ? "bg-pine-wash" : "hover:bg-mist"}`}
                    onMouseEnter={() => setActiveId(b.id)}
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <Link href={`/business/${b.id}`} className="font-semibold text-ink hover:text-pine hover:underline">
                        {b.name}
                      </Link>
                      {b.distance_miles != null && (
                        <span className="shrink-0 text-sm font-medium text-steel">{b.distance_miles} mi</span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-steel">
                      <span>{CATEGORY_LABELS[b.category] ?? b.category}</span>
                      {b.city && <span>{b.city}, {b.state}</span>}
                      <Stars avg={b.rating_avg} count={b.rating_count} />
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <TrustBadges b={b} compact />
                      {b.phone && (
                        <a href={`tel:${b.phone}`} className="text-sm font-medium text-pine hover:underline">
                          {b.phone}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4">
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
            </>
          )}
        </div>

        {/* Map */}
        <div className={`min-h-0 flex-1 ${showMap ? "" : "hidden lg:block"}`}>
          <MapView items={items} activeId={activeId} onSelect={setActiveId} />
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
