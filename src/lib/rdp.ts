/**
 * Ramer-Douglas-Peucker (RDP) algorithm for polyline simplification.
 * Reduces the number of points in a GPS curve while preserving significant shape features.
 */

export interface LatLngPoint {
  lat: number;
  lng: number;
  [key: string]: any;
}

/**
 * Calculates perpendicular distance from point P to line segment defined by A and B.
 */
function perpendicularDistance(
  point: LatLngPoint,
  lineStart: LatLngPoint,
  lineEnd: LatLngPoint,
): number {
  const x = point.lng;
  const y = point.lat;
  const x1 = lineStart.lng;
  const y1 = lineStart.lat;
  const x2 = lineEnd.lng;
  const y2 = lineEnd.lat;

  const dx = x2 - x1;
  const dy = y2 - y1;

  if (dx === 0 && dy === 0) {
    return Math.hypot(x - x1, y - y1);
  }

  const rawNumerator = dy * x - dx * y + x2 * y1 - y2 * x1;
  const num = Math.abs(rawNumerator);
  const den = Math.hypot(dx, dy);

  return num / den;
}

/**
 * Simplifies a series of lat/lng coordinates using Ramer-Douglas-Peucker algorithm.
 * @param points Array of GPS points
 * @param epsilon Tolerance threshold in degrees (0.00003 ≈ 3-5 meters).
 */
export function ramerDouglasPeucker<T extends LatLngPoint>(points: T[], epsilon = 0.00003): T[] {
  if (points.length <= 2) return points;

  let maxDistance = 0;
  let index = 0;
  const lastIndex = points.length - 1;

  for (let i = 1; i < lastIndex; i++) {
    const distance = perpendicularDistance(points[i], points[0], points[lastIndex]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }

  if (maxDistance > epsilon) {
    const leftRecursive = ramerDouglasPeucker(points.slice(0, index + 1), epsilon);
    const rightRecursive = ramerDouglasPeucker(points.slice(index), epsilon);

    return [...leftRecursive.slice(0, leftRecursive.length - 1), ...rightRecursive];
  } else {
    return [points[0], points[lastIndex]];
  }
}
