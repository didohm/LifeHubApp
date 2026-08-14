import { useEffect, useRef, useState, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Maximize2, Minimize2, Layers, MapPin, Navigation } from "lucide-react";
import {
  decodePolyline,
  haversineDistance,
  formatPace,
  formatDuration,
  formatDistance,
} from "@/lib/walk-gps-utils";

export interface RoutePoint {
  lat: number;
  lng: number;
  ts?: number;
}

export interface RouteMapProps {
  /** Route points in order (start → end). */
  points?: RoutePoint[];
  /** Or encoded polyline string */
  encodedPolyline?: string;
  /** Fallback start/end coordinates */
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  height?: number;
  interactive?: boolean;
  showMarkers?: boolean;
  showKmMarkers?: boolean;
  showStatsOverlay?: boolean;
  distanceMeters?: number;
  durationSeconds?: number;
  paceSecondsPerKm?: number | null;
  allowFullscreen?: boolean;
  allowLayerToggle?: boolean;
  className?: string;
}

type TileLayerType = "voyager" | "satellite" | "dark" | "osm";

const TILE_LAYERS: Record<
  TileLayerType,
  { name: string; url: string; attribution: string; subdomains?: string[] }
> = {
  voyager: {
    name: "Street",
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    subdomains: ["a", "b", "c", "d"],
  },
  satellite: {
    name: "Satellite",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution:
      "&copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
  },
  dark: {
    name: "Dark",
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution:
      '&copy; <a href="https://carto.com/">CARTO</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    subdomains: ["a", "b", "c", "d"],
  },
  osm: {
    name: "Outdoors",
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
};

/**
 * Premium Strava-Style Route Map
 *
 * Renders high-contrast Strava-orange routes, start/finish flags,
 * kilometer badges, live location fallbacks, layer switcher, and
 * auto-fitting viewport with robust resize handling.
 */
export default function RouteMap({
  points,
  encodedPolyline,
  startLat,
  startLng,
  endLat,
  endLng,
  height = 280,
  interactive = true,
  showMarkers = true,
  showKmMarkers = true,
  showStatsOverlay = false,
  distanceMeters,
  durationSeconds,
  paceSecondsPerKm,
  allowFullscreen = true,
  allowLayerToggle = true,
  className = "",
}: RouteMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const [activeLayer, setActiveLayer] = useState<TileLayerType>("voyager");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Normalize points from all available sources
  const parsedPoints = useMemo<RoutePoint[]>(() => {
    if (encodedPolyline) {
      const decoded = decodePolyline(encodedPolyline);
      if (decoded.length > 0) return decoded;
    }
    if (points && points.length > 0) {
      return points;
    }
    if (startLat != null && startLng != null) {
      const pts: RoutePoint[] = [{ lat: startLat, lng: startLng }];
      if (endLat != null && endLng != null && (endLat !== startLat || endLng !== startLng)) {
        pts.push({ lat: endLat, lng: endLng });
      }
      return pts;
    }
    return [];
  }, [points, encodedPolyline, startLat, startLng, endLat, endLng]);

  // Try to acquire user's current location if no points exist
  useEffect(() => {
    if (
      parsedPoints.length === 0 &&
      !userLocation &&
      typeof window !== "undefined" &&
      "geolocation" in navigator
    ) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        },
        () => {},
        { timeout: 4000, maximumAge: 60000 },
      );
    }
  }, [parsedPoints, userLocation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Filter valid coordinates
    const validPoints = (
      parsedPoints.length > 0 ? parsedPoints : userLocation ? [userLocation] : []
    ).filter(
      (p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && !(p.lat === 0 && p.lng === 0),
    );

    const latLngs = validPoints.map((p) => [p.lat, p.lng] as [number, number]);

    // Initial center & zoom
    const centerLatLng: [number, number] = latLngs.length > 0 ? latLngs[0] : [24.7136, 46.6753]; // Default Riyadh fallback if 0 coords
    const initialZoom = latLngs.length > 1 ? 14 : 16;

    // Tear down any previous map on this container
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const map = L.map(container, {
      center: centerLatLng,
      zoom: initialZoom,
      zoomControl: false, // We place custom or cleaner zoom if interactive
      attributionControl: false,
      scrollWheelZoom: interactive,
      dragging: interactive,
      touchZoom: interactive,
      doubleClickZoom: interactive,
    });

    if (interactive) {
      L.control.zoom({ position: "bottomright" }).addTo(map);
    }

    // Set initial tile layer
    const layerConfig = TILE_LAYERS[activeLayer];
    const tileLayer = L.tileLayer(layerConfig.url, {
      maxZoom: 19,
      subdomains: layerConfig.subdomains || "abc",
      attribution: layerConfig.attribution,
    }).addTo(map);
    tileLayerRef.current = tileLayer;

    // ──────────────────────────────────────────────────────────────────────────
    // Route Polyline & Markers
    // ──────────────────────────────────────────────────────────────────────────
    if (latLngs.length >= 2) {
      // 1. Drop shadow / casing polyline (makes the Strava route pop on any map background)
      L.polyline(latLngs, {
        color: "#000000",
        weight: 8,
        opacity: 0.25,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // 2. High-contrast Strava signature orange polyline
      L.polyline(latLngs, {
        color: "#FC5200", // Iconic Strava Orange
        weight: 5,
        opacity: 1,
        lineCap: "round",
        lineJoin: "round",
      }).addTo(map);

      // Fit bounds comfortably around the entire route
      const bounds = L.latLngBounds(latLngs);
      map.fitBounds(bounds.pad(0.18), { animate: false });

      if (showMarkers) {
        // Start Marker (Green Play Icon)
        const startIcon = L.divIcon({
          className: "strava-start-marker",
          html: `
            <div style="
              display:flex;align-items:center;justify-content:center;
              width:24px;height:24px;border-radius:50%;
              background:#22C55E;border:2.5px solid #FFFFFF;
              box-shadow:0 2px 8px rgba(0,0,0,0.35);
              color:white;
            ">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="white" style="margin-left:1px;">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        // Finish Marker (Checkered / Rose Flag Icon)
        const endIcon = L.divIcon({
          className: "strava-end-marker",
          html: `
            <div style="
              display:flex;align-items:center;justify-content:center;
              width:24px;height:24px;border-radius:50%;
              background:#EF4444;border:2.5px solid #FFFFFF;
              box-shadow:0 2px 8px rgba(0,0,0,0.35);
              color:white;
            ">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3">
                <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
                <line x1="4" y1="22" x2="4" y2="15"></line>
              </svg>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });

        L.marker(latLngs[0], { icon: startIcon, title: "Start" }).addTo(map);
        L.marker(latLngs[latLngs.length - 1], { icon: endIcon, title: "Finish" }).addTo(map);
      }

      // 3. Kilometer markers along the route (Strava split markers)
      if (showKmMarkers) {
        let cumulative = 0;
        let nextKm = 1;

        for (let i = 1; i < validPoints.length; i++) {
          const prev = validPoints[i - 1];
          const curr = validPoints[i];
          const dist = haversineDistance(prev.lat, prev.lng, curr.lat, curr.lng);
          cumulative += dist;

          if (cumulative >= nextKm * 1000) {
            const kmIcon = L.divIcon({
              className: "strava-km-marker",
              html: `
                <div style="
                  display:flex;align-items:center;justify-content:center;
                  width:20px;height:20px;border-radius:50%;
                  background:#0F172A;border:1.5px solid #FC5200;
                  box-shadow:0 1px 4px rgba(0,0,0,0.4);
                  color:#FFFFFF;font-size:9px;font-weight:900;
                  font-family:system-ui,-apple-system,sans-serif;
                ">
                  ${nextKm}
                </div>
              `,
              iconSize: [20, 20],
              iconAnchor: [10, 10],
            });

            L.marker([curr.lat, curr.lng], { icon: kmIcon, title: `KM ${nextKm}` }).addTo(map);
            nextKm++;
          }
        }
      }
    } else if (latLngs.length === 1) {
      // Single Point: Center on location with vibrant beacon
      map.setView(latLngs[0], 16);

      const singleIcon = L.divIcon({
        className: "strava-single-marker",
        html: `
          <div style="position:relative;display:flex;align-items:center;justify-content:center;width:32px;height:32px;">
            <div style="position:absolute;width:32px;height:32px;border-radius:50%;background:rgba(34,197,94,0.3);animation:ping 2s cubic-bezier(0,0,0.2,1) infinite;"></div>
            <div style="width:16px;height:16px;border-radius:50%;background:#22C55E;border:3px solid #FFFFFF;box-shadow:0 2px 8px rgba(0,0,0,0.4);"></div>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      L.marker(latLngs[0], { icon: singleIcon, title: "Walk Location" })
        .addTo(map)
        .bindPopup("<b>Walk Location</b><br>Session recorded here")
        .openPopup();
    }

    mapRef.current = map;

    // ──────────────────────────────────────────────────────────────────────────
    // Modal & Animation resize fix (Essential for Leaflet in Dialogs/Portals)
    // ──────────────────────────────────────────────────────────────────────────
    const resizeTimers = [
      setTimeout(() => map.invalidateSize(), 80),
      setTimeout(() => map.invalidateSize(), 250),
      setTimeout(() => map.invalidateSize(), 500),
    ];

    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeTimers.forEach(clearTimeout);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [parsedPoints, userLocation, activeLayer, interactive, showMarkers, showKmMarkers]);

  // Handle layer switching
  const toggleLayer = () => {
    const layers: TileLayerType[] = ["voyager", "satellite", "dark", "osm"];
    const nextIdx = (layers.indexOf(activeLayer) + 1) % layers.length;
    setActiveLayer(layers[nextIdx]);
  };

  return (
    <div
      className={`relative rounded-2xl overflow-hidden border border-slate-200/80 bg-slate-100 shadow-inner group ${
        isFullscreen ? "fixed inset-0 z-[100] rounded-none h-screen w-screen" : ""
      } ${className}`}
      style={{ height: isFullscreen ? "100vh" : height, width: "100%" }}
    >
      <div ref={containerRef} className="h-full w-full z-0" />

      {/* Map Header Floating Overlay / Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
        {allowLayerToggle && (
          <button
            type="button"
            onClick={toggleLayer}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-white/90 backdrop-blur-md text-[#1E293B] shadow-md hover:bg-white text-[11px] font-black border border-slate-200/60 active:scale-95 transition-all"
            title={`Current: ${TILE_LAYERS[activeLayer].name}. Click to switch layer.`}
          >
            <Layers className="size-3 text-[#FC5200]" />
            <span>{TILE_LAYERS[activeLayer].name}</span>
          </button>
        )}

        {allowFullscreen && (
          <button
            type="button"
            onClick={() => {
              setIsFullscreen(!isFullscreen);
              setTimeout(() => mapRef.current?.invalidateSize(), 150);
            }}
            className="size-8 flex items-center justify-center rounded-full bg-white/90 backdrop-blur-md text-[#1E293B] shadow-md hover:bg-white border border-slate-200/60 active:scale-95 transition-all"
            title={isFullscreen ? "Exit Fullscreen" : "Expand Map"}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        )}
      </div>

      {/* Strava floating route stats card (if enabled) */}
      {showStatsOverlay && (distanceMeters != null || durationSeconds != null) && (
        <div className="absolute bottom-3 left-3 z-10 rounded-xl bg-slate-900/85 backdrop-blur-md px-3.5 py-2 text-white shadow-xl border border-white/10 flex items-center gap-3.5">
          {distanceMeters != null && (
            <div>
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wide">Distance</p>
              <p className="text-xs font-black text-white">{formatDistance(distanceMeters)}</p>
            </div>
          )}
          {durationSeconds != null && (
            <div className="border-l border-white/20 pl-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wide">Time</p>
              <p className="text-xs font-black text-white">{formatDuration(durationSeconds)}</p>
            </div>
          )}
          {paceSecondsPerKm != null && paceSecondsPerKm > 0 && (
            <div className="border-l border-white/20 pl-3">
              <p className="text-[9px] font-bold text-white/60 uppercase tracking-wide">Pace</p>
              <p className="text-xs font-black text-[#FC5200]">{formatPace(paceSecondsPerKm)}/km</p>
            </div>
          )}
        </div>
      )}

      {/* Route Legend Indicator */}
      {parsedPoints.length >= 2 && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2 rounded-full bg-white/85 backdrop-blur-md px-2.5 py-1 text-[10px] font-black text-[#1E293B] shadow-sm border border-slate-200/60 pointer-events-none">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-[#22C55E]" /> Start
          </span>
          <span className="text-slate-300">·</span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-full bg-[#EF4444]" /> Finish
          </span>
        </div>
      )}

      {/* No route fallback notice */}
      {parsedPoints.length === 0 && !userLocation && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100/90 p-4 text-center">
          <MapPin className="size-8 text-[#94A3B8] mb-1.5 animate-bounce" />
          <p className="text-xs font-black text-[#1E293B]">No route recorded</p>
          <p className="text-[11px] font-semibold text-[#64748B] max-w-xs">
            GPS signal was unavailable during this walk — no route was captured. Enable location
            next time to see your trail here.
          </p>
        </div>
      )}
    </div>
  );
}
