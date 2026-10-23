"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";

import type { BusinessListItem } from "@/lib/types";

function pinIcon(b: BusinessListItem, active: boolean) {
  const cls = [
    "yf-pin",
    b.partner_status === "active" ? "yf-pin--partner" : "",
    active ? "yf-pin--active" : "",
  ].join(" ");
  return L.divIcon({ className: cls, iconSize: [14, 14], iconAnchor: [7, 7] });
}

function FitBounds({ items }: { items: BusinessListItem[] }) {
  const map = useMap();
  const fitted = useRef("");
  useEffect(() => {
    if (!items.length) return;
    const key = items.map((i) => i.id).join(",");
    if (key === fitted.current) return;
    fitted.current = key;
    const bounds = L.latLngBounds(items.map((i) => [i.lat, i.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.15), { maxZoom: 12 });
  }, [items, map]);
  return null;
}

export default function MapView({
  items,
  activeId,
  onSelect,
}: {
  items: BusinessListItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <MapContainer
      center={[39.5, -96.5]}
      zoom={4}
      className="h-full w-full"
      scrollWheelZoom
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds items={items} />
      {items.map((b) => (
        <Marker
          key={b.id}
          position={[b.lat, b.lng]}
          icon={pinIcon(b, b.id === activeId)}
          eventHandlers={{ click: () => onSelect(b.id) }}
        >
          <Popup>
            <strong>{b.name}</strong>
            <br />
            {b.city ? `${b.city}, ${b.state}` : b.state}
            {b.distance_miles != null && ` · ${b.distance_miles} mi`}
            <br />
            <a href={`/business/${b.id}`}>View profile</a>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
