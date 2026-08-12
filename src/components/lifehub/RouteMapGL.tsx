import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { GPSPoint } from "@/lib/walk-gps-utils";
import { decodePolyline } from "@/lib/walk-gps-utils";

interface RouteMapGLProps {
  /** Either raw GPS points or encoded polyline */
  points?: GPSPoint[];
  encodedPolyline?: string;
  /** Start/end coordinates (fallback if no points/polyline) */
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  height?: number;
  interactive?: boolean;
  showMarkers?: boolean;
}

/**
 * MapLibre GL JS route map for walk summaries
 * 
 * Uses free OpenStreetMap tiles via MapLibre (no API key needed).
 * Renders GPS routes as smooth polylines with start/end markers.
 */
export default function RouteMapGL({
  points,
  encodedPolyline,
  startLat,
  startLng,
  endLat,
  endLng,
  height = 260,
  interactive = true,
  showMarkers = true,
}: RouteMapGLProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Decode polyline or use provided points
    let routePoints: GPSPoint[] = [];
    if (encodedPolyline) {
      routePoints = decodePolyline(encodedPolyline);
    } else if (points && points.length > 0) {
      routePoints = points;
    } else if (startLat != null && startLng != null && endLat != null && endLng != null) {
      // Fallback: create simple route from start/end
      routePoints = [
        { lat: startLat, lng: startLng, ts: 0 },
        { lat: endLat, lng: endLng, ts: 0 },
      ];
    }

    if (routePoints.length < 2) {
      // Not enough points to render a route
      return;
    }

    // Filter invalid points
    const validPoints = routePoints.filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0)
    );

    if (validPoints.length < 2) return;

    // Calculate bounds
    const lats = validPoints.map((p) => p.lat);
    const lngs = validPoints.map((p) => p.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // Initialize MapLibre map
    const map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          },
        },
        layers: [
          {
            id: "osm-tiles",
            type: "raster",
            source: "osm",
            minzoom: 0,
            maxzoom: 19,
          },
        ],
      },
      center: [(minLng + maxLng) / 2, (minLat + maxLat) / 2],
      zoom: 13,
      interactive,
      attributionControl: false,
    });

    mapRef.current = map;

    map.on("load", () => {
      // Add route line source
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: {
            type: "LineString",
            coordinates: validPoints.map((p) => [p.lng, p.lat]),
          },
        },
      });

      // Add route line layer
      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
          "line-join": "round",
          "line-cap": "round",
        },
        paint: {
          "line-color": "#7C5CFC",
          "line-width": 4,
          "line-opacity": 0.9,
        },
      });

      // Add start/end markers
      if (showMarkers) {
        // Start marker (green)
        const startEl = document.createElement("div");
        startEl.style.width = "14px";
        startEl.style.height = "14px";
        startEl.style.borderRadius = "50%";
        startEl.style.backgroundColor = "#22c55e";
        startEl.style.border = "3px solid #fff";
        startEl.style.boxShadow = "0 1px 4px rgba(0,0,0,.4)";

        new maplibregl.Marker({ element: startEl })
          .setLngLat([validPoints[0].lng, validPoints[0].lat])
          .addTo(map);

        // End marker (red)
        const endEl = document.createElement("div");
        endEl.style.width = "14px";
        endEl.style.height = "14px";
        endEl.style.borderRadius = "50%";
        endEl.style.backgroundColor = "#ef4444";
        endEl.style.border = "3px solid #fff";
        endEl.style.boxShadow = "0 1px 4px rgba(0,0,0,.4)";

        new maplibregl.Marker({ element: endEl })
          .setLngLat([validPoints[validPoints.length - 1].lng, validPoints[validPoints.length - 1].lat])
          .addTo(map);
      }

      // Fit bounds to route with padding
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat],
        ],
        {
          padding: { top: 40, bottom: 40, left: 40, right: 40 },
          maxZoom: 16,
        }
      );
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [points, encodedPolyline, startLat, startLng, endLat, endLng, interactive, showMarkers]);

  return <div ref={containerRef} style={{ height, width: "100%" }} className="rounded-xl overflow-hidden" />;
}
