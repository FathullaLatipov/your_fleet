import zipfile
from io import BytesIO

import pytest
from sqlalchemy import select

from app.importer.kml import parse_kml, read_kml_bytes
from app.importer.normalize import haversine_m, normalize_name, normalize_phone, valid_coords
from app.importer.pipeline import run_import
from app.models import Business, DuplicateCandidate, SourceAction, SourceRecord


def kml_doc(placemarks: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document><name>SHOPS MAP v2</name>
    <Folder><name>TRUCK &amp; TRAILER shops</name>
      {placemarks}
    </Folder>
  </Document>
</kml>""".encode()


def placemark(name, lon, lat, desc="123 Main St, Dallas, TX 75201<br>+1 214-555-0100") -> str:
    # Real Google My Maps exports HTML-escape the <br> tags inside descriptions.
    esc = desc.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return (
        f"<Placemark><name>{name}</name><description>{esc}</description>"
        f"<Point><coordinates>{lon},{lat},0</coordinates></Point></Placemark>"
    )


SAMPLE = kml_doc(
    placemark("Alpha Truck Repair", -96.8, 32.78)
    + placemark("Beta Diesel LLC", -96.7, 32.75,
                "456 Elm St, Dallas, TX 75202<br>betadiesel.com<br>+1 972-555-0199")
    + placemark("No Coords Shop", "", "")
)


class TestParsing:
    def test_parses_placemarks_with_fields(self):
        pms = parse_kml(SAMPLE)
        assert len(pms) == 3
        alpha = pms[0]
        assert alpha.name == "Alpha Truck Repair"
        assert alpha.folder_path == "TRUCK & TRAILER shops"
        assert (alpha.lon, alpha.lat) == (-96.8, 32.78)
        assert alpha.phone == "+1 214-555-0100"
        assert (alpha.city, alpha.state, alpha.zip_code) == ("Dallas", "TX", "75201")

    def test_website_extracted_and_normalized(self):
        beta = parse_kml(SAMPLE)[1]
        assert beta.website == "https://betadiesel.com"
        assert beta.phone == "+1 972-555-0199"

    def test_invalid_coordinates_flagged(self):
        bad = parse_kml(SAMPLE)[2]
        assert bad.lat is None and bad.coord_error

    def test_strips_country_suffix_and_mojibake(self):
        data = kml_doc(placemark(
            "Gamma Shop", -96.0, 33.0,
            "530 Lake Dr, Tracy City, TN 37387, ���<br>+1 931-555-6767"))
        pm = parse_kml(data)[0]
        assert pm.address == "530 Lake Dr, Tracy City, TN 37387"
        assert (pm.city, pm.state) == ("Tracy City", "TN")

    def test_kmz_reading(self, tmp_path):
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("doc.kml", SAMPLE)
        p = tmp_path / "test.kmz"
        p.write_bytes(buf.getvalue())
        assert parse_kml(read_kml_bytes(str(p)))[0].name == "Alpha Truck Repair"

    def test_fingerprint_stable_and_distinct(self):
        pms = parse_kml(SAMPLE)
        assert pms[0].fingerprint() == parse_kml(SAMPLE)[0].fingerprint()
        assert pms[0].fingerprint() != pms[1].fingerprint()


class TestNormalize:
    def test_phone(self):
        assert normalize_phone("+1 214-555-0100") == "+12145550100"
        assert normalize_phone("(972) 555-0199") == "+19725550199"
        assert normalize_phone("12345") is None
        assert normalize_phone(None) is None

    def test_name(self):
        assert normalize_name("Beta Diesel, LLC.") == "beta diesel"
        assert normalize_name("A & B Truck Co") == "a and b truck"

    def test_coords(self):
        assert valid_coords(32.7, -96.8)
        assert not valid_coords(0, 0)
        assert not valid_coords(95.0, 10.0)
        assert not valid_coords(None, -96.8)

    def test_haversine(self):
        # Dallas -> Fort Worth is roughly 50 km
        d = haversine_m(32.7767, -96.7970, 32.7555, -97.3308)
        assert 45_000 < d < 55_000


class TestPipeline:
    def _write(self, tmp_path, data: bytes):
        p = tmp_path / "import.kml"
        p.write_bytes(data)
        return str(p)

    def test_import_creates_businesses(self, db, tmp_path):
        report = run_import(db, self._write(tmp_path, SAMPLE))
        assert (report.created, report.invalid) == (2, 1)
        names = set(db.execute(select(Business.name)).scalars())
        assert names == {"Alpha Truck Repair", "Beta Diesel LLC"}

    def test_reimport_is_idempotent(self, db, tmp_path):
        path = self._write(tmp_path, SAMPLE)
        run_import(db, path)
        report2 = run_import(db, path)
        assert report2.created == 0
        assert report2.skipped == 3  # invalid rows also become fingerprint-skips
        assert db.execute(select(Business)).scalars().all().__len__() == 2

    def test_exact_in_file_duplicate_not_duplicated(self, db, tmp_path):
        data = kml_doc(placemark("Dup Shop", -96.8, 32.78) + placemark("Dup Shop", -96.8, 32.78))
        report = run_import(db, self._write(tmp_path, data))
        assert (report.created, report.duplicates) == (1, 1)

    def test_probable_duplicates_flagged_not_merged(self, db, tmp_path):
        # Same phone, different names/locations -> both created, pair flagged.
        data = kml_doc(
            placemark("Shop One", -96.8, 32.78)
            + placemark("Shop Two", -90.0, 35.00, "9 Oak St, Memphis, TN 38103<br>+1 214-555-0100")
        )
        report = run_import(db, self._write(tmp_path, data))
        assert report.created == 2
        cands = db.execute(select(DuplicateCandidate)).scalars().all()
        assert len(cands) == 1 and cands[0].reason == "same phone number"

    def test_dry_run_persists_nothing(self, db, tmp_path):
        report = run_import(db, self._write(tmp_path, SAMPLE), dry_run=True)
        assert report.created == 2
        assert db.execute(select(Business)).scalars().first() is None
        assert db.execute(select(SourceRecord)).scalars().first() is None

    def test_invalid_records_audited(self, db, tmp_path):
        run_import(db, self._write(tmp_path, SAMPLE))
        invalid = [r for r in db.execute(select(SourceRecord)).scalars()
                   if r.action == SourceAction.INVALID]
        assert len(invalid) == 1 and invalid[0].business_id is None
