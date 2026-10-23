# Deployment guide

## Architecture

Two deployable units plus PostgreSQL:

- **backend** — FastAPI app served by uvicorn (or uvicorn workers behind a
  process manager / reverse proxy).
- **frontend** — Next.js production server (`npm run build && npm start`) or a
  Node-compatible host.
- **PostgreSQL 16+** with `cube` and `earthdistance` extensions. If the app's
  database role cannot create extensions, run as a superuser once:
  `CREATE EXTENSION cube; CREATE EXTENSION earthdistance;` before
  `alembic upgrade head`.

## Checklist

1. **Secrets**: set a unique 32+ byte `JWT_SECRET`; use a dedicated database
   role with least privilege; never reuse dev credentials. Nothing secret is
   committed to this repository.
2. **Migrations**: `alembic upgrade head` on every deploy, before starting the
   new app version. Migrations are additive so far; take a backup before
   upgrading anyway.
3. **Data import**: run imports from a trusted shell only
   (`python -m app.cli import-kml <file> --dry-run` first). Imports are
   idempotent; re-running the same file is safe. Review the import report and
   the admin "Duplicate candidates" queue afterwards.
4. **CORS**: set `CORS_ORIGINS` to the exact frontend origin(s).
5. **TLS**: terminate HTTPS at the proxy; set HSTS. The API must not be served
   over plain HTTP in production.
6. **Rate limiting**: the built-in limiter is per-process. For >1 worker, put
   a limiter at the proxy (e.g. nginx `limit_req`) or swap in a Redis-backed
   implementation at `backend/app/rate_limit.py`.
7. **Map tiles**: replace the public OpenStreetMap tile URL in
   `frontend/src/components/MapView.tsx` with a commercial provider
   (MapTiler, Stadia, etc.) or self-hosted tiles. Keep attribution.
8. **Monitoring**: watch `audit_logs`, failed logins (401 spikes), and the
   disputed-bookings queue.
9. **Backups**: schedule PostgreSQL base backups + WAL archiving;
   `source_records` preserves import provenance, so the raw KML files are not
   needed at runtime.
10. **Admin accounts**: create with
    `python -m app.cli create-admin <email>` (interactive password prompt);
    self-registration as admin is blocked by the API.

## Operational commands

| Task | Command (from `backend/`) |
|---|---|
| Preview an import | `python -m app.cli import-kml <file.kml\|.kmz> --dry-run` |
| Import | `python -m app.cli import-kml <file>` |
| Seed service catalog | `python -m app.cli seed-services` |
| Create admin | `python -m app.cli create-admin <email>` |
| Migrate | `alembic upgrade head` |
| Roll back one migration | `alembic downgrade -1` |
| Tests | `python -m pytest tests -q` (needs `yourfleet_test` DB) |

## Not included (requires explicit setup + review)

- Payment processing (card data must never touch this system as built).
- Email/SMS providers.
- Legal/compliance review for US marketplace operation.
