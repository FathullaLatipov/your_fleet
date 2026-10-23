from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import admin, auth, bookings, businesses, claims, me, offers, reviews
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

for router in (auth.router, businesses.router, claims.router, offers.router,
               bookings.router, reviews.router, me.router, admin.router):
    app.include_router(router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
