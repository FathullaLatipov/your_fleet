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
            defects_fn=sclient.open_defects,
            create_missing=args.create_missing,
        )
    print(json.dumps(report.as_dict(), indent=2))
    return 0


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
    p_s.set_defaults(func=cmd_sync_samsara)

    p_m = sub.add_parser("monday-export",
                         help="Export fleet expenses to a monday.com board (needs MONDAY_API_TOKEN)")
    p_m.add_argument("--owner-email", required=True)
    p_m.add_argument("--board-id", required=True)
    p_m.add_argument("--column-map", default=None,
                     help='JSON like {"date":"date4","amount":"numbers1","unit":"text1"}')
    p_m.set_defaults(func=cmd_monday_export)

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
