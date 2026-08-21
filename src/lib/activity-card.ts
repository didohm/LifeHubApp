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
  /** Human-readable date label, e.g. "Sat, Aug 15 · 10:30 AM" */
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
  /** Optional bundled logo asset (e.g. "/illustration/LifeHub icon.webp"). */
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
  bgTop: "#0A0F1D",
  bgBottom: "#121124",
  glow: "rgba(252, 82, 0, 0.18)",
  routeBoxFill: "#0D1527",
  routeBoxBorder: "#1E293B",
  panel: "#10182C",
  panelBorder: "#1E293B",
  panelDivider: "rgba(255, 255, 255, 0.08)",
  text: "#FFFFFF",
  label: "#94A3B8",
  labelDim: "#64748B",
  accent: "#FC5200",
  accentLight: "#FF7A00",
  accentGlow: "rgba(252, 82, 0, 0.35)",
  emerald: "#10B981",
  cyan: "#06B6D4",
  purple: "#A855F7",
  orange: "#F97316",
};

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

const PADDING_X = 88;
const ROUTE_BOX = { x: 88, y: 250, width: 904, height: 980 };
const HERO_PANEL = { x: 88, y: 1264, width: 904, height: 184 };
const TILES = {
  cols: 2,
  gap: 16,
  width: (904 - 16) / 2,
  height: 120,
  y: 1476,
  rowGap: 16,
};
const MAX_ROUTE_POINTS = 500;

function defaultDeps(): ActivityCardDeps {
  return {
    createCanvas: (width: number, height: number) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      return canvas;
    },
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
  canvas.width = ACTIVITY_CARD_WIDTH;
  canvas.height = ACTIVITY_CARD_HEIGHT;
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
      // Fallback for WebViews returning null on large canvases
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
  // Rich deep dark gradient background
  const gradient = ctx.createLinearGradient(0, 0, 0, ACTIVITY_CARD_HEIGHT);
  gradient.addColorStop(0, COLORS.bgTop);
  gradient.addColorStop(0.5, "#0D1322");
  gradient.addColorStop(1, COLORS.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, ACTIVITY_CARD_WIDTH, ACTIVITY_CARD_HEIGHT);

  // Soft vibrant radial ambient glow from top-right
  const glow = ctx.createRadialGradient(
    ACTIVITY_CARD_WIDTH * 0.8,
    140,
    0,
    ACTIVITY_CARD_WIDTH * 0.8,
    140,
    700,
  );
  glow.addColorStop(0, COLORS.glow);
  glow.addColorStop(1, "rgba(252, 82, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, ACTIVITY_CARD_WIDTH, 800);
}

async function drawHeader(
  ctx: CanvasRenderingContext2D,
  input: ActivityCardInput,
  deps: ActivityCardDeps,
): Promise<void> {
  // Left: Brand Lockup (Logo + LifeHub Wordmark + Dot)
  let wordmarkX = PADDING_X;
  if (input.logoSrc) {
    try {
      const logo = await deps.loadImage(input.logoSrc);
      if (logo && logo.width > 0 && logo.height > 0) {
        const logoHeight = 64;
        const logoWidth = (logo.width / logo.height) * logoHeight;
        ctx.drawImage(logo as unknown as CanvasImageSource, PADDING_X, 108, logoWidth, logoHeight);
        wordmarkX = PADDING_X + logoWidth + 20;
      }
    } catch {
      /* proceed with text only */
    }
  }

  // Wordmark "LifeHub"
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `800 58px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText("LifeHub", wordmarkX, 158);

  const wordmarkWidth = ctx.measureText("LifeHub").width;
  ctx.beginPath();
  ctx.arc(wordmarkX + wordmarkWidth + 14, 142, 11, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.accent;
  ctx.fill();

  // Right: Badge + Date stacked cleanly with no overlap
  const rightEdge = ACTIVITY_CARD_WIDTH - PADDING_X;

  // Activity Badge (top right)
  drawRightAlignedBadge(ctx, rightEdge, 96, "WALK ACTIVITY");

  // Date (below badge, right-aligned)
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 26px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.label;
  ctx.fillText(input.dateLabel, rightEdge, 192);
}

function drawRightAlignedBadge(
  ctx: CanvasRenderingContext2D,
  rightX: number,
  y: number,
  text: string,
): void {
  ctx.font = `700 22px ${FONT_FAMILY}`;
  const textWidth = ctx.measureText(text).width;
  const paddingX = 22;
  const badgeWidth = textWidth + paddingX * 2;
  const badgeHeight = 44;
  const x = rightX - badgeWidth;

  roundedRectPath(ctx, x, y, badgeWidth, badgeHeight, 22);
  ctx.fillStyle = "rgba(252, 82, 0, 0.15)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(252, 82, 0, 0.4)";
  ctx.stroke();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.accent;
  ctx.fillText(text, x + paddingX, y + badgeHeight / 2);
}

function drawRouteArea(ctx: CanvasRenderingContext2D, points: RoutePointInput[]): void {
  const box = ROUTE_BOX;

  // Card container
  roundedRectPath(ctx, box.x, box.y, box.width, box.height, 36);
  ctx.fillStyle = COLORS.routeBoxFill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.routeBoxBorder;
  ctx.stroke();

  // Subtle telemetry crosshairs in corners
  drawCornerTelemetry(ctx, box.x, box.y, box.width, box.height);

  const projected = projectRoute(points, box.x, box.y, box.width, box.height);
  if (projected && projected.length >= 2) {
    ctx.save();
    roundedRectPath(ctx, box.x, box.y, box.width, box.height, 36);
    ctx.clip();

    // 1. Soft atmospheric glow pass
    ctx.beginPath();
    traceSmoothPath(ctx, projected);
    ctx.strokeStyle = "rgba(252, 82, 0, 0.18)";
    ctx.lineWidth = 42;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // 2. Mid glow pass
    ctx.beginPath();
    traceSmoothPath(ctx, projected);
    ctx.strokeStyle = "rgba(252, 82, 0, 0.4)";
    ctx.lineWidth = 22;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    // 3. Crisp vibrant gradient core line
    ctx.beginPath();
    traceSmoothPath(ctx, projected);
    const lineGradient = ctx.createLinearGradient(box.x, box.y, box.x, box.y + box.height);
    lineGradient.addColorStop(0, COLORS.accent);
    lineGradient.addColorStop(1, COLORS.accentLight);
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 10;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();

    ctx.restore();

    // Start & finish waypoint markers
    drawRouteDot(ctx, projected[0], COLORS.emerald, "START");
    drawRouteDot(ctx, projected[projected.length - 1], COLORS.accent, "FINISH");
  } else {
    drawNoRoutePlaceholder(ctx, box.x, box.y, box.width, box.height);
  }
}

function drawCornerTelemetry(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1.5;

  const m = 32;
  const len = 12;
  // Top-left
  drawCross(ctx, x + m, y + m, len);
  // Top-right
  drawCross(ctx, x + w - m, y + m, len);
  // Bottom-left
  drawCross(ctx, x + m, y + h - m, len);
  // Bottom-right
  drawCross(ctx, x + w - m, y + h - m, len);

  ctx.restore();
}

function drawCross(ctx: CanvasRenderingContext2D, cx: number, cy: number, len: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - len, cy);
  ctx.lineTo(cx + len, cy);
  ctx.moveTo(cx, cy - len);
  ctx.lineTo(cx, cy + len);
  ctx.stroke();
}

function drawRouteDot(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  color: string,
  label?: string,
): void {
  // Outer pulsing glow
  ctx.beginPath();
  ctx.arc(point.x, point.y, 22, 0, Math.PI * 2);
  ctx.fillStyle = color === COLORS.emerald ? "rgba(16, 185, 129, 0.3)" : "rgba(252, 82, 0, 0.3)";
  ctx.fill();

  // Core dot
  ctx.beginPath();
  ctx.arc(point.x, point.y, 12, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = "#FFFFFF";
  ctx.stroke();

  // Small label badge beside dot
  if (label) {
    ctx.font = `800 16px ${FONT_FAMILY}`;
    const textWidth = ctx.measureText(label).width;
    const badgeW = textWidth + 16;
    const badgeH = 26;
    const badgeX = Math.min(
      Math.max(point.x - badgeW / 2, ROUTE_BOX.x + 20),
      ROUTE_BOX.x + ROUTE_BOX.width - badgeW - 20,
    );
    const badgeY = point.y > ROUTE_BOX.y + 100 ? point.y - 42 : point.y + 24;

    roundedRectPath(ctx, badgeX, badgeY, badgeW, badgeH, 13);
    ctx.fillStyle = "rgba(15, 23, 42, 0.85)";
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(label, badgeX + badgeW / 2, badgeY + badgeH / 2);
  }
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

  // Concentric radar rings
  ctx.strokeStyle = "rgba(148, 163, 184, 0.12)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy - 20, 160, 0, Math.PI * 2);
  ctx.arc(cx, cy - 20, 110, 0, Math.PI * 2);
  ctx.arc(cx, cy - 20, 60, 0, Math.PI * 2);
  ctx.stroke();

  // Center indicator
  ctx.beginPath();
  ctx.arc(cx, cy - 20, 12, 0, Math.PI * 2);
  ctx.fillStyle = "#475569";
  ctx.fill();

  ctx.font = `700 32px ${FONT_FAMILY}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = COLORS.text;
  ctx.fillText("Indoor Walk Activity", cx, cy + 130);

  ctx.font = `500 22px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.labelDim;
  ctx.fillText("Steps and cadence tracked via motion sensors", cx, cy + 175);

  ctx.restore();
}

function drawHeroStats(ctx: CanvasRenderingContext2D, input: ActivityCardInput): void {
  const panel = HERO_PANEL;
  roundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, 28);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.stroke();

  const colWidth = panel.width / 3;
  const centers = [panel.x + colWidth * 0.5, panel.x + colWidth * 1.5, panel.x + colWidth * 2.5];

  // Subtle vertical dividers between columns
  ctx.strokeStyle = COLORS.panelDivider;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(panel.x + colWidth, panel.y + 24);
  ctx.lineTo(panel.x + colWidth, panel.y + panel.height - 24);
  ctx.moveTo(panel.x + colWidth * 2, panel.y + 24);
  ctx.lineTo(panel.x + colWidth * 2, panel.y + panel.height - 24);
  ctx.stroke();

  const labelY = panel.y + 46;
  const valueY = panel.y + 136;

  // 1. Distance
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

  // 2. Avg Pace
  drawHeroMetric(
    ctx,
    centers[1],
    labelY,
    valueY,
    "Avg Pace",
    formatPace(input.paceSecondsPerKm),
    "/km",
    COLORS.accentLight,
  );

  // 3. Moving Time
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
  // Label at top
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 20px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.labelDim;
  ctx.fillText(label.toUpperCase(), centerX, labelY);

  // Measure value & unit combined so they are perfectly centered together
  let valueFontSize = 64;
  if (value.length >= 8) {
    valueFontSize = 52; // Wide timestamps like 01:24:15
  } else if (value.length >= 6) {
    valueFontSize = 58;
  }

  const unitFontSize = 26;

  ctx.font = `900 ${valueFontSize}px ${FONT_FAMILY}`;
  const valueWidth = ctx.measureText(value).width;

  ctx.font = `700 ${unitFontSize}px ${FONT_FAMILY}`;
  const unitWidth = unit ? ctx.measureText(unit).width : 0;
  const spacing = unit ? 8 : 0;

  const totalWidth = valueWidth + spacing + unitWidth;
  const startX = centerX - totalWidth / 2;

  // Draw Value
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `900 ${valueFontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = valueColor;
  ctx.fillText(value, startX, valueY);

  // Draw Unit beside value
  if (unit) {
    ctx.font = `700 ${unitFontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = COLORS.label;
    ctx.fillText(unit, startX + valueWidth + spacing, valueY - 4);
  }
}

function drawTiles(ctx: CanvasRenderingContext2D, input: ActivityCardInput): void {
  const tiles: { dot: string; label: string; value: string }[] = [
    { dot: COLORS.orange, label: "Calories", value: `${Math.round(input.calories)} kcal` },
    {
      dot: COLORS.emerald,
      label: "Steps",
      value: `${Math.round(input.steps).toLocaleString("en-US")} steps`,
    },
    {
      dot: COLORS.cyan,
      label: "Avg Speed",
      value: input.avgSpeedKmH != null ? `${input.avgSpeedKmH.toFixed(1)} km/h` : "--",
    },
    {
      dot: COLORS.purple,
      label: "Elevation",
      value: input.elevationGain != null ? `+${Math.round(input.elevationGain)} m` : "--",
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
  roundedRectPath(ctx, x, y, TILES.width, TILES.height, 24);
  ctx.fillStyle = COLORS.panel;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = COLORS.panelBorder;
  ctx.stroke();

  // Color indicator dot
  ctx.beginPath();
  ctx.arc(x + 36, y + 42, 9, 0, Math.PI * 2);
  ctx.fillStyle = dotColor;
  ctx.fill();

  // Title
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.font = `700 20px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.labelDim;
  ctx.fillText(label.toUpperCase(), x + 56, y + 42);

  // Large Value
  ctx.font = `800 38px ${FONT_FAMILY}`;
  ctx.fillStyle = COLORS.text;
  ctx.fillText(value, x + 36, y + 88);
}

function drawFooter(ctx: CanvasRenderingContext2D): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 24px ${FONT_FAMILY}`;
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
