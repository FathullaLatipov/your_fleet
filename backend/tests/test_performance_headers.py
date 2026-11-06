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
