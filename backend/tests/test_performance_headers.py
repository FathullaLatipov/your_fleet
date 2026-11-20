"""Compression and cache headers: public reads cacheable, private never."""
from tests.test_api import client, make_business, make_user, login  # noqa: F401


class TestPerformanceHeaders:
    def test_public_search_is_cacheable_and_compressed(self, client, db):
        for i in range(40):  # enough rows to clear the 1 KB gzip threshold
            make_business(db, f"Cache Test Shop {i}")
        r = client.get("/api/search/map", headers={"Accept-Encoding": "gzip"})
        assert r.status_code == 200
        assert r.headers.get("content-encoding") == "gzip"
        assert "s-maxage" in r.headers.get("cache-control", "")
        r = client.get("/api/search", params={"limit": 5})
        assert "public" in r.headers.get("cache-control", "")
        # Public reads are anonymous and identical for everyone: the shared CDN
        # cache must not fragment per Origin.
        assert "Origin" not in r.headers.get("vary", "")

    def test_empty_results_are_not_cached(self, client, db):
        # An empty directory must never be cached and served to a whole region.
        make_business(db, "Somewhere Shop")  # exists, but filtered out below
        r = client.get("/api/search", params={"location": "Nowheresville, ZZ"})
        assert r.status_code == 200 and r.json()["total"] == 0
        assert "s-maxage" not in r.headers.get("cache-control", "")
        assert "no-store" in r.headers.get("cache-control", "")
        rm = client.get("/api/search/map", params={"location": "Nowheresville, ZZ"})
        assert rm.status_code == 200 and rm.json()["items"] == []
        assert "no-store" in rm.headers.get("cache-control", "")

    def test_business_detail_not_cached(self, client, db):
        b = make_business(db, "Counted Views Shop")
        r = client.get(f"/api/businesses/{b.id}")
        assert r.status_code == 200
        # Every view bumps views_count, so the CDN must not absorb them.
        assert "s-maxage" not in r.headers.get("cache-control", "")

    def test_private_endpoints_not_cached(self, client, db):
        make_user(db, "perf-user@example.com")
        h = login(client, "perf-user@example.com")
        r = client.get("/api/auth/me", headers=h)
        assert r.status_code == 200
        assert "public" not in r.headers.get("cache-control", "")
