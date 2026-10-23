"""Geographic search built on PostgreSQL cube/earthdistance.

The earth_box predicate hits the GiST functional index ix_businesses_earth;
earth_distance refines to a true great-circle radius. Swappable for PostGIS
(ST_DWithin on a geography column) without changing the public API.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

METERS_PER_MILE = 1609.344
MAX_RADIUS_MILES = 300.0


@dataclass
class SearchFilters:
    lat: float | None = None
    lng: float | None = None
    radius_miles: float = 50.0
    q: str | None = None
    category: str | None = None
    state: str | None = None
    city: str | None = None
    zip_code: str | None = None
    partner_only: bool = False
    verified_only: bool = False
    has_offer: bool = False
    mobile_only: bool = False
    emergency_only: bool = False
    min_rating: float | None = None
    open_now: bool = False
    sort: str = "distance"
    limit: int = 25
    offset: int = 0


_BASE = """
SELECT b.id, b.name, b.category, b.city, b.state, b.phone, b.lat, b.lng,
       b.rating_avg, b.rating_count, b.partner_status,
       (b.owner_user_id IS NOT NULL) AS is_claimed,
       (b.identity_verified_at IS NOT NULL) AS is_verified,
       EXISTS (
         SELECT 1 FROM offers o
         WHERE o.business_id = b.id AND o.status = 'approved'
           AND (o.starts_at IS NULL OR o.starts_at <= :now)
           AND (o.expires_at IS NULL OR o.expires_at > :now)
       ) AND b.partner_status = 'active' AS has_active_offer,
       b.is_mobile_service, b.accepts_emergency,
       (SELECT min(bs.standard_price_cents) FROM business_services bs
        WHERE bs.business_id = b.id AND bs.standard_price_cents IS NOT NULL
       ) AS price_from_cents
       {distance_col}
FROM businesses b
WHERE b.is_published = true
{conditions}
{order}
LIMIT :limit OFFSET :offset
"""


def search_businesses(db: Session, f: SearchFilters) -> tuple[list[dict], int]:
    params: dict = {
        "now": datetime.now(timezone.utc),
        "limit": min(max(f.limit, 1), 100),
        "offset": max(f.offset, 0),
    }
    conditions: list[str] = []
    distance_col = ", NULL::float AS distance_m"
    order = "ORDER BY b.rating_avg DESC NULLS LAST, b.rating_count DESC, b.name"

    has_point = f.lat is not None and f.lng is not None
    if has_point:
        radius_m = min(max(f.radius_miles, 1.0), MAX_RADIUS_MILES) * METERS_PER_MILE
        params.update(lat=f.lat, lng=f.lng, radius_m=radius_m)
        distance_col = (
            ", earth_distance(ll_to_earth(:lat, :lng), ll_to_earth(b.lat, b.lng)) AS distance_m"
        )
        conditions.append(
            "earth_box(ll_to_earth(:lat, :lng), :radius_m) @> ll_to_earth(b.lat, b.lng)"
        )
        conditions.append(
            "earth_distance(ll_to_earth(:lat, :lng), ll_to_earth(b.lat, b.lng)) <= :radius_m"
        )
        if f.sort == "distance":
            order = "ORDER BY distance_m ASC"

    if f.q:
        params["q"] = f"%{f.q.strip()}%"
        conditions.append("(b.name ILIKE :q OR b.city ILIKE :q)")
    if f.category:
        params["category"] = f.category
        conditions.append("b.category = :category")
    if f.state:
        params["state"] = f.state.upper()
        conditions.append("b.state = :state")
    if f.city:
        params["city"] = f.city.strip()
        conditions.append("b.city ILIKE :city")
    if f.zip_code:
        params["zip"] = f.zip_code.strip()
        conditions.append("b.zip_code = :zip")
    if f.sort == "price":
        order = "ORDER BY price_from_cents ASC NULLS LAST, b.name"
    if f.partner_only:
        conditions.append("b.partner_status = 'active'")
    if f.mobile_only:
        conditions.append("b.is_mobile_service IS TRUE")
    if f.emergency_only:
        conditions.append("b.accepts_emergency IS TRUE")
    if f.verified_only:
        conditions.append("b.identity_verified_at IS NOT NULL")
    if f.min_rating is not None:
        params["min_rating"] = f.min_rating
        conditions.append("b.rating_avg >= :min_rating")
    if f.has_offer:
        conditions.append(
            "b.partner_status = 'active' AND EXISTS ("
            " SELECT 1 FROM offers o WHERE o.business_id = b.id AND o.status = 'approved'"
            " AND (o.starts_at IS NULL OR o.starts_at <= :now)"
            " AND (o.expires_at IS NULL OR o.expires_at > :now))"
        )
    if f.open_now:
        # Only businesses with KNOWN hours can match; unknown hours are never
        # presented as open. Hours format: {"mon": [["07:00","19:00"]], ...}
        now = datetime.now()  # server-local approximation; see docs for limitations
        day = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][now.weekday()]
        params["hhmm"] = now.strftime("%H:%M")
        conditions.append(
            "b.hours IS NOT NULL AND EXISTS ("
            f" SELECT 1 FROM jsonb_array_elements(b.hours->'{day}') AS r"
            " WHERE r->>0 <= :hhmm AND r->>1 > :hhmm)"
        )

    cond_sql = "".join(f"  AND {c}\n" for c in conditions)
    sql = _BASE.format(distance_col=distance_col, conditions=cond_sql, order=order)
    rows = [dict(r._mapping) for r in db.execute(text(sql), params)]

    count_sql = f"SELECT count(*) FROM businesses b WHERE b.is_published = true\n{cond_sql}"
    total = db.execute(text(count_sql), params).scalar_one()

    for r in rows:
        r["distance_miles"] = (
            round(r.pop("distance_m") / METERS_PER_MILE, 1) if r.get("distance_m") is not None
            else r.pop("distance_m", None)
        )
    return rows, total


def locate_area(db: Session, query: str) -> tuple[float, float] | None:
    """Resolve 'ZIP' or 'City, ST' to a centroid of known businesses.

    Self-contained alternative to a geocoding API: honest for the dataset we
    have, documented as a limitation for addresses we don't cover.
    """
    q = query.strip()
    if not q:
        return None
    if q.replace("-", "").isdigit() and len(q) >= 5:
        row = db.execute(
            text("SELECT avg(lat), avg(lng) FROM businesses WHERE zip_code = :z"),
            {"z": q[:5]},
        ).first()
    else:
        city, _, state = q.partition(",")
        params = {"city": city.strip()}
        cond = "city ILIKE :city"
        if state.strip():
            cond += " AND state = :state"
            params["state"] = state.strip().upper()[:2]
        row = db.execute(
            text(f"SELECT avg(lat), avg(lng) FROM businesses WHERE {cond}"), params
        ).first()
    if row and row[0] is not None:
        return float(row[0]), float(row[1])
    return None
