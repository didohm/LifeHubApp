/**
 * GPS Noise Filtering and Stats Computation for Walk Tracking
 * 
 * Pure functions for processing raw GPS points into clean, accurate metrics.
 * No external API dependencies - all calculations done locally.
 */

export interface GPSPoint {
  lat: number;
  lng: number;
  altitude?: number | null;
  accuracy?: number | null;
  speed?: number | null;
  ts: number; // epoch milliseconds
}

export interface FilteredGPSPoint extends GPSPoint {
  distance?: number; // cumulative distance in meters
}

export interface WalkStats {
  totalDistance: number; // meters
  duration: number; // seconds
  avgPace: number | null; // seconds per km (null if < 0.1km)
  avgSpeed: number | null; // km/h (null if < 0.1km)
  elevationGain: number | null; // meters
  elevationLoss: number | null; // meters
  splits: WalkSplit[];
}

export interface WalkSplit {
  splitNumber: number; // 1-indexed
  distance: number; // meters (actual, may be slightly over 1000m)
  duration: number; // seconds
  pace: number; // seconds per km
  elevationChange: number | null; // meters
}

// Filtering thresholds (Strava-quality)
const MAX_ACCURACY = 15; // meters - drop points with poor accuracy
const MIN_DISPLACEMENT = 3; // meters - eliminate GPS jitter
const MAX_SPEED = 7.0; // m/s (25.2 km/h) - speed gate for walking/running
const MAX_SPEED_JUMP = 3.0; // m/s - reject unrealistic acceleration

/**
 * Haversine formula for distance between two GPS coordinates
 */
export function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Filter GPS noise before computing stats
 * 
 * Removes points with:
 * - Poor accuracy (> 15m)
 * - Minimal displacement (< 3m from previous point)
 * - Unrealistic speed (> 7.0 m/s or sudden jumps > 3.0 m/s)
 */
export function filterGPSPoints(points: GPSPoint[]): FilteredGPSPoint[] {
  if (points.length === 0) return [];

  const filtered: FilteredGPSPoint[] = [];
  let lastValid: GPSPoint | null = null;
  let lastSpeed = 0;

  for (const point of points) {
    // Skip if accuracy is too poor
    if (point.accuracy != null && point.accuracy > MAX_ACCURACY) {
      continue;
    }

    // Always keep the first point
    if (lastValid === null) {
      filtered.push({ ...point });
      lastValid = point;
      lastSpeed = point.speed ?? 0;
      continue;
    }

    // Calculate distance from last valid point
    const distance = haversineDistance(
      lastValid.lat,
      lastValid.lng,
      point.lat,
      point.lng
    );

    // Skip if displacement is too small (GPS jitter)
    if (distance < MIN_DISPLACEMENT) {
      continue;
    }

    // Calculate time delta in seconds
    const timeDelta = (point.ts - lastValid.ts) / 1000;
    if (timeDelta <= 0) continue;

    // Calculate instantaneous speed
    const instantSpeed = distance / timeDelta;

    // Skip if speed is unrealistic for walking/running
    if (instantSpeed > MAX_SPEED) {
      continue;
    }

    // Skip if speed jump is too large (sudden acceleration)
    const speedJump = Math.abs(instantSpeed - lastSpeed);
    if (speedJump > MAX_SPEED_JUMP && filtered.length > 1) {
      continue;
    }

    // Point passes all filters
    filtered.push({ ...point });
    lastValid = point;
    lastSpeed = instantSpeed;
  }

  return filtered;
}

/**
 * Compute comprehensive walk statistics from filtered GPS points
 */
export function computeWalkStats(
  filteredPoints: FilteredGPSPoint[],
  totalDuration: number // seconds (excluding pauses)
): WalkStats {
  if (filteredPoints.length < 2) {
    return {
      totalDistance: 0,
      duration: totalDuration,
      avgPace: null,
      avgSpeed: null,
      elevationGain: null,
      elevationLoss: null,
      splits: [],
    };
  }

  // Compute cumulative distance
  let cumulativeDistance = 0;
  const pointsWithDistance: FilteredGPSPoint[] = [
    { ...filteredPoints[0], distance: 0 },
  ];

  for (let i = 1; i < filteredPoints.length; i++) {
    const prev = filteredPoints[i - 1];
    const curr = filteredPoints[i];
    const segmentDistance = haversineDistance(
      prev.lat,
      prev.lng,
      curr.lat,
      curr.lng
    );
    cumulativeDistance += segmentDistance;
    pointsWithDistance.push({ ...curr, distance: cumulativeDistance });
  }

  // Compute elevation gain/loss with hysteresis noise filtering (>= 2.0m threshold)
  let elevationGain = 0;
  let elevationLoss = 0;
  let hasAltitude = false;
  let lastAnchorAltitude: number | null = null;

  for (let i = 0; i < filteredPoints.length; i++) {
    const curr = filteredPoints[i];

    if (curr.altitude != null && !isNaN(curr.altitude)) {
      hasAltitude = true;
      if (lastAnchorAltitude === null) {
        lastAnchorAltitude = curr.altitude;
      } else {
        const diff = curr.altitude - lastAnchorAltitude;
        if (Math.abs(diff) >= 2.0) {
          if (diff > 0) {
            elevationGain += diff;
          } else {
            elevationLoss += Math.abs(diff);
          }
          lastAnchorAltitude = curr.altitude;
        }
      }
    }
  }

  // Compute average pace and speed
  const distanceKm = cumulativeDistance / 1000;
  const avgPace = distanceKm >= 0.1 ? totalDuration / distanceKm : null; // sec/km
  const avgSpeed = totalDuration > 0 ? (distanceKm / totalDuration) * 3600 : null; // km/h

  // Compute per-kilometer splits
  const splits = computeSplits(pointsWithDistance, totalDuration);

  return {
    totalDistance: cumulativeDistance,
    duration: totalDuration,
    avgPace,
    avgSpeed,
    elevationGain: hasAltitude ? Math.round(elevationGain * 10) / 10 : null,
    elevationLoss: hasAltitude ? Math.round(elevationLoss * 10) / 10 : null,
    splits,
  };
}

/**
 * Compute per-kilometer splits with pace and elevation
 */
function computeSplits(
  pointsWithDistance: FilteredGPSPoint[],
  totalDuration: number
): WalkSplit[] {
  if (pointsWithDistance.length < 2) return [];

  const splits: WalkSplit[] = [];
  const totalDistance = pointsWithDistance[pointsWithDistance.length - 1].distance ?? 0;

  if (totalDistance < 1000) {
    // Less than 1km - no splits
    return [];
  }

  const numSplits = Math.floor(totalDistance / 1000);
  const firstPoint = pointsWithDistance[0];
  const lastPoint = pointsWithDistance[pointsWithDistance.length - 1];
  const totalTimeDelta = (lastPoint.ts - firstPoint.ts) / 1000;

  for (let i = 1; i <= numSplits; i++) {
    const targetDistance = i * 1000;

    // Find the two points that bracket this kilometer mark
    let startIdx = -1;
    let endIdx = -1;

    for (let j = 0; j < pointsWithDistance.length; j++) {
      const pointDist = pointsWithDistance[j].distance ?? 0;
      if (pointDist >= (i - 1) * 1000 && startIdx === -1) {
        startIdx = j;
      }
      if (pointDist >= targetDistance) {
        endIdx = j;
        break;
      }
    }

    if (startIdx === -1 || endIdx === -1 || startIdx >= pointsWithDistance.length || endIdx >= pointsWithDistance.length) {
      continue;
    }

    const startPoint = pointsWithDistance[startIdx];
    const endPoint = pointsWithDistance[endIdx];

    // Compute actual distance and duration for this split
    const splitDistance =
      (endPoint.distance ?? 0) - (startPoint.distance ?? 0);
    const splitTimeDelta = (endPoint.ts - startPoint.ts) / 1000;

    // Estimate split duration, normalizing against total active duration if pauses occurred
    let splitDuration =
      splitTimeDelta > 0
        ? splitTimeDelta
        : totalDuration > 0 && totalDistance > 0
        ? (splitDistance / totalDistance) * totalDuration
        : 0;

    if (totalTimeDelta > totalDuration && totalDuration > 0 && totalTimeDelta > 0 && splitTimeDelta > 0) {
      // Scale out paused gaps proportionally to match active walking duration
      splitDuration = (splitTimeDelta / totalTimeDelta) * totalDuration;
    }

    // Compute pace for this split (sec/km)
    const splitPace =
      splitDistance > 0 ? (splitDuration / splitDistance) * 1000 : 0;

    // Compute elevation change for this split
    let elevationChange: number | null = null;
    if (
      startPoint.altitude != null &&
      endPoint.altitude != null &&
      !isNaN(startPoint.altitude) &&
      !isNaN(endPoint.altitude)
    ) {
      elevationChange = endPoint.altitude - startPoint.altitude;
    }

    splits.push({
      splitNumber: i,
      distance: splitDistance,
      duration: Math.round(splitDuration),
      pace: splitPace,
      elevationChange,
    });
  }

  return splits;
}

/**
 * Encode polyline using simplified algorithm (compatible with MapLibre)
 * Uses Ramer-Douglas-Peucker for simplification before encoding
 */
export function encodePolyline(points: GPSPoint[], epsilon = 0.00001): string {
  if (points.length === 0) return "";

  // Simplify points using RDP algorithm
  const simplified = rdpSimplify(points, epsilon);

  // Encode simplified points
  let encoded = "";
  let prevLat = 0;
  let prevLng = 0;

  for (const point of simplified) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);

    encoded += encodeValue(lat - prevLat);
    encoded += encodeValue(lng - prevLng);

    prevLat = lat;
    prevLng = lng;
  }

  return encoded;
}

/**
 * Decode polyline into GPS points
 */
export function decodePolyline(encoded: string): GPSPoint[] {
  if (!encoded) return [];

  const points: GPSPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    const [dlat, newIndex1] = decodeValue(encoded, index);
    const [dlng, newIndex2] = decodeValue(encoded, newIndex1);

    lat += dlat;
    lng += dlng;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
      ts: 0, // timestamp not encoded
    });

    index = newIndex2;
  }

  return points;
}

function encodeValue(value: number): string {
  let encoded = "";
  let num = value < 0 ? ~(value << 1) : value << 1;

  while (num >= 0x20) {
    encoded += String.fromCharCode((0x20 | (num & 0x1f)) + 63);
    num >>= 5;
  }

  encoded += String.fromCharCode(num + 63);
  return encoded;
}

function decodeValue(encoded: string, index: number): [number, number] {
  let result = 0;
  let shift = 0;
  let byte: number;

  do {
    byte = encoded.charCodeAt(index++) - 63;
    result |= (byte & 0x1f) << shift;
    shift += 5;
  } while (byte >= 0x20);

  const value = result & 1 ? ~(result >> 1) : result >> 1;
  return [value, index];
}

/**
 * Ramer-Douglas-Peucker algorithm for line simplification
 */
function rdpSimplify(points: GPSPoint[], epsilon: number): GPSPoint[] {
  if (points.length < 3) return points;

  // Find the point with maximum distance from line segment
  let maxDistance = 0;
  let maxIndex = 0;

  const start = points[0];
  const end = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = i;
    }
  }

  // If max distance is greater than epsilon, recursively simplify
  if (maxDistance > epsilon) {
    const leftSegment = rdpSimplify(points.slice(0, maxIndex + 1), epsilon);
    const rightSegment = rdpSimplify(points.slice(maxIndex), epsilon);

    // Concatenate results (remove duplicate middle point)
    return leftSegment.slice(0, -1).concat(rightSegment);
  } else {
    // All points can be removed except endpoints
    return [start, end];
  }
}

/**
 * Calculate perpendicular distance from point to line segment
 */
function perpendicularDistance(
  point: GPSPoint,
  lineStart: GPSPoint,
  lineEnd: GPSPoint
): number {
  const x0 = point.lat;
  const y0 = point.lng;
  const x1 = lineStart.lat;
  const y1 = lineStart.lng;
  const x2 = lineEnd.lat;
  const y2 = lineEnd.lng;

  const dx = x2 - x1;
  const dy = y2 - y1;

  const numerator = Math.abs(dy * x0 - dx * y0 + x2 * y1 - y2 * x1);
  const denominator = Math.sqrt(dx * dx + dy * dy);

  return denominator === 0 ? 0 : numerator / denominator;
}

/**
 * Format pace as MM:SS per km
 */
export function formatPace(paceSecondsPerKm: number | null): string {
  if (paceSecondsPerKm === null || isNaN(paceSecondsPerKm) || !isFinite(paceSecondsPerKm)) {
    return "--:--";
  }

  let minutes = Math.floor(paceSecondsPerKm / 60);
  let seconds = Math.round(paceSecondsPerKm % 60);
  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Format duration as HH:MM:SS or MM:SS
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

/**
 * Format distance with appropriate units
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(2)}km`;
}
