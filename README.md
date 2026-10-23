# YourFleet — Truck Repair Marketplace

A marketplace connecting US truck drivers and fleets with truck repair shops: a
searchable geographic directory imported from the **SHOPS MAP v2** dataset, plus
negotiated partner offers, quote/booking workflows, verified reviews, and
configurable commissions.

## Stack

| Layer     | Technology |
|-----------|------------|
| Frontend  | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4, Leaflet + OpenStreetMap |
| Backend   | FastAPI, Pydantic v2, SQLAlchemy 2, Alembic |
| Database  | PostgreSQL 16 with `cube` + `earthdistance` (GiST-indexed radius search; PostGIS-ready swap path in `backend/app/services/geo.py`) |
| Auth      | JWT bearer tokens (PyJWT), bcrypt password hashing, server-side RBAC |

## Source data audit (SHOPS MAP v2)

Both files are Google My Maps exports of the **same dataset** (the KMZ's
`doc.kml` matches the standalone KML record-for-record):

| Metric | Value |
|---|---|
| Placemarks per file | 2,833 |
| Folders | TRUCK & TRAILER shops (2,582), PICK UP & AUTO shops (251) |
| Exact in-file duplicates | 1 (identical name+coords+description) |
| Canonical businesses imported | **2,832** |
| Valid US coordinates | 100% |
| Phone parsed (E.164) | 2,533 (89%) |
| City/State/ZIP parsed | 2,757 (97%) |
| Website parsed | 1,672 (59%) |
| Probable-duplicate pairs flagged for admin review | 224 |

Notes: `ExtendedData` fields (`Shop Name`, `Info`, `Longtitude`, `Latitude`)
exist but are empty in every record — all usable data lives in the name,
coordinates, and the HTML description (address / website / phone). Some
addresses contained mojibake (`���`, an encoding artifact of a non-ASCII
country suffix) which the importer strips; originals are preserved in
`source_records.raw`. The dataset also contains a few stray placemarks (e.g.
"Dallas City Hall") that admins can unpublish.

## Run locally

Prereqs: Python 3.11+, Node 22+, PostgreSQL 16 with the `cube` and
`earthdistance` extensions available (bundled with standard Postgres contrib).

```bash
# 1. Database
createdb yourfleet_dev    # or: CREATE DATABASE yourfleet_dev;

# 2. Backend
cd backend
python -m venv .venv && .venv/Scripts/activate   # Windows; use bin/activate elsewhere
pip install -r requirements.txt
copy .env.example .env    # then edit DATABASE_URL and set a strong JWT_SECRET
alembic upgrade head      # creates schema + geo index (+ extensions if permitted)
python -m app.cli seed-services
python -m app.cli import-kml "../SHOPS MAP v2.kml" --dry-run   # preview
python -m app.cli import-kml "../SHOPS MAP v2.kml"             # import (idempotent)
python -m app.cli create-admin you@example.com                 # prompts for password
uvicorn app.main:app --port 8000

# 3. Frontend (second terminal)
cd frontend
npm install
echo NEXT_PUBLIC_API_URL=http://localhost:8000 > .env.local
npm run dev               # or: npm run build && npm start
```

Open http://localhost:3000. API docs at http://localhost:8000/docs.

### Tests

```bash
createdb yourfleet_test
cd backend
set DATABASE_URL=postgresql+psycopg://...:...@localhost:5432/yourfleet_test
.venv/Scripts/python -m pytest tests -q       # 43 tests
```

Covers: KML/KMZ parsing, normalization, idempotent imports, duplicate
flagging, invalid coordinates, dry-run isolation, auth, RBAC, geo search
ordering/radius, offer validation & visibility rules, every booking state
transition, optimistic-concurrency conflicts, commission math, review
eligibility, and the claim flow.

## Google Places enrichment (optional)

`python -m app.cli enrich-google [--limit N] [--stale-days 30] [--qps 5] [--dry-run]`
fills `google_rating`, `google_rating_count`, `google_place_url` and
`google_place_id` from the Places API (New) Text Search, once
`GOOGLE_PLACES_API_KEY` is set in `backend/.env`. Behavior:

- Conservative matching: a Place is accepted only within 400 m of our stored
  coordinates **and** with sufficient name similarity; no confident match
  leaves fields empty.
- Resumable and idempotent: every checked row is stamped `google_synced_at`;
  re-runs only process unchecked or stale rows. Run with `--stale-days 30`
  on a schedule to respect Google's data-caching policy (place IDs may be
  kept indefinitely; ratings must be refreshed).
- Rate limited (`--qps`) with exponential backoff on 429/5xx; aborts after
  25 consecutive API errors.
- Place Photos are deliberately not downloaded: Google's policy forbids
  caching photo content.
- UI shows Google ratings with explicit "on Google" attribution, on shop
  pages and search cards (YourFleet's own verified reviews take precedence).

## Environment variables

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | backend `.env` | PostgreSQL connection string |
| `JWT_SECRET` | backend `.env` | Token signing key — long random string, never commit |
| `JWT_EXPIRES_MINUTES` | backend `.env` | Access-token lifetime (default 1440) |
| `CORS_ORIGINS` | backend `.env` | Comma-separated allowed origins |
| `ENVIRONMENT` | backend `.env` | `development` / `production` |
| `NEXT_PUBLIC_API_URL` | frontend `.env.local` | Backend base URL |
| `GOOGLE_PLACES_API_KEY` | backend `.env` | Optional; enables `enrich-google` |

## Domain model & trust levels

A listing's trust level is never a single mutable "status" — each level is a
separate fact:

1. **Imported listing** — has `source_records` provenance; shown as "Directory listing".
2. **Claimed** — an approved `BusinessClaim` set `owner_user_id`.
3. **Identity-verified** — an admin set `identity_verified_at` after checking evidence.
4. **Active partner** — `partner_status = active` (admin-managed commercial agreement).
5. **Partner with active offer** — partner **and** an admin-approved, unexpired offer.

Honesty rules enforced in code:
- Savings figures appear only when the provider documented a regular price
  (`savings_cents` is computed, never stored or invented).
- Unknown hours are shown as "Hours not verified", never "open now";
  the open-now filter matches only businesses with known hours.
- Only drivers with a completed booking can review, once per booking.
- Commission terms are snapshotted onto the booking at confirmation;
  later settings changes never rewrite history.

## Booking lifecycle

```
requested ─→ quoted ─→ confirmed ─→ in_progress ─→ completed ─→ disputed (admin resolves)
    │      ↘ accepted ─→ ↑                 ↘ disputed
    └────────── cancelled (allowed from any pre-completion state, by role)
```

All transitions validated server-side per role; concurrent updates rejected
via a version token (HTTP 409).

## Known limitations / remaining work

- **Payments are not processed by the platform.** Customers pay shops
  directly; commissions are recorded for invoicing outside the system. A
  payment provider (e.g. Stripe Connect) needs business/legal/compliance
  review before integration.
- **Email/SMS/push notifications** — only in-app notifications exist; the
  dispatch point is `backend/app/services/notifications.py`.
- **Geocoding** — "City, ST"/ZIP search resolves against the imported
  dataset's own coordinates; arbitrary street addresses need a geocoding API.
- **Fleet accounts** — the `fleet_manager` role can book like a driver;
  multi-vehicle/multi-driver company management is not built.
- **Open-now filter** uses server-local time, not per-business timezones.
- **Rate limiting** is in-process; use a Redis-backed limiter for multi-worker
  deployments.
- **JWT in localStorage** — consider httpOnly cookie sessions before
  production hardening; tokens expire in 24h and there is no refresh/revoke.
- **Dataset size** — the source files contain 2,833 placemarks, not the 6,500+
  mentioned in early planning. The importer handles larger files (batched,
  idempotent) whenever more data arrives.
- **OSM tile usage** — the public tile server is fine for development;
  production needs a commercial tile provider or self-hosted tiles per OSM
  usage policy.
- Before a public US launch, obtain professional review of privacy,
  consumer-protection, marketplace, and tax obligations.

## Repository layout

```
backend/
  app/api/        routers (auth, businesses, claims, offers, bookings, reviews, me, admin)
  app/services/   geo search, booking state machine, notifications
  app/importer/   KML/KMZ parsing, normalization, idempotent pipeline
  app/cli.py      import-kml | seed-services | create-admin
  alembic/        migrations
  tests/          pytest suite
frontend/
  src/app/        pages (home, search, business, bookings, dashboard, provider, admin)
  src/components/ Header, MapView, BookingForm, badges, HomeSearch
  src/lib/        API client, auth context, types
```
