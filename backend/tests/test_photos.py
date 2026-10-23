"""Photo upload security and authorization."""
import io

from app.models import UserRole
from tests.test_api import client, login, make_business, make_user  # noqa: F401

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
FAKE = b"<script>alert(1)</script>" + b"\x00" * 64


def _owner(client, db):
    p = make_user(db, "photo-owner@example.com", role=UserRole.PROVIDER)
    b = make_business(db, owner_user_id=p.id)
    return b, login(client, "photo-owner@example.com")


def upload(client, b, headers, data, name="x.png"):
    return client.post(f"/api/businesses/{b.id}/photos", headers=headers,
                       files={"file": (name, io.BytesIO(data), "image/png")})


class TestPhotos:
    def test_owner_can_upload_real_image(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setenv("MEDIA_DIR", str(tmp_path))
        from app.config import get_settings
        get_settings.cache_clear()
        b, h = _owner(client, db)
        r = upload(client, b, h, PNG)
        assert r.status_code == 201, r.text
        assert r.json()["path"].endswith(".png")
        # served filename is generated, never the client's
        assert "x.png" not in r.json()["path"]
        get_settings.cache_clear()

    def test_non_image_rejected_despite_content_type(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setenv("MEDIA_DIR", str(tmp_path))
        from app.config import get_settings
        get_settings.cache_clear()
        b, h = _owner(client, db)
        r = upload(client, b, h, FAKE, name="evil.png")
        assert r.status_code == 422
        get_settings.cache_clear()

    def test_stranger_cannot_upload(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setenv("MEDIA_DIR", str(tmp_path))
        from app.config import get_settings
        get_settings.cache_clear()
        b, _ = _owner(client, db)
        make_user(db, "photo-stranger@example.com", role=UserRole.PROVIDER)
        hs = login(client, "photo-stranger@example.com")
        assert upload(client, b, hs, JPG).status_code == 403
        get_settings.cache_clear()

    def test_photo_appears_in_detail_and_can_be_deleted(self, client, db, tmp_path, monkeypatch):
        monkeypatch.setenv("MEDIA_DIR", str(tmp_path))
        from app.config import get_settings
        get_settings.cache_clear()
        b, h = _owner(client, db)
        pid = upload(client, b, h, JPG).json()["id"]
        detail = client.get(f"/api/businesses/{b.id}").json()
        assert len(detail["photos"]) == 1
        assert client.delete(f"/api/businesses/{b.id}/photos/{pid}", headers=h).status_code == 204
        assert client.get(f"/api/businesses/{b.id}").json()["photos"] == []
        get_settings.cache_clear()
