"""Compression and cache headers: public reads cacheable, private never."""
from tests.test_api import client, make_business, make_user, login  # noqa: F401


class TestPerformanceHeaders:
    def test_search_is_compressed_but_never_cached(self, client, db):
        for i in range(40):  # enough rows to clear the 1 KB gzip threshold
            make_business(db, f"Cache Test Shop {i}")
        r = client.get("/api/search/map", headers={"Accept-Encoding": "gzip"})
        assert r.status_code == 200
        assert r.headers.get("content-encoding") == "gzip"
        # Search is never cached — a stale/empty edge snapshot must be impossible.
        assert "no-store" in r.headers.get("cache-control", "")
        assert "s-maxage" not in r.headers.get("cache-control", "")
        r = client.get("/api/search", params={"limit": 5})
        assert "no-store" in r.headers.get("cache-control", "")

    def test_static_public_reads_still_cacheable(self, client, db):
        # Services is static and user-independent, so it stays CDN-cacheable.
        r = client.get("/api/services")
        assert r.status_code == 200
        assert "s-maxage" in r.headers.get("cache-control", "")
        assert "Origin" not in r.headers.get("vary", "")

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
