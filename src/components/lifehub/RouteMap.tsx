import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { WalkRoutePoint } from "@/lib/notifications-integration";

interface RouteMapProps {
  /** Route points in order (start → end). Simplified with RDP before saving. */
  points: WalkRoutePoint[];
  /** Optional elevation/profile data is not rendered — keep it light. */
  height?: number;
  interactive?: boolean;
}

/**
 * Lightweight OpenStreetMap/Leaflet route map for the walk summary screen.
 *
 * Renders the exact GPS path (start → end) as a polyline with a green start
 * marker and a red finish marker, auto-fitting the viewport to the route.
 * Imported dynamically by callers that need it so the web bundle stays lean.
 */
export default function RouteMap({ points, height = 260, interactive = true }: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !points || points.length < 2) return;

    const latLngs = points
      .map((p) => [p.lat, p.lng] as [number, number])
      .filter(
        ([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0),
      );

    if (latLngs.length < 2) return;

    const map = L.map(container, {
      zoomControl: interactive,
      attributionControl: true,
      scrollWheelZoom: interactive,
      dragging: interactive,
    }).fitBounds(L.latLngBounds(latLngs).pad(0.15));

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);

    L.polyline(latLngs, {
      color: "#7C5CFC",
      weight: 4,
      opacity: 0.9,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    const startIcon = L.divIcon({
      className: "route-marker",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#22c55e;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    const endIcon = L.divIcon({
      className: "route-marker",
      html: `<div style="width:14px;height:14px;border-radius:50%;background:#ef4444;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

    L.marker(latLngs[0], { icon: startIcon }).addTo(map);
    L.marker(latLngs[latLngs.length - 1], { icon: endIcon }).addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points, interactive]);

  return <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-xl z-0" />;
}
