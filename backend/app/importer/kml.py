"""KML / KMZ parsing for Google My Maps exports.

Pure parsing only — no database access. Produces RawPlacemark objects that the
pipeline validates, normalizes and persists.
"""
from __future__ import annotations

import hashlib
import re
import zipfile
from dataclasses import dataclass, field
from io import BytesIO
from xml.etree import ElementTree as ET

KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}

# Safety limit for decompressed KMZ content (zip-bomb guard).
MAX_KML_BYTES = 200 * 1024 * 1024

PHONE_RE = re.compile(r"\+?1?[\s\-.(]*\d{3}[)\s\-.]*\d{3}[\s\-.]*\d{4}")
URL_RE = re.compile(
    r"^(?:https?://)?(?:www\.)?[a-z0-9][a-z0-9\-]*(?:\.[a-z0-9\-]+)+(?:/\S*)?$", re.I
)
CITY_STATE_ZIP_RE = re.compile(r",\s*([^,]+?),\s*([A-Z]{2})[\s,]+(\d{5})(?:-\d{4})?")
# Country suffixes seen in the dataset, including mojibake of non-ASCII country names.
COUNTRY_SUFFIX_RE = re.compile(r",?\s*(United States|USA|U\.S\.A\.|�+)\s*$", re.I)


@dataclass
class RawPlacemark:
    name: str | None
    description: str | None
    folder_path: str
    lon: float | None
    lat: float | None
    extended_data: dict[str, str | None] = field(default_factory=dict)
    coord_error: str | None = None

    # Derived fields (filled by parse_description)
    address: str | None = None
    city: str | None = None
    state: str | None = None
    zip_code: str | None = None
    phone: str | None = None
    website: str | None = None

    def fingerprint(self) -> str:
        """Stable identity of the source content; drives import idempotency."""
        lat = f"{self.lat:.6f}" if self.lat is not None else ""
        lon = f"{self.lon:.6f}" if self.lon is not None else ""
        payload = "|".join([self.name or "", lat, lon, self.description or ""])
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()

    def as_raw_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "folder": self.folder_path,
            "lat": self.lat,
            "lon": self.lon,
            "extended_data": {k: v for k, v in self.extended_data.items() if v},
        }


def read_kml_bytes(path: str) -> bytes:
    """Read KML content from a .kml file or from the KML document inside a .kmz."""
    if path.lower().endswith(".kmz"):
        with zipfile.ZipFile(path) as z:
            kml_names = [n for n in z.namelist() if n.lower().endswith(".kml")]
            if not kml_names:
                raise ValueError(f"No KML document found inside KMZ archive: {path}")
            # Prefer the conventional doc.kml at the archive root.
            name = next((n for n in kml_names if n.lower() == "doc.kml"), kml_names[0])
            info = z.getinfo(name)
            if info.file_size > MAX_KML_BYTES:
                raise ValueError(f"KML inside KMZ exceeds safety limit: {info.file_size} bytes")
            with z.open(name) as f:
                return f.read(MAX_KML_BYTES + 1)
    with open(path, "rb") as f:
        return f.read()


def _text(el: ET.Element | None) -> str | None:
    if el is not None and el.text and el.text.strip():
        return el.text.strip()
    return None


def _walk(el: ET.Element, folder_path: list[str], out: list[tuple[str, ET.Element]]) -> None:
    name = _text(el.find("kml:name", KML_NS))
    path = folder_path + [name] if el.tag.endswith("Folder") and name else folder_path
    for pm in el.findall("kml:Placemark", KML_NS):
        out.append(("/".join(path), pm))
    for child_tag in ("kml:Folder", "kml:Document"):
        for sub in el.findall(child_tag, KML_NS):
            _walk(sub, path, out)


def parse_kml(data: bytes) -> list[RawPlacemark]:
    root = ET.fromstring(data)
    found: list[tuple[str, ET.Element]] = []
    _walk(root, [], found)

    results = []
    for folder, pm in found:
        raw = RawPlacemark(
            name=_text(pm.find("kml:name", KML_NS)),
            description=_text(pm.find("kml:description", KML_NS)),
            folder_path=folder,
            lon=None,
            lat=None,
        )
        coords = _text(pm.find(".//kml:Point/kml:coordinates", KML_NS))
        if coords is None:
            raw.coord_error = "no Point coordinates"
        else:
            parts = coords.split(",")
            try:
                raw.lon, raw.lat = float(parts[0]), float(parts[1])
            except (ValueError, IndexError):
                raw.coord_error = f"unparseable coordinates: {coords[:64]}"
        for d in pm.findall(".//kml:ExtendedData/kml:Data", KML_NS):
            key = d.get("name")
            if key:
                raw.extended_data[key] = _text(d.find("kml:value", KML_NS))
        parse_description(raw)
        results.append(raw)
    return results


def parse_description(raw: RawPlacemark) -> None:
    """Extract address / phone / website from a Google My Maps description blob.

    Observed format: lines separated by <br>, first line(s) are the address,
    then optionally a website and a phone number, then empty "Key: " pairs
    mirroring the (empty) ExtendedData.
    """
    if not raw.description:
        return
    lines = [ln.strip() for ln in re.split(r"<br\s*/?>", raw.description)]
    address_parts: list[str] = []
    for line in lines:
        if not line or re.match(r"^[\w &]+:\s*$", line):  # empty "Key:" artifacts
            continue
        if raw.phone is None and PHONE_RE.fullmatch(line.strip()):
            raw.phone = line.strip()
            continue
        m = PHONE_RE.search(line)
        if raw.phone is None and m and len(line) < 32:
            raw.phone = m.group(0)
            continue
        if raw.website is None and URL_RE.match(line) and not line[0].isdigit():
            raw.website = line if line.lower().startswith("http") else f"https://{line}"
            continue
        address_parts.append(line)

    if address_parts:
        address = ", ".join(address_parts)
        address = address.replace("�", "").strip()
        address = COUNTRY_SUFFIX_RE.sub("", address).rstrip(", ")
        raw.address = address or None
        m = CITY_STATE_ZIP_RE.search(address)
        if m:
            raw.city, raw.state, raw.zip_code = m.group(1).strip(), m.group(2), m.group(3)
