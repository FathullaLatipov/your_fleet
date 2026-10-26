"use client";

import L from "leaflet";
import "leaflet.markercluster";
import { useEffect, useRef } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";

import type { MapPoint } from "@/lib/types";

function pinIcon(b: MapPoint, active: boolean) {
  const variant = active
    ? "yf-pin--active"
    : b.partner_status === "active" && b.has_active_offer
      ? "yf-pin--offer"
      : b.partner_status === "active"
        ? "yf-pin--partner"
        : "";
  const label = b.partner_status === "active" && b.has_active_offer ? "$" : "";
  return L.divIcon({
    className: "",
    html: `<div class="yf-pin ${variant}"><span>${label}</span></div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 24],
    popupAnchor: [0, -22],
  });
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

function ClusterLayer({
  items,
  activeId,
  onSelect,
}: {
  items: MapPoint[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const map = useMap();
  const groupRef = useRef<L.MarkerClusterGroup | null>(null);
  const fitted = useRef("");

  useEffect(() => {
    const group = L.markerClusterGroup({
      maxClusterRadius: 44,
      chunkedLoading: true,
      showCoverageOnHover: false,
      iconCreateFunction: (cluster) =>
        L.divIcon({
          className: "",
          html: `<div class="yf-cluster" style="width:100%;height:100%">${cluster.getChildCount()}</div>`,
          iconSize: [36, 36],
        }),
    });
    map.addLayer(group);
    groupRef.current = group;
    return () => {
      map.removeLayer(group);
    };
  }, [map]);

  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.clearLayers();
    for (const b of items) {
      const marker = L.marker([b.lat, b.lng], { icon: pinIcon(b, b.id === activeId) });
      marker.bindPopup(
        `<strong>${esc(b.name)}</strong><br/>` +
          `${b.city ? esc(`${b.city}, ${b.state ?? ""}`) : esc(b.state ?? "")}` +
          `${b.distance_miles != null ? ` · ${b.distance_miles} mi` : ""}<br/>` +
          `<a href="/business/${b.id}">View profile</a>`,
      );
      marker.on("click", () => onSelect(b.id));
      group.addLayer(marker);
    }
    const key = items.map((i) => i.id).join(",");
    if (items.length && key !== fitted.current) {
      fitted.current = key;
      const bounds = L.latLngBounds(items.map((i) => [i.lat, i.lng] as [number, number]));
      map.fitBounds(bounds.pad(0.15), { maxZoom: 12 });
    }
  }, [items, activeId, map, onSelect]);

  return null;
}

export default function MapView({
  items,
  activeId,
  onSelect,
}: {
  items: MapPoint[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <MapContainer center={[39.5, -96.5]} zoom={4} className="h-full w-full" scrollWheelZoom>
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClusterLayer items={items} activeId={activeId} onSelect={onSelect} />
    </MapContainer>
  );
}
