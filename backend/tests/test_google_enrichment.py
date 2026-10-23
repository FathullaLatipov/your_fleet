"""Google Places enrichment: matching safety and persistence."""
from app.services.google_places import (
    Candidate,
    enrich_businesses,
    name_similarity,
    pick_candidate,
)
from tests.test_api import make_business  # noqa: F401


def cand(name, lat, lng, rating=4.6, count=120, pid="pid-1"):
    return Candidate(place_id=pid, name=name, lat=lat, lng=lng,
                     rating=rating, rating_count=count,
                     maps_uri=f"https://maps.google.com/?cid={pid}")


class TestMatching:
    def test_similar_name_nearby_matches(self):
        c = pick_candidate("Hardy Truck & Trailer Repair", 40.1237, -74.8452,
                           [cand("Hardy Truck and Trailer Repair LLC", 40.1239, -74.8450)])
        assert c is not None

    def test_far_candidate_rejected(self):
        # Same name, ~5 km away -> different branch or wrong place; reject.
        c = pick_candidate("Hardy Truck Repair", 40.1237, -74.8452,
                           [cand("Hardy Truck Repair", 40.17, -74.8452)])
        assert c is None

    def test_different_name_rejected(self):
        c = pick_candidate("Hardy Truck Repair", 40.1237, -74.8452,
                           [cand("Joe's Diner", 40.1237, -74.8452)])
        assert c is None

    def test_best_of_multiple(self):
        best = pick_candidate("Long Road Repair", 47.238, -122.409, [
            cand("Long Road Towing", 47.238, -122.409, pid="worse"),
            cand("Long Road Repair", 47.2381, -122.4091, pid="better"),
        ])
        assert best is not None and best.place_id == "better"

    def test_similarity_bounds(self):
        assert name_similarity("A & B Truck Repair", "A and B Truck Repair LLC") > 0.8
        assert name_similarity("Hardy Truck Repair", "") == 0.0


class TestEnrichJob:
    def test_match_persists_fields_and_timestamp(self, db):
        b = make_business(db, "Enrich Shop", lat=32.78, lng=-96.80)
        report = enrich_businesses(
            db, lambda q, lat, lng: [cand("Enrich Shop", 32.7801, -96.8001)])
        db.refresh(b)
        assert report.matched == 1
        assert b.google_rating == 4.6 and b.google_rating_count == 120
        assert b.google_place_id == "pid-1" and b.google_synced_at is not None

    def test_no_match_stamps_but_leaves_fields_empty(self, db):
        b = make_business(db, "Lonely Shop")
        report = enrich_businesses(db, lambda q, lat, lng: [])
        db.refresh(b)
        assert report.no_match == 1
        assert b.google_rating is None and b.google_synced_at is not None

    def test_fresh_rows_skipped(self, db):
        make_business(db, "Fresh Shop")
        enrich_businesses(db, lambda q, lat, lng: [])
        report2 = enrich_businesses(db, lambda q, lat, lng: [])
        assert report2.processed == 0  # already stamped within stale window

    def test_dry_run_persists_nothing(self, db):
        b = make_business(db, "Dry Shop")
        report = enrich_businesses(
            db, lambda q, lat, lng: [cand("Dry Shop", b.lat, b.lng)], dry_run=True)
        assert report.matched == 1
        db.expire_all()
        assert db.get(type(b), b.id).google_rating is None

    def test_api_errors_counted_not_fatal(self, db):
        make_business(db, "Err Shop A", lat=30.0, lng=-95.0)
        make_business(db, "Err Shop B", lat=31.0, lng=-96.0)

        def flaky(q, lat, lng):
            if "A" in q:
                raise RuntimeError("boom")
            return []

        report = enrich_businesses(db, flaky)
        assert report.errors == 1 and report.no_match == 1
