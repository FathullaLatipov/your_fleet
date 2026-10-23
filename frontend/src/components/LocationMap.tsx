"use client";

import L from "leaflet";
import { MapContainer, Marker, TileLayer } from "react-leaflet";

const icon = L.divIcon({
  className: "",
  html: `<div class="yf-pin yf-pin--active"><span></span></div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 24],
});

export default function LocationMap({ lat, lng }: { lat: number; lng: number }) {
  return (
    <MapContainer
      center={[lat, lng]}
      zoom={13}
      className="h-full w-full"
      scrollWheelZoom={false}
      dragging={false}
      zoomControl={false}
      attributionControl={false}
    >
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <Marker position={[lat, lng]} icon={icon} />
    </MapContainer>
  );
}
