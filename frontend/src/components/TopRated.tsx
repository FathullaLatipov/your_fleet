"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { ShopImage } from "@/components/ShopImage";
import { GoogleRating, Stars } from "@/components/badges";
import { api } from "@/lib/api";
import { type BusinessListItem, type SearchResponse } from "@/lib/types";

const MIN_REVIEWS = 25; // a 5.0 with 3 reviews must not outrank a 4.9 with thousands

export function TopRated() {
  const [items, setItems] = useState<BusinessListItem[] | null>(null);
  const [near, setNear] = useState(false);
  const [locating, setLocating] = useState(false);

  const load = useCallback((lat?: number, lng?: number) => {
    api<SearchResponse>("/api/search", {
      params: {
        sort: "rating",
        min_reviews: MIN_REVIEWS,
        limit: 8,
        lat,
        lng,
        radius_miles: lat != null ? 150 : undefined,
      },
    })
      .then((d) => {
        // A sparse area can have few qualifying shops; fall back to national.
        if (lat != null && d.items.length < 4) {
          setNear(false);
          load();
        } else {
          setNear(lat != null);
          setItems(d.items);
        }
      })
      .catch(() => setItems([]));
  }, []);

  useEffect(() => {
    load();
    // Localize silently ONLY if the user already granted geolocation elsewhere;
    // this block never triggers a permission prompt on its own.
    if (typeof navigator !== "undefined" && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" })
        .then((status) => {
          if (status.state === "granted") {
            navigator.geolocation.getCurrentPosition(
              (pos) => load(pos.coords.latitude, pos.coords.longitude),
              () => {},
              { timeout: 8000 },
            );
          }
        })
        .catch(() => {});
    }
  }, [load]);

  function useMyLocation() {
    setLocating(true);
    navigator.geolocation?.getCurrentPosition(
      (pos) => {
        setLocating(false);
        load(pos.coords.latitude, pos.coords.longitude);
      },
      () => setLocating(false),
      { timeout: 10000 },
    );
  }

  if (items !== null && items.length === 0) return null;

  return (
    <section className="mx-auto max-w-6xl px-4 py-14">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-bold">
            {near ? "Top rated shops near you" : "Top rated shops"}
          </h2>
          <p className="mt-1 text-sm text-steel">
            Real ratings from {MIN_REVIEWS}+ reviews — nothing promoted, nothing invented.
          </p>
        </div>
        {!near && (
          <button onClick={useMyLocation} disabled={locating} className="btn-quiet !py-2">
            {locating ? "Locating…" : "Use my location"}
          </button>
        )}
      </div>

      {items === null ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse card" />
          ))}
        </div>
      ) : (
        <div className="-mx-4 mt-6 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 lg:grid-cols-4">
          {items.map((b) => (
            <Link
              key={b.id}
              href={`/business/${b.id}`}
              className="group zoom-media w-[240px] shrink-0 snap-start overflow-hidden card transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-pine/50 hover:shadow-(--shadow-lift) sm:w-auto"
            >
              <ShopImage
                businessId={b.id}
                name={b.name}
                category={b.category}
                photoPath={b.photo_path}
                hasGooglePhoto={b.has_google_photo}
                width={480}
                className="h-32 w-full"
              />
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="display font-semibold leading-snug group-hover:text-pine">
                    {b.name}
                  </h3>
                  {b.partner_status === "active" && (
                    <span className="shrink-0 rounded bg-amber-wash px-1.5 py-0.5 text-xs font-semibold text-amber-ink">
                      Partner
                    </span>
                  )}
                </div>
                <div className="mt-1.5">
                  {b.rating_count > 0 ? (
                    <Stars avg={b.rating_avg} count={b.rating_count} />
                  ) : (
                    <GoogleRating rating={b.google_rating} count={b.google_rating_count} />
                  )}
                </div>
                <p className="mt-1 text-sm text-steel">
                  {b.city ? `${b.city}, ${b.state}` : b.state}
                  {b.distance_miles != null && ` · ${b.distance_miles} mi`}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
