from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles

from app.api import (
    admin, auth, bookings, businesses, claims, fleet, fleet_assets,
    fleet_finance, fleet_import, fleet_ops, fleet_reports, inventory, me, offers, reviews, work_orders,
)
from app.config import get_settings

app = FastAPI(
    title="YourFleet API",
    description="Truck repair marketplace: directory, verified partner offers, bookings.",
    version="0.1.0",
)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# The API sits behind a long proxy hop (Vercel edge -> VPS); the map payload
# alone is ~560 KB of JSON, so compress before it leaves the box.
app.add_middleware(GZipMiddleware, minimum_size=1024)

# Public, user-independent reads that the CDN and browser may cache briefly.
# Business detail is deliberately absent: every view bumps its views_count.
PUBLIC_CACHEABLE = {"/api/services", "/api/stats/public", "/api/search", "/api/search/map"}
PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=120, stale-while-revalidate=600"


@app.middleware("http")
async def public_cache_headers(request: Request, call_next):
    response = await call_next(request)
    if (request.method == "GET" and request.url.path in PUBLIC_CACHEABLE
            and response.status_code == 200 and "cache-control" not in response.headers):
        response.headers["Cache-Control"] = PUBLIC_CACHE_CONTROL
    return response

for router in (auth.router, businesses.router, claims.router, offers.router,
               bookings.router, reviews.router, me.router, fleet.router,
               fleet_assets.router, fleet_finance.router, fleet_ops.router,
               fleet_reports.router, fleet_import.router, work_orders.router, inventory.router,
               admin.router):
    app.include_router(router)

_media = Path(settings.media_dir)
_media.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=_media), name="media")


@app.get("/api/health")
def health():
    return {"status": "ok"}
