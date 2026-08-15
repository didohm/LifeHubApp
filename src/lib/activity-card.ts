/**
 * LifeHub Activity Card — offscreen HTML5 Canvas renderer
 *
 * Draws a 1080×1920 (9:16) PNG suitable for Instagram Stories showing a
 * completed Walk/Run activity: GPS route silhouette, hero stats and the
 * LifeHub branding. Pure rendering — no React, no DOM access at module
 * scope, so the exact same code runs in the app WebView and in the
 * headless Node verification script (scripts/verify-activity-card.ts).
 *
 * No map tiles: the route is the actual recorded lat/lng trail normalized
 * into a dedicated area of the canvas, preserving its aspect ratio.
 */

import { formatPace, formatDuration } from "@/lib/walk-gps-utils";

export const ACTIVITY_CARD_WIDTH = 1080;
export const ACTIVITY_CARD_HEIGHT = 1920;

export interface RoutePointInput {
  lat: number;
  lng: number;
}

export interface ActivityCardInput {
  /** Human-readable date label, e.g. "Sat, Aug 15 · 10:30" */
  dateLabel: string;
  distanceMeters: number;
  durationSeconds: number;
  /** Seconds per km (null when unknown) */
  paceSecondsPerKm: number | null;
  calories: number;
  steps: number;
  avgSpeedKmH: number | null;
  /** Meters gained (null when unknown) */
  elevationGain: number | null;
  /** Raw route trail (lat/lng). Invalid entries are filtered out. */
  routePoints: RoutePointInput[];
  /** Optional bundled logo asset (e.g. "/illustration/LifeHub icon.png"). */
  logoSrc?: string | null;
}

/** Minimal canvas surface — satisfied by HTMLCanvasElement and @napi-rs/canvas. */
export interface CanvasLike {
  width: number;
  height: number;
  getContext(contextId: "2d"): CanvasRenderingContext2D | null;
  toBlob(callback: (blob: Blob | null) => void, type?: string, quality?: number): void;
}

export interface ImageLike {
  width: number;
  height: number;
}

export interface ActivityCardDeps {
  createCanvas: (width: number, height: number) => CanvasLike;
  loadImage: (src: string) => Promise<ImageLike | null>;
}

const COLORS = {
  bgTop: "#0F172A",
  bgBottom: "#171331",
  glow: "rgba(252, 82, 0, 0.16)",
  routeBoxFill: "#0E1626",
  routeBoxBorder: "#223049",
  panel: "#111A31",
  panelBorder: "#243049",
  text: "#FFFFFF",
  label: "#94A3B8",
  labelDim: "#64748B",
  accent: "#FC5200",
  accentLight: "#FF7A00",
  emerald: "#10B981",
  cyan: "#06B6D4",
  purple: "#A855F7",
  orange: "#F97316",
};

const PADDING_X = 88;
const ROUTE_BOX = { x: 88, y: 250, width: 904, height: 980 };
const HERO_PANEL = { x: 88, y: 1270, width: 904, height: 190 };
const TILES = {
  cols: 2,
  gap: 16,
  width: (904 - 16) / 2,
  height: 112,
  y: 1490,
  rowGap: 16,
};
const MAX_ROUTE_POINTS = 500;

function defaultDeps(): ActivityCardDeps {
  return {
    createCanvas: (width, height) => document.createElement("canvas"),
    loadImage: (src) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
      }),
  };
}

/**
 * Render the activity card and return it as a PNG Blob.
 * `deps` is injectable for headless verification (Node).
 */
export async function renderActivityCard(
  input: ActivityCardInput,
  deps?: ActivityCardDeps,
): Promise<Blob> {
  const resolved = deps ?? defaultDeps();
  const canvas = resolved.createCanvas(ACTIVITY_CARD_WIDTH, ACTIVITY_CARD_HEIGHT);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  drawBackground(ctx);
  await drawHeader(ctx, input, resolved);
  drawRouteArea(ctx, input.routePoints);
  drawHeroStats(ctx, input);
  drawTiles(ctx, input);
  drawFooter(ctx);

  return canvasToBlob(canvas);
}

/** Resolve `canvas.toBlob` for both browser (callback) and @napi-rs/canvas (Promise). */
export function canvasToBlob(canvas: CanvasLike): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (blob: Blob | null) => {
      if (settled) return;
      if (blob) {
        settled = true;
        resolve(blob);
        return;
      }
      // Some Android WebViews return null from toBlob() on large canvases —
      // encode through toDataURL() as a fallback instead of failing outright.
      try {
        const dataUrl = (canvas as unknown as { toDataURL?: () => string }).toDataURL?.();
        if (!dataUrl || !dataUrl.startsWith("data:image/png")) {
          settled = true;
          reject(new Error("Canvas.toBlob() returned null"));
          return;
        }
        const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        settled = true;
        resolve(new Blob([bytes], { type: "image/png" }));
      } catch (error) {
        settled = true;
        reject(error instanceof Error ? error : new Error("Canvas.toBlob() failed"));
      }
    };
    let result: unknown;
    try {
      result = canvas.toBlob(done, "image/png");
    } catch (error) {
      reject(error instanceof Error ? error : new Error("Canvas.toBlob() failed"));
      return;
    }
    if (result && typeof (result as Promise<Blob>).then === "function") {
      (result as Promise<Blob>).then(done, (error) => {
        if (!settled) {
          settled = true;
          reject(error instanceof Error ? error : new Error("Canvas.toBlob() failed"));
        }
      });
    }
  });
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, ACTIVITY_CARD_HEIGHT);
  gradient.addColorStop(0, COLORS.bgTop);
  gradient.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ACTIVITY_CARD_WIDTH, ACTIVITY_CARD_HEIGHT);

  // Soft accent glow bleeding from the top edge
  const glow = ctx.createRadialGradient(
    ACTIVITY_CARD_WIDTH * 0.85,
    90,
    0,
    ACTIVITY_CARD_WIDTH * 0.85,
    90,
    640,
  );
  glow.addColorStop(0, COLORS.glow);
  glow.addColorStop(1, "rgba(252, 82, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ACTIVITY_CARD_WIDTH, 640);
}

async function drawHeader(
  ctx: CanvasRenderingContext2D,
  input: ActivityCardInput,
  deps: ActivityCardDeps,
): Promise<void> {
  // Activity badge (top-left)
  drawBadge(ctx, PADDING_X, 88, "WALK ACTIVITY");

  // Date (top-right)
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = "600 30px sans-serif";
  ctx.fillStyle = COLORS.label;
  ctx.fillText(input.dateLabel, ACTIVITY_CARD_WIDTH - PADDING_X, 116);

  // Wordmark + accent dot
  ctx.textAlign = "left";
  ctx.font = "800 68px sans-serif";
  ctx.fillStyle = COLORS.text;
  const wordmark = "LifeHub";
  ctx.fillText(wordmark, PADDING_X, 196);
  const wordmarkWidth = ctx.measureText(wordmark).width;
  ctx.beginPath();
  ctx.arc(PADDING_X + wordmarkWidth + 18, 177, 14, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();

  // Bundled logo (top-right of the wordmark row) — best effort only
  if (input.logoSrc) {
    try {
      const logo = await deps.loadImage(input.logoSrc);
      if (logo && logo.width > 0 && logo.height > 0) {
        const logoHeight = 78;
        const logoWidth = (logo.width / logo.height) * logoHeight;
        const logoX = ACTIVITY_CARD_WIDTH - PADDING_X - logoWidth;
        ctx.drawImage(logo as unknown as CanvasImageSource, logoX, 118, logoWidth, logoHeight);
      }
    } catch {
      /* wordmark only — the card stays readable without the logo */
    }
  }
}

function drawBadge(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.font = "700 26px sans-serif";
  const width = ctx.measureText(text).width + 52;
  const height = 52;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  roundedRectPath(ctx, x, y, width, height, 26);
  ctx.fillStyle = "rgba(252, 82, 0, 0.14)";
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(252, 82, 0, 0.45)";
  ctx.stroke();
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(text, x + 26, y + height / 2);
}

function drawRouteArea(ctx: CanvasRenderingContext2D, points: RoutePointInput[]): void {
  const box = ROUTE_BOX;
  roundedRectPath(ctx, box.x, box.y, box.width, box.height, 44);
  ctx.fillStyle = COLORS.routeBoxFill;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.routeBoxBorder;
  ctx.stroke();

  const projected = projectRoute(points, box.x, box.y, box.width, box.height);
  if (projected && projected.length >= 2) {
    // Clip the trail inside the rounded box
    ctx.save();
    roundedRectPath(ctx, box.x, box.y, box.width, box.height, 44);
    ctx.clip();

    // Soft glow pass
    ctx.beginPath();
    traceSmoothPath(ctx, projected);
    ctx.strokeStyle = "rgba(252, 82, 0, 0.16)";
    ctx.lineWidth = 46;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // Main crisp gradient line
    ctx.beginPath();
    traceSmoothPath(ctx, projected);
    const lineGradient = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.height);
    lineGradient.addColorStop(0, COLORS.accent);
    lineGradient.addColorStop(1, COLORS.accentLight);
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 18;
    ctx.stroke();

    ctx.restore();

    // Start / finish markers
    drawRouteDot(ctx, projected[0], COLORS.emerald);
    drawRouteDot(ctx, projected[projected.length - 1], COLORS.accentLight);
  } else {
    drawNoRoutePlaceholder(ctx, box.x, box.y, box.width, box.height);
  }
}

function drawRouteDot(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string,
): void {
  ctx.beginPath();
  ctx.arc(point.x, point.y, 22, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();
}

function drawNoRoutePlaceholder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const cx = x + width / 2;
  const cy = y + height / 2;
  ctx.save();
  ctx.setLineDash([18, 18]);
  ctx.lineWidth = 5;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.35)";
  ctx.beginPath();
  ctx.arc(cx, cy, 150, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = "700 40px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.label;
  ctx.fillText("No GPS route recorded", cx, cy + 44);
  ctx.restore();
}

function drawHeroStats(ctx: CanvasRenderingContext2D, input: ActivityCardInput): void {
  const panel = HERO_PANEL;
  roundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, 40);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.stroke();

  const centers = [
    panel.x + (panel.width * 1) / 6,
    panel.x + (panel.width * 3) / 6,
    panel.x + (panel.width * 5) / 6,
  ];
  const labelY = panel.y + 52;
  const valueY = panel.y + 150;

  drawHeroMetric(
    ctx,
    centers[0],
    labelY,
    valueY,
    "Distance",
    (input.distanceMeters / 1000).toFixed(2),
    "km",
    COLORS.text,
  );
  drawHeroMetric(
    ctx,
    centers[1],
    labelY,
    valueY,
    "Avg Pace",
    formatPace(input.paceSecondsPerKm),
    "/km",
    COLORS.accent,
  );
  drawHeroMetric(
    ctx,
    centers[2],
    labelY,
    valueY,
    "Moving Time",
    formatDuration(input.durationSeconds),
    "",
    COLORS.text,
  );
}

function drawHeroMetric(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  labelY: number,
  valueY: number,
  label: string,
  value: string,
  unit: string,
  valueColor: string,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 26px sans-serif";
  ctx.fillStyle = COLORS.labelDim;
  ctx.fillText(label.toUpperCase(), centerX, labelY);

  ctx.font = "900 88px sans-serif";
  ctx.fillStyle = valueColor;
  const valueWidth = ctx.measureText(value).width;
  ctx.fillText(value, centerX - 20, valueY);
  if (unit) {
    ctx.font = "700 38px sans-serif";
    ctx.fillStyle = COLORS.label;
    ctx.fillText(unit, centerX + valueWidth / 2 + 18, valueY - 8);
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, input: ActivityCardInput): void {
  const tiles: { dot: string; label: string; value: string }[] = [
    { dot: COLORS.orange, label: "Calories", value: `${Math.round(input.calories)} kcal` },
    { dot: COLORS.emerald, label: "Steps", value: Math.round(input.steps).toLocaleString("en-US") },
    {
      dot: COLORS.cyan,
      label: "Avg Speed",
      value: input.avgSpeedKmH != null ? `${input.avgSpeedKmH.toFixed(1)} km/h` : "--",
    },
    {
      dot: COLORS.purple,
      label: "Elevation",
      value: input.elevationGain != null ? `+${Math.round(input.elevationGain)}m` : "--",
    },
  ];

  tiles.forEach((tile, index) => {
    const col = index % TILES.cols;
    const row = Math.floor(index / TILES.cols);
    const x = PADDING_X + col * (TILES.width + TILES.gap);
    const y = TILES.y + row * (TILES.height + TILES.rowGap);
    drawTile(ctx, x, y, tile.dot, tile.label, tile.value);
  });
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dotColor: string,
  label: string,
  value: string,
): void {
  roundedRectPath(ctx, x, y, TILES.width, TILES.height, 28);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x + 42, y + TILES.height / 2, 12, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = "700 26px sans-serif";
  ctx.fillStyle = COLORS.labelDim;
  ctx.fillText(label.toUpperCase(), x + 70, y + 38);

  ctx.font = "800 46px sans-serif";
  ctx.fillStyle = COLORS.text;
  ctx.fillText(value, x + 70, y + 80);
}

function drawFooter(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "700 30px sans-serif";
  ctx.fillStyle = COLORS.labelDim;
  ctx.fillText("Tracked with LifeHub", ACTIVITY_CARD_WIDTH / 2, 1856);
}

/* ─────────────────────────── helpers ─────────────────────────── */

function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

/**
 * Normalize the GPS trail into the target box, preserving aspect ratio and
 * keeping a padding margin. Returns projected coordinates or null when there
 * is no valid 2+ point trail (single point, all-identical, invalid input).
 */
export function projectRoute(
  points: RoutePointInput[],
  boxX: number,
  boxY: number,
  boxWidth: number,
  boxHeight: number,
): { x: number; y: number }[] | null {
  const valid = points.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if (valid.length < 2) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of valid) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const spanLat = maxLat - minLat;
  const spanLng = maxLng - minLng;
  if (spanLat === 0 && spanLng === 0) return null;

  const pad = Math.min(56, boxWidth * 0.1, boxHeight * 0.1);
  if (pad <= 0) return null;
  const innerWidth = boxWidth - pad * 2;
  const innerHeight = boxHeight - pad * 2;
  const scaleLat = spanLat > 0 ? innerHeight / spanLat : Infinity;
  const scaleLng = spanLng > 0 ? innerWidth / spanLng : Infinity;
  const scale = Math.min(scaleLat, scaleLng);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const offsetX = boxX + pad + (innerWidth - spanLng * scale) / 2;
  const offsetY = boxY + pad + (innerHeight - spanLat * scale) / 2;

  let projected = valid.map((p) => ({
    x: offsetX + (p.lng - minLng) * scale,
    y: offsetY + (maxLat - p.lat) * scale,
  }));

  // Cap path complexity for very long trails (rendering only)
  if (projected.length > MAX_ROUTE_POINTS) {
    const step = Math.ceil(projected.length / MAX_ROUTE_POINTS);
    const decimated: { x: number; y: number }[] = [];
    for (let i = 0; i < projected.length; i += step) decimated.push(projected[i]);
    const lastPoint = projected[projected.length - 1];
    if (decimated[decimated.length - 1] !== lastPoint) decimated.push(lastPoint);
    projected = decimated;
  }

  return projected;
}

/** Smooth polyline through the projected points (quadratic midpoint smoothing). */
export function traceSmoothPath(
  ctx: CanvasRenderingContext2D,
  points: { x: number; y: number }[],
): void {
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length < 3) {
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    ctx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }
  const lastPoint = points[points.length - 1];
  ctx.lineTo(lastPoint.x, lastPoint.y);
}
