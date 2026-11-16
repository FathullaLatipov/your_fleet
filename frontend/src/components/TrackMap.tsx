"use client";

import L from "leaflet";
import "leaflet.markercluster";
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

export interface TruckPos {
  id: string;
  unit_number: string;
  driver: string | null;
  lat: number;
  lng: number;
  heading: number | null;
  speed_mph: number | null;
  located_at: string | null;
  connected: boolean;
}
export interface LovesStop {
  name: string;
  lat: number;
  lng: number;
  city: string | null;
  state: string | null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/* A truck marker: a heading arrow when we know the direction, else a dot. */
function truckIcon(t: TruckPos, active: boolean) {
  const cls = active ? "yf-truck yf-truck--active" : "yf-truck";
  if (t.heading != null && (t.speed_mph ?? 0) > 1) {
    return L.divIcon({
      className: "",
      html: `<div class="${cls}" style="transform:rotate(${t.heading}deg)">
        <svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 2 L19 21 L12 16 L5 21 Z"/></svg></div>`,
      iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -14],
    });
  }
  return L.divIcon({
    className: "",
    html: `<div class="${cls} yf-truck--dot"><span>${esc(t.unit_number)}</span></div>`,
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -15],
  });
}

function lovesIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="yf-loves">L</div>`,
    iconSize: [20, 20], iconAnchor: [10, 10], popupAnchor: [0, -10],
  });
}

function Layers({
  trucks, loves, selectedId, onSelectTruck,
}: {
  trucks: TruckPos[];
  loves: LovesStop[];
  selectedId: string | null;
  onSelectTruck: (id: string) => void;
}) {
  const map = useMap();
  const truckLayer = useRef<L.LayerGroup | null>(null);
  const lovesLayer = useRef<L.MarkerClusterGroup | null>(null);

  // Love's cluster: drawn once, independent of selection.
  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius: 50, showCoverageOnHover: false, chunkedLoading: true,
      iconCreateFunction: (c) =>
        L.divIcon({ className: "",
          html: `<div class="yf-loves-cluster">${c.getChildCount()}</div>`, iconSize: [34, 34] }),
    });
    for (const s of loves) {
      const where = [s.city, s.state].filter(Boolean).join(", ");
      L.marker([s.lat, s.lng], { icon: lovesIcon() })
        .bindPopup(`<strong>${esc(s.name)}</strong>${where ? `<br/>${esc(where)}` : ""}` +
          `<br/><a href="https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}" target="_blank" rel="noopener">Directions</a>`)
        .addTo(group);
    }
    map.addLayer(group);
    lovesLayer.current = group;
    return () => { map.removeLayer(group); };
  }, [map, loves]);

  // Truck markers: redrawn when positions or selection change.
  useEffect(() => {
    truckLayer.current?.remove();
    const group = L.layerGroup();
    for (const t of trucks) {
      const when = t.located_at ? new Date(t.located_at).toLocaleString() : "";
      const m = L.marker([t.lat, t.lng], { icon: truckIcon(t, t.id === selectedId), zIndexOffset: 1000 });
      m.bindPopup(`<strong>#${esc(t.unit_number)}</strong>${t.driver ? ` · ${esc(t.driver)}` : ""}` +
        `${t.speed_mph != null ? `<br/>${Math.round(t.speed_mph)} mph` : ""}` +
        `${when ? `<br/><span style="color:#64748b">${esc(when)}</span>` : ""}`);
      m.on("click", () => onSelectTruck(t.id));
      m.addTo(group);
    }
    map.addLayer(group);
    truckLayer.current = group;
    return () => { group.remove(); };
  }, [map, trucks, selectedId, onSelectTruck]);

  // Center on the selected truck.
  const centered = useRef<string | null>(null);
  useEffect(() => {
    const t = trucks.find((x) => x.id === selectedId);
    if (t && centered.current !== selectedId) {
      centered.current = selectedId;
      map.setView([t.lat, t.lng], Math.max(map.getZoom(), 9), { animate: true });
    }
  }, [map, trucks, selectedId]);

  return null;
}

export default function TrackMap({
  trucks, loves, selectedId, onSelectTruck,
}: {
  trucks: TruckPos[];
  loves: LovesStop[];
  selectedId: string | null;
  onSelectTruck: (id: string) => void;
}) {
  const center: [number, number] = trucks[0] ? [trucks[0].lat, trucks[0].lng] : [39.5, -96.5];
  return (
    <MapContainer center={center} zoom={trucks[0] ? 6 : 4} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Layers trucks={trucks} loves={loves} selectedId={selectedId} onSelectTruck={onSelectTruck} />
    </MapContainer>
  );
}
