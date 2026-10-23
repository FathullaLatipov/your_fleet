"""Idempotent import pipeline: KML/KMZ placemarks -> canonical Business records.

Rules:
- A source record's fingerprint (name + coords + description) is its identity.
  Re-importing the same content is a no-op (action=skipped).
- Exact in-file duplicates (same fingerprint seen twice) are recorded as
  action=duplicate and create no second business.
- Probable duplicates (same normalized phone, or same normalized name within
  500 m) are still created but flagged as DuplicateCandidate rows for human
  review. Uncertain matches are never auto-merged.
- Invalid coordinates are recorded as action=invalid and create no business.
- Dry-run executes the full pipeline in a transaction and rolls back.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.importer.kml import RawPlacemark, parse_kml, read_kml_bytes
from app.importer.normalize import haversine_m, normalize_name, normalize_phone, valid_coords
from app.models import (
    Business,
    BusinessCategory,
    DuplicateCandidate,
    ImportBatch,
    SourceAction,
    SourceRecord,
    utcnow,
)

BATCH_SIZE = 500
NEAR_DUPLICATE_METERS = 500.0

FOLDER_CATEGORY = {
    "TRUCK & TRAILER shops": BusinessCategory.TRUCK_TRAILER,
    "PICK UP & AUTO shops": BusinessCategory.PICKUP_AUTO,
}


@dataclass
class ImportReport:
    source_file: str = ""
    file_sha256: str = ""
    dry_run: bool = False
    total_placemarks: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    duplicates: int = 0
    invalid: int = 0
    duplicate_candidates: int = 0
    invalid_details: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "source_file": self.source_file,
            "file_sha256": self.file_sha256,
            "dry_run": self.dry_run,
            "total_placemarks": self.total_placemarks,
            "created": self.created,
            "updated": self.updated,
            "skipped": self.skipped,
            "duplicates": self.duplicates,
            "invalid": self.invalid,
            "duplicate_candidates": self.duplicate_candidates,
            "invalid_details": self.invalid_details[:50],
        }


def _category_for(folder: str) -> BusinessCategory:
    for key, cat in FOLDER_CATEGORY.items():
        if key in folder:
            return cat
    return BusinessCategory.OTHER


class _DupIndex:
    """In-memory index of existing businesses for probable-duplicate detection."""

    def __init__(self, db: Session):
        self.by_phone: dict[str, list[Business]] = {}
        self.by_name: dict[str, list[Business]] = {}
        for b in db.execute(select(Business)).scalars():
            self.add(b)

    def add(self, b: Business) -> None:
        if b.phone_normalized:
            self.by_phone.setdefault(b.phone_normalized, []).append(b)
        if b.normalized_name:
            self.by_name.setdefault(b.normalized_name, []).append(b)

    def probable_matches(
        self, phone: str | None, norm_name: str, lat: float, lng: float
    ) -> list[tuple[Business, str]]:
        matches: dict = {}
        if phone:
            for b in self.by_phone.get(phone, []):
                matches[b.id] = (b, "same phone number")
        for b in self.by_name.get(norm_name, []):
            if b.id not in matches and haversine_m(lat, lng, b.lat, b.lng) <= NEAR_DUPLICATE_METERS:
                matches[b.id] = (b, f"same name within {int(NEAR_DUPLICATE_METERS)}m")
        return list(matches.values())


def run_import(db: Session, path: str, dry_run: bool = False) -> ImportReport:
    data = read_kml_bytes(path)
    placemarks = parse_kml(data)

    report = ImportReport(
        source_file=path,
        file_sha256=hashlib.sha256(data).hexdigest(),
        dry_run=dry_run,
        total_placemarks=len(placemarks),
    )

    batch = ImportBatch(
        source_file=path, file_sha256=report.file_sha256, dry_run=dry_run
    )
    db.add(batch)
    db.flush()

    existing_fps = set(db.execute(select(SourceRecord.fingerprint)).scalars())
    dup_index = _DupIndex(db)
    seen_this_run: set[str] = set()
    pending = 0
    seq = 0  # distinguishes audit rows for repeated identical placemarks

    def flush_batch(force: bool = False) -> None:
        nonlocal pending
        pending += 1
        if pending >= BATCH_SIZE or force:
            db.flush()
            if not dry_run:
                db.commit()
                db.add(batch)  # keep batch bound to the session across commits
            pending = 0

    for pm in placemarks:
        fp = pm.fingerprint()
        seq += 1

        if fp in seen_this_run:
            report.duplicates += 1
            db.add(SourceRecord(
                import_batch_id=batch.id, fingerprint=_run_scoped_fp(batch, fp, seq),
                raw=pm.as_raw_dict(), action=SourceAction.DUPLICATE,
                note="exact duplicate within this file",
            ))
            flush_batch()
            continue

        if fp in existing_fps:
            report.skipped += 1
            seen_this_run.add(fp)
            db.add(SourceRecord(
                import_batch_id=batch.id, fingerprint=_run_scoped_fp(batch, fp, seq),
                raw=pm.as_raw_dict(), action=SourceAction.SKIPPED,
                note="already imported (fingerprint match)",
            ))
            flush_batch()
            continue

        if not pm.name or not valid_coords(pm.lat, pm.lon):
            reason = pm.coord_error or ("missing name" if not pm.name else "invalid coordinates")
            report.invalid += 1
            report.invalid_details.append(f"{pm.name or '(no name)'}: {reason}")
            db.add(SourceRecord(
                import_batch_id=batch.id, fingerprint=fp, raw=pm.as_raw_dict(),
                action=SourceAction.INVALID, note=reason[:255],
            ))
            seen_this_run.add(fp)
            flush_batch()
            continue

        norm_name = normalize_name(pm.name)
        norm_phone = normalize_phone(pm.phone)
        business = Business(
            name=pm.name,
            normalized_name=norm_name,
            category=_category_for(pm.folder_path),
            address_raw=pm.address,
            city=pm.city,
            state=pm.state,
            zip_code=pm.zip_code,
            phone=pm.phone,
            phone_normalized=norm_phone,
            website=pm.website,
            lat=pm.lat,
            lng=pm.lon,
        )
        db.add(business)
        db.flush()  # assign id

        for other, reason in dup_index.probable_matches(norm_phone, norm_name, pm.lat, pm.lon):
            db.add(DuplicateCandidate(
                business_a_id=other.id, business_b_id=business.id, reason=reason
            ))
            report.duplicate_candidates += 1

        dup_index.add(business)
        db.add(SourceRecord(
            import_batch_id=batch.id, fingerprint=fp, raw=pm.as_raw_dict(),
            action=SourceAction.CREATED, business_id=business.id,
        ))
        seen_this_run.add(fp)
        report.created += 1
        flush_batch()

    batch.finished_at = utcnow()
    batch.report = report.as_dict()
    flush_batch(force=True)

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def _run_scoped_fp(batch: ImportBatch, fp: str, seq: int) -> str:
    """Fingerprint column is unique; skipped/duplicate audit rows get a
    batch+sequence-scoped variant so the canonical fingerprint maps to exactly
    one created record."""
    return hashlib.sha256(f"{batch.id}|{seq}|{fp}".encode()).hexdigest()
