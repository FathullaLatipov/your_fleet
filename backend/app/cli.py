"""Administrative CLI.

Usage (from backend/ with the venv active):
    python -m app.cli import-kml "..\\SHOPS MAP v2.kml" [--dry-run]
    python -m app.cli seed-services
    python -m app.cli create-admin admin@example.com
"""
from __future__ import annotations

import argparse
import getpass
import json
import sys

from app.db import SessionLocal


def cmd_import(args: argparse.Namespace) -> int:
    from app.importer.pipeline import run_import

    with SessionLocal() as db:
        report = run_import(db, args.path, dry_run=args.dry_run)
    print(json.dumps(report.as_dict(), indent=2))
    return 0


def cmd_seed_services(_: argparse.Namespace) -> int:
    from app.models import Service
    from sqlalchemy import select

    catalog = [
        ("diesel-engine", "Diesel Engine Repair"),
        ("trailer-repair", "Trailer Repair"),
        ("tires", "Tires & Alignment"),
        ("towing", "Towing & Recovery"),
        ("electrical", "Electrical & Diagnostics"),
        ("reefer", "Reefer Repair"),
        ("brakes", "Brakes & Suspension"),
        ("pm-service", "Preventive Maintenance"),
        ("welding", "Welding & Fabrication"),
        ("mobile-roadside", "Mobile / Roadside Service"),
        ("transmission", "Transmission & Drivetrain"),
        ("aftertreatment", "DPF / Aftertreatment"),
    ]
    with SessionLocal() as db:
        existing = set(db.execute(select(Service.slug)).scalars())
        added = 0
        for slug, name in catalog:
            if slug not in existing:
                db.add(Service(slug=slug, name=name))
                added += 1
        db.commit()
    print(f"service catalog: {added} added, {len(catalog) - added} already present")
    return 0


def cmd_enrich_google(args: argparse.Namespace) -> int:
    from app.services.google_places import enrich_businesses, make_default_search_fn

    try:
        search_fn = make_default_search_fn(qps=args.qps)
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
    with SessionLocal() as db:
        report = enrich_businesses(
            db, search_fn,
            limit=args.limit, stale_days=args.stale_days, dry_run=args.dry_run,
        )
    print(json.dumps(report.as_dict(), indent=2))
    return 0


def _find_user(db, email: str):
    from sqlalchemy import select

    from app.models import User

    user = db.execute(select(User).where(User.email == email.lower())).scalar_one_or_none()
    if user is None:
        print(f"No user with email {email}", file=sys.stderr)
    return user


def cmd_sync_samsara(args: argparse.Namespace) -> int:
    from app.services.samsara import make_client, sync_samsara

    try:
        sclient = make_client()
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
    with SessionLocal() as db:
        owner = _find_user(db, args.owner_email)
        if owner is None:
            return 1
        report = sync_samsara(
            db, owner,
            vehicles_fn=sclient.vehicles, stats_fn=sclient.stats,
            defects_fn=sclient.open_defects, faults_fn=sclient.faults,
            create_missing=args.create_missing,
            dry_run=args.dry_run,
        )
    print(json.dumps(report.as_dict(), indent=2))
    return 0


def cmd_samsara_loop(args: argparse.Namespace) -> int:
    """Keep odometer/GPS/fuel fresh for EVERY connected company every --interval
    seconds. Each carrier that connected its own token in Profile -> Integrations
    is synced with that token; the legacy SAMSARA_SYNC_OWNER + SAMSARA_API_TOKEN
    env pair is kept as a fallback for a company that hasn't connected in-app.

    Idles (instead of crash-looping) while nothing is connected, so the service
    can ship before any tenant is switched on.
    """
    import os
    import time
    from datetime import datetime, timezone

    from sqlalchemy import select

    from app.models import Integration, User
    from app.services import crypto
    from app.services.samsara import SamsaraClient, sync_samsara

    env_owner_email = (args.owner_email or os.environ.get("SAMSARA_SYNC_OWNER", "")).strip()
    env_token = os.environ.get("SAMSARA_API_TOKEN", "").strip()

    while True:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        try:
            with SessionLocal() as db:
                # (owner, client, source) per tenant to sync.
                targets: list[tuple[User, SamsaraClient, str]] = []
                seen: set = set()
                rows = db.execute(
                    select(Integration).where(
                        Integration.provider == "samsara",
                        Integration.status == "connected",
                    )
                ).scalars().all()
                for r in rows:
                    token = crypto.decrypt(r.token_encrypted)
                    owner = db.get(User, r.owner_user_id)
                    if not token or owner is None:
                        continue
                    targets.append((owner, SamsaraClient(token), "integration"))
                    seen.add(owner.id)
                # Legacy env fallback (only if that owner hasn't connected in-app).
                if env_owner_email and env_token:
                    owner = _find_user(db, env_owner_email)
                    if owner is not None and owner.id not in seen:
                        targets.append((owner, SamsaraClient(env_token), "env"))

                if not targets:
                    print(f"[{stamp}] samsara-loop idle: no company has connected a token", flush=True)
                for owner, client, source in targets:
                    try:
                        report = sync_samsara(
                            db, owner,
                            vehicles_fn=client.vehicles, stats_fn=client.stats,
                            defects_fn=client.open_defects, faults_fn=client.faults,
                            create_missing=args.create_missing,
                        )
                        d = report.as_dict()
                        print(f"[{stamp}] samsara sync {owner.email} ({source}): "
                              f"matched={d['vehicles_matched']} created={d['vehicles_created']} "
                              f"odometers={d['odometers_updated']} fuel={d['fuel_updated']} "
                              f"engine_hours={d['engine_hours_updated']} faults_active={d['faults_active']} "
                              f"faults_cleared={d['faults_cleared']} defects={d['defects_created']}"
                              + (f" note={d['defects_note']}" if d["defects_note"] else ""), flush=True)
                    except Exception as e:  # noqa: BLE001 - one tenant's failure mustn't stop others
                        print(f"[{stamp}] samsara sync {owner.email} failed: "
                              f"{type(e).__name__}: {e}", flush=True)
        except Exception as e:  # noqa: BLE001 - keep the loop alive, log the cause
            print(f"[{stamp}] samsara-loop error: {type(e).__name__}: {e}", flush=True)
        time.sleep(args.interval)


def cmd_telegram_bot(args: argparse.Namespace) -> int:
    """Long-poll Telegram and run the driver PTI flow. Idles (no crash loop)
    while TELEGRAM_BOT_TOKEN is unset, so the service can ship before the bot
    exists. Conversation state is in-memory; completed inspections are saved."""
    import os
    import time
    from datetime import datetime, timezone

    from app.services.telegram import TelegramClient, handle_update, mini_app_url

    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    menu_set = False

    def _safe(e: Exception) -> str:
        # httpx errors include the request URL, which embeds the bot token.
        msg = str(e)
        return msg.replace(token, "***") if token else msg

    states: dict = {}
    offset: int | None = None
    client = None
    while True:
        stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        if not token:
            print(f"[{stamp}] telegram-bot idle: TELEGRAM_BOT_TOKEN is not set", flush=True)
            time.sleep(max(args.idle_interval, 5))
            continue
        try:
            client = client or TelegramClient(token)
            if not menu_set:
                client.set_menu_button("Inspect", mini_app_url())
                menu_set = True
            updates = client.get_updates(offset, timeout=50)
            for u in updates:
                offset = u["update_id"] + 1
                try:
                    with SessionLocal() as db:
                        handle_update(db, states, u, client)
                except Exception as e:  # noqa: BLE001 - one bad update mustn't stop the bot
                    print(f"[{stamp}] telegram update failed: {type(e).__name__}: {_safe(e)}", flush=True)
        except Exception as e:  # noqa: BLE001 - keep polling through transient errors
            print(f"[{stamp}] telegram-bot error: {type(e).__name__}: {_safe(e)}", flush=True)
            time.sleep(5)


def cmd_monday_export(args: argparse.Namespace) -> int:
    from app.services.monday_export import export_expenses, make_gql

    try:
        gql = make_gql()
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        return 1
    column_map = json.loads(args.column_map) if args.column_map else None
    with SessionLocal() as db:
        owner = _find_user(db, args.owner_email)
        if owner is None:
            return 1
        report = export_expenses(db, owner, args.board_id, gql, column_map)
    print(json.dumps(report.as_dict(), indent=2))
    return 0


def cmd_import_vehicles(args: argparse.Namespace) -> int:
    """Import a carrier's fleet from a TMS-style xlsx export (see README)."""
    from app.services.vehicle_import import import_vehicles_xlsx

    with SessionLocal() as db:
        owner = _find_user(db, args.owner_email)
        if owner is None:
            return 1
        report = import_vehicles_xlsx(db, owner, args.path, dry_run=args.dry_run)
    print(json.dumps(report, indent=2))
    return 0


def cmd_outreach(args: argparse.Namespace) -> int:
    """Sales call list: best-rated unclaimed shops with real phone numbers."""
    import csv

    from sqlalchemy import select

    from app.config import get_settings
    from app.models import Business

    base = get_settings().frontend_url.rstrip("/")
    with SessionLocal() as db:
        q = (
            select(Business)
            .where(
                Business.is_published,
                Business.owner_user_id.is_(None),
                Business.phone_normalized.isnot(None),
                Business.google_rating >= args.min_rating,
                Business.google_rating_count >= args.min_reviews,
            )
            .order_by(Business.google_rating.desc(),
                      Business.google_rating_count.desc())
            .limit(args.limit)
        )
        if args.state:
            q = q.where(Business.state == args.state.upper())
        rows = db.execute(q).scalars().all()

        print(f"{len(rows)} unclaimed shops, rating >= {args.min_rating} "
              f"({args.min_reviews}+ reviews){f', state {args.state.upper()}' if args.state else ''}:\n")
        for b in rows[:25]:
            print(f"  {b.google_rating:.1f}* ({b.google_rating_count:>5}) "
                  f"{(b.name or '')[:38]:<38} {b.city or '':<18} {b.state or '':<2} "
                  f"{b.phone or '':<16} views={b.views_count}")
        if len(rows) > 25:
            print(f"  ... and {len(rows) - 25} more")

        if args.csv:
            with open(args.csv, "w", newline="", encoding="utf-8-sig") as f:
                w = csv.writer(f)
                w.writerow(["name", "city", "state", "phone", "google_rating",
                            "google_reviews", "google_type", "listing_views",
                            "website", "listing_url"])
                for b in rows:
                    w.writerow([b.name, b.city, b.state, b.phone, b.google_rating,
                                b.google_rating_count, b.google_primary_type,
                                b.views_count, b.website, f"{base}/business/{b.id}"])
            print(f"\nCSV written: {args.csv}")
    return 0


def cmd_check_maintenance(_: argparse.Namespace) -> int:
    from sqlalchemy import select

    from app.models import Vehicle
    from app.services.maintenance import check_vehicle_maintenance

    sent = 0
    with SessionLocal() as db:
        for v in db.execute(select(Vehicle)).scalars():
            sent += check_vehicle_maintenance(db, v)
        db.commit()
    print(f"maintenance check: {sent} notifications sent")
    return 0


def cmd_create_admin(args: argparse.Namespace) -> int:
    from app.models import User, UserRole
    from app.security import hash_password
    from sqlalchemy import select

    password = args.password or getpass.getpass("Admin password: ")
    if len(password) < 8:
        print("Password must be at least 8 characters.", file=sys.stderr)
        return 1
    with SessionLocal() as db:
        if db.execute(select(User).where(User.email == args.email)).scalar_one_or_none():
            print(f"User {args.email} already exists.", file=sys.stderr)
            return 1
        db.add(User(
            email=args.email, password_hash=hash_password(password),
            full_name=args.name, role=UserRole.ADMIN,
        ))
        db.commit()
    print(f"Admin user created: {args.email}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="app.cli")
    sub = parser.add_subparsers(dest="command", required=True)

    p_imp = sub.add_parser("import-kml", help="Import businesses from a KML or KMZ file")
    p_imp.add_argument("path")
    p_imp.add_argument("--dry-run", action="store_true", help="Parse and report, persist nothing")
    p_imp.set_defaults(func=cmd_import)

    p_seed = sub.add_parser("seed-services", help="Seed the service-type catalog")
    p_seed.set_defaults(func=cmd_seed_services)

    p_g = sub.add_parser(
        "enrich-google",
        help="Fill google_rating/url from Places API (needs GOOGLE_PLACES_API_KEY)",
    )
    p_g.add_argument("--limit", type=int, default=None, help="Max businesses this run")
    p_g.add_argument("--stale-days", type=int, default=30,
                     help="Re-check rows older than this (Google caching policy)")
    p_g.add_argument("--qps", type=float, default=5.0, help="Max requests per second")
    p_g.add_argument("--dry-run", action="store_true", help="Fetch and report, persist nothing")
    p_g.set_defaults(func=cmd_enrich_google)

    p_s = sub.add_parser("sync-samsara",
                         help="Sync vehicles/odometer/DVIR defects (needs SAMSARA_API_TOKEN)")
    p_s.add_argument("--owner-email", required=True,
                     help="Fleet account the Samsara org belongs to")
    p_s.add_argument("--create-missing", action="store_true",
                     help="Create vehicles that exist in Samsara but not here")
    p_s.add_argument("--dry-run", action="store_true",
                     help="Report what would change; write and notify nothing")
    p_s.set_defaults(func=cmd_sync_samsara)

    p_sl = sub.add_parser("samsara-loop",
                          help="Sync SAMSARA_SYNC_OWNER every --interval seconds (service)")
    p_sl.add_argument("--owner-email", default=None,
                      help="Overrides SAMSARA_SYNC_OWNER")
    p_sl.add_argument("--interval", type=int, default=900)
    p_sl.add_argument("--create-missing", action="store_true",
                      help="Create vehicles that exist in Samsara but not here")
    p_sl.set_defaults(func=cmd_samsara_loop)

    p_tg = sub.add_parser("telegram-bot",
                          help="Run the driver PTI Telegram bot (long-polling; needs TELEGRAM_BOT_TOKEN)")
    p_tg.add_argument("--idle-interval", type=int, default=20,
                      help="Seconds to wait between checks while the token isn't set")
    p_tg.set_defaults(func=cmd_telegram_bot)

    p_m = sub.add_parser("monday-export",
                         help="Export fleet expenses to a monday.com board (needs MONDAY_API_TOKEN)")
    p_m.add_argument("--owner-email", required=True)
    p_m.add_argument("--board-id", required=True)
    p_m.add_argument("--column-map", default=None,
                     help='JSON like {"date":"date4","amount":"numbers1","unit":"text1"}')
    p_m.set_defaults(func=cmd_monday_export)

    p_vi = sub.add_parser("import-vehicles",
                          help="Import a carrier fleet from a TMS xlsx export")
    p_vi.add_argument("path")
    p_vi.add_argument("--owner-email", required=True)
    p_vi.add_argument("--dry-run", action="store_true")
    p_vi.set_defaults(func=cmd_import_vehicles)

    p_or = sub.add_parser("outreach-report",
                          help="Top unclaimed shops by Google rating - sales call list")
    p_or.add_argument("--state", default=None, help="Two-letter state filter")
    p_or.add_argument("--min-rating", type=float, default=4.5)
    p_or.add_argument("--min-reviews", type=int, default=25)
    p_or.add_argument("--limit", type=int, default=500)
    p_or.add_argument("--csv", default=None, help="Write full list to this CSV file")
    p_or.set_defaults(func=cmd_outreach)

    p_chk = sub.add_parser("check-maintenance",
                           help="Send due/overdue maintenance notifications for all vehicles")
    p_chk.set_defaults(func=cmd_check_maintenance)

    p_adm = sub.add_parser("create-admin", help="Create a platform administrator")
    p_adm.add_argument("email")
    p_adm.add_argument("--name", default="Platform Admin")
    p_adm.add_argument("--password", default=None, help="Omit to be prompted securely")
    p_adm.set_defaults(func=cmd_create_admin)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
