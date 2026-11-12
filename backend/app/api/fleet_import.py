"""Bulk import of trucks / trailers from Excel or CSV.

POST /api/fleet/import/{trucks|trailers}?dry_run=true  -> preview, writes nothing
POST /api/fleet/import/{trucks|trailers}?dry_run=false -> imports the valid rows
GET  /api/fleet/import/template/{trucks|trailers}       -> empty template (.xlsx)
"""
from fastapi import APIRouter, Depends, HTTPException, Path, Query, UploadFile, status
from fastapi.responses import Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.fleet import fleet_user
from app.db import get_db
from app.models import User
from app.services.fleet_import import (
    ImportFileError,
    apply_trailers,
    apply_trucks,
    plan_trailers,
    plan_trucks,
    template_xlsx,
)

router = APIRouter(prefix="/api/fleet/import", tags=["fleet"])

MAX_BYTES = 5 * 1024 * 1024
KIND = Path(pattern="^(trucks|trailers)$")


@router.get("/template/{kind}")
def download_template(kind: str = KIND, user: User = Depends(fleet_user)):
    name = "truck import file.xlsx" if kind == "trucks" else "trailers import file.xlsx"
    return Response(content=template_xlsx(kind),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}"'})


@router.post("/{kind}")
async def import_file(file: UploadFile, kind: str = KIND,
                      dry_run: bool = Query(default=True),
                      user: User = Depends(fleet_user), db: Session = Depends(get_db)):
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "File exceeds 5 MB")
    plan, apply = (plan_trucks, apply_trucks) if kind == "trucks" else (plan_trailers, apply_trailers)
    try:
        plans, ignored = plan(db, user, data, file.filename or "")
    except ImportFileError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(e))

    if not dry_run:
        try:
            apply(db, user, plans)
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "The fleet changed while importing — check the file again")

    return {
        "dry_run": dry_run,
        "kind": kind,
        "total_rows": len(plans),
        "created": sum(p.action == "create" for p in plans),
        "updated": sum(p.action == "update" for p in plans),
        "errors": sum(p.action == "error" for p in plans),
        "ignored_columns": ignored,
        "rows": [p.out() for p in plans],
    }
