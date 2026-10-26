"""Google Places (API New) enrichment.

Fills businesses.google_rating / google_rating_count / google_place_url /
google_place_id from licensed Places Text Search data. Conservative matching:
a candidate is accepted only when it is geographically close to our stored
coordinates AND its name is similar enough; otherwise fields stay empty.

Compliance notes:
- Place IDs may be cached indefinitely (Google Maps Platform ToS); rating data
  is stored with google_synced_at and must be refreshed periodically — run the
  job with --stale-days 30 on a schedule.
- Place Photos are intentionally NOT downloaded or stored: Google's policy
  forbids caching photo content.
"""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import timedelta
from typing import Callable, Protocol

import httpx
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.importer.normalize import haversine_m, normalize_name
from app.models import Business, BusinessCategory, utcnow

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = (
    "places.id,places.rating,places.userRatingCount,"
    "places.googleMapsUri,places.displayName,places.location,"
    "places.primaryType,places.primaryTypeDisplayName,places.photos"
)

# Google primaryType -> our coarse category, used to sharpen search filters.
# Only unambiguous types: Google tags many heavy-truck shops with the generic
# car_repair/auto_repair types, so those must NOT reclassify anything.
TYPE_TO_CATEGORY = {
    "tire_shop": "tire",
    "towing_service": "towing",
    "truck_repair_shop": "truck_trailer",
    "trailer_repair_shop": "truck_trailer",
}

MAX_MATCH_DISTANCE_M = 400.0
MIN_NAME_SIMILARITY = 0.45


@dataclass
class Candidate:
    place_id: str
    name: str
    lat: float
    lng: float
    rating: float | None
    rating_count: int | None
    maps_uri: str | None
    primary_type: str | None = None        # snake_case key, e.g. tire_shop
    primary_type_label: str | None = None  # display name, e.g. "Tire shop"
    photo_name: str | None = None          # Places photo resource name


SearchFn = Callable[[str, float, float], list[Candidate]]


class _Clock(Protocol):
    def __call__(self) -> float: ...


def name_similarity(a: str, b: str) -> float:
    """Token overlap (Jaccard) on normalized names; 0..1."""
    ta, tb = set(normalize_name(a).split()), set(normalize_name(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def pick_candidate(
    business_name: str, lat: float, lng: float, candidates: list[Candidate]
) -> Candidate | None:
    """Best candidate that is both nearby and plausibly the same business."""
    best: tuple[float, Candidate] | None = None
    for c in candidates:
        dist = haversine_m(lat, lng, c.lat, c.lng)
        if dist > MAX_MATCH_DISTANCE_M:
            continue
        sim = name_similarity(business_name, c.name)
        if sim < MIN_NAME_SIMILARITY:
            continue
        score = sim - dist / 10_000.0  # similarity first, distance tiebreak
        if best is None or score > best[0]:
            best = (score, c)
    return best[1] if best else None


def http_search_factory(api_key: str, qps: float = 5.0) -> SearchFn:
    """Real Places Text Search with QPS throttling and backoff on 429/5xx."""
    client = httpx.Client(timeout=20)
    min_interval = 1.0 / max(qps, 0.1)
    last_call = 0.0

    def search(text_query: str, lat: float, lng: float) -> list[Candidate]:
        nonlocal last_call
        for attempt in range(4):
            wait = min_interval - (time.monotonic() - last_call)
            if wait > 0:
                time.sleep(wait)
            last_call = time.monotonic()
            resp = client.post(
                SEARCH_URL,
                headers={
                    "X-Goog-Api-Key": api_key,
                    "X-Goog-FieldMask": FIELD_MASK,
                    "Content-Type": "application/json",
                },
                json={
                    "textQuery": text_query,
                    "pageSize": 5,
                    "languageCode": "en",
                    "locationBias": {
                        "circle": {
                            "center": {"latitude": lat, "longitude": lng},
                            "radius": 500.0,
                        }
                    },
                },
            )
            if resp.status_code in (429, 500, 502, 503):
                time.sleep(2**attempt)
                continue
            resp.raise_for_status()
            out = []
            for p in resp.json().get("places", []):
                loc = p.get("location") or {}
                if "latitude" not in loc:
                    continue
                out.append(Candidate(
                    place_id=p.get("id", ""),
                    name=(p.get("displayName") or {}).get("text", ""),
                    lat=loc["latitude"],
                    lng=loc["longitude"],
                    rating=p.get("rating"),
                    rating_count=p.get("userRatingCount"),
                    maps_uri=p.get("googleMapsUri"),
                    primary_type=p.get("primaryType"),
                    primary_type_label=(p.get("primaryTypeDisplayName") or {}).get("text"),
                    photo_name=((p.get("photos") or [{}])[0] or {}).get("name"),
                ))
            return out
        raise RuntimeError("Places API kept rate-limiting after retries")

    return search


@dataclass
class EnrichReport:
    processed: int = 0
    matched: int = 0
    no_match: int = 0
    errors: int = 0
    error_samples: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "processed": self.processed,
            "matched": self.matched,
            "no_match": self.no_match,
            "errors": self.errors,
            "error_samples": self.error_samples[:10],
        }


def enrich_businesses(
    db: Session,
    search_fn: SearchFn,
    *,
    limit: int | None = None,
    stale_days: int = 30,
    dry_run: bool = False,
) -> EnrichReport:
    """Enrich published businesses whose Google data is missing or stale.

    Resumable by design: each processed row gets google_synced_at set (match
    or not), so interrupted runs continue where they left off.
    """
    report = EnrichReport()
    cutoff = utcnow() - timedelta(days=stale_days)
    q = (
        select(Business)
        .where(Business.is_published)
        .where(or_(Business.google_synced_at.is_(None), Business.google_synced_at < cutoff))
        .order_by(Business.google_synced_at.asc().nulls_first(), Business.created_at)
    )
    if limit:
        q = q.limit(limit)
    businesses = db.execute(q).scalars().all()

    for i, b in enumerate(businesses, 1):
        report.processed += 1
        query_text = f"{b.name}, {b.address_raw}" if b.address_raw else b.name
        try:
            candidates = search_fn(query_text, b.lat, b.lng)
        except Exception as e:  # noqa: BLE001 - keep the batch going
            report.errors += 1
            report.error_samples.append(f"{b.name}: {e}")
            if report.errors >= 25:
                report.error_samples.append("aborting: too many consecutive API errors")
                break
            continue

        match = pick_candidate(b.name, b.lat, b.lng, candidates)
        if match:
            b.google_place_id = match.place_id
            b.google_rating = match.rating
            b.google_rating_count = match.rating_count
            b.google_place_url = match.maps_uri
            if match.primary_type_label:
                b.google_primary_type = match.primary_type_label[:64]
            b.google_photo_name = match.photo_name[:512] if match.photo_name else None
            mapped = TYPE_TO_CATEGORY.get(match.primary_type or "")
            if mapped and b.category.value != mapped:
                b.category = BusinessCategory(mapped)
            report.matched += 1
        else:
            report.no_match += 1
        b.google_synced_at = utcnow()

        if not dry_run and i % 100 == 0:
            db.commit()

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def make_default_search_fn(qps: float = 5.0) -> SearchFn:
    key = get_settings().google_places_api_key
    if not key:
        raise RuntimeError(
            "GOOGLE_PLACES_API_KEY is not set. Add it to backend/.env to enable "
            "Google enrichment; nothing is fetched or invented without it."
        )
    return http_search_factory(key, qps=qps)
