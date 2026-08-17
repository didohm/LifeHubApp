/**
 * Headless verification of the LifeHub activity card renderer.
 *
 * Runs the REAL renderer (src/lib/activity-card.ts) through @napi-rs/canvas
 * and asserts with sharp that the output PNG is exactly 1080×1920, non-blank,
 * contains the accent-colored GPS route inside the route box when a trail is
 * provided, and stays clean when no trail exists. Handles no-route, single
 * point and invalid-point inputs without crashing.
 *
 * Run: npx tsx scripts/verify-activity-card.ts
 * Outputs: %TEMP%/opencode/activity-card-verify/*.png (for manual inspection)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import sharp from "sharp";
import {
  renderActivityCard,
  projectRoute,
  ACTIVITY_CARD_WIDTH,
  ACTIVITY_CARD_HEIGHT,
  type RoutePointInput,
} from "../src/lib/activity-card";

const OUT_DIR = path.join(os.tmpdir(), "opencode", "activity-card-verify");

const ROUTE_BOX = { x: 88, y: 250, width: 904, height: 980 };

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

/** A winding multi-turn trail (neighborhood loop) with realistic lat/lng. */
function makeRoute(): RoutePointInput[] {
  const segments = [
    [0.0012, 0],
    [0.001, 0.0009],
    [0, 0.0008],
    [-0.0011, 0.0005],
    [-0.0009, -0.0006],
    [0.0008, -0.0007],
    [0.0011, 0],
    [0, 0.0009],
    [-0.0012, 0.0006],
  ];
  const points: RoutePointInput[] = [];
  let lat = 24.7136;
  let lng = 46.6753;
  for (const [dLat, dLng] of segments) {
    const steps = 8;
    for (let i = 1; i <= steps; i += 1) {
      lat += dLat / steps;
      lng += dLng / steps;
      points.push({ lat, lng });
    }
  }
  return points;
}

const BASE_INPUT = {
  dateLabel: "Sat, Aug 15 · 10:30 AM",
  distanceMeters: 5320.5,
  durationSeconds: 1864,
  paceSecondsPerKm: 350,
  calories: 312,
  steps: 6840,
  avgSpeedKmH: 10.28,
  elevationGain: 84,
};

interface RegionStats {
  orangePixels: number;
  luminanceVariance: number;
}

async function analyzeRegion(
  buffer: Buffer,
  left: number,
  top: number,
  width: number,
  height: number,
): Promise<RegionStats> {
  const { data } = await sharp(buffer)
    .extract({ left, top, width, height })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let orangePixels = 0;
  let sum = 0;
  let sumSq = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 180 && g < 150 && b < 140) orangePixels += 1;
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    sum += lum;
    sumSq += lum * lum;
  }
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return { orangePixels, luminanceVariance: variance };
}

async function renderAndCheck(
  name: string,
  routePoints: RoutePointInput[],
): Promise<{ blob: Blob; buffer: Buffer }> {
  const deps = {
    createCanvas,
    loadImage: async (src: string) => {
      try {
        return await loadImage(src);
      } catch {
        return null;
      }
    },
  };
  const blob = await renderActivityCard(
    { ...BASE_INPUT, routePoints, logoSrc: "public/illustration/LifeHub icon.webp" },
    deps,
  );
  const buffer = Buffer.from(await blob.arrayBuffer());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), buffer);
  return { blob, buffer };
}

async function main(): Promise<void> {
  console.log("LifeHub activity card verification\n");

  // ── Fixture A: full walk with GPS route ──
  const route = makeRoute();
  const fixtureA = await renderAndCheck("fixture-A-with-route", route);

  check("A: blob is a PNG", fixtureA.blob.type === "image/png", fixtureA.blob.type);
  check("A: file size is sane", fixtureA.buffer.length > 20_000, `${fixtureA.buffer.length} bytes`);

  const metaA = await sharp(fixtureA.buffer).metadata();
  check(
    "A: exactly 1080×1920",
    metaA.width === ACTIVITY_CARD_WIDTH && metaA.height === ACTIVITY_CARD_HEIGHT,
    `${metaA.width}×${metaA.height}`,
  );
  check("A: format is PNG", metaA.format === "png", metaA.format ?? "unknown");

  const statsA = await sharp(fixtureA.buffer).stats();
  const meanA = (statsA.channels[0].mean + statsA.channels[1].mean + statsA.channels[2].mean) / 3;
  check("A: image is not blank", meanA > 3, `mean luminance ${meanA.toFixed(1)}`);

  const regionA = await analyzeRegion(
    fixtureA.buffer,
    ROUTE_BOX.x,
    ROUTE_BOX.y,
    ROUTE_BOX.width,
    ROUTE_BOX.height,
  );
  check(
    "A: route box contains the accent-colored trail",
    regionA.orangePixels > 2000,
    `${regionA.orangePixels} px`,
  );

  // ── Fixture B: same activity, no GPS route ──
  const fixtureB = await renderAndCheck("fixture-B-no-route", []);

  const metaB = await sharp(fixtureB.buffer).metadata();
  check(
    "B: exactly 1080×1920 without a route",
    metaB.width === ACTIVITY_CARD_WIDTH && metaB.height === ACTIVITY_CARD_HEIGHT,
    `${metaB.width}×${metaB.height}`,
  );
  const regionB = await analyzeRegion(
    fixtureB.buffer,
    ROUTE_BOX.x,
    ROUTE_BOX.y,
    ROUTE_BOX.width,
    ROUTE_BOX.height,
  );
  check(
    "B: no accent trail rendered without GPS",
    regionB.orangePixels < 100,
    `${regionB.orangePixels} px`,
  );
  check(
    "B: trail is sharp where present (variance >> flat placeholder)",
    regionA.luminanceVariance > regionB.luminanceVariance * 2,
    `var A=${regionA.luminanceVariance.toFixed(1)} vs B=${regionB.luminanceVariance.toFixed(1)}`,
  );

  // ── Fixture C: single point (start/end only) ──
  const fixtureC = await renderAndCheck("fixture-C-single-point", [{ lat: 24.7136, lng: 46.6753 }]);
  check(
    "C: single point renders without crashing",
    fixtureC.buffer.length > 20_000,
    `${fixtureC.buffer.length} bytes`,
  );

  // ── Fixture D: invalid points are filtered out ──
  const fixtureD = await renderAndCheck("fixture-D-invalid-points", [
    { lat: NaN, lng: 46.6753 },
    { lat: 24.7136, lng: Infinity },
    { lat: 24.7136, lng: 46.6753 },
  ]);
  check(
    "D: invalid points render without crashing",
    fixtureD.buffer.length > 20_000,
    `${fixtureD.buffer.length} bytes`,
  );

  // ── projectRoute unit behavior ──
  check(
    "projectRoute: single point → null",
    projectRoute([{ lat: 1, lng: 2 }], 0, 0, 100, 100) === null,
  );
  check(
    "projectRoute: identical points → null",
    projectRoute(
      [
        { lat: 1, lng: 2 },
        { lat: 1, lng: 2 },
      ],
      0,
      0,
      100,
      100,
    ) === null,
  );
  const vertical = projectRoute(
    [
      { lat: 1, lng: 2 },
      { lat: 2, lng: 2 },
    ],
    0,
    0,
    100,
    100,
  );
  check(
    "projectRoute: vertical line handled (no NaN)",
    vertical !== null &&
      vertical.length === 2 &&
      vertical.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
  );
  const fitted = projectRoute(
    [
      { lat: 24.7136, lng: 46.6753 },
      { lat: 24.7182, lng: 46.6801 },
    ],
    88,
    250,
    904,
    980,
  );
  const scale = fitted ? Math.abs(fitted[1].x - fitted[0].x) / (46.6801 - 46.6753) : 0;
  check(
    "projectRoute: inside box, uniform scale preserved",
    fitted !== null &&
      fitted.every((p) => p.x >= 88 && p.x <= 992 && p.y >= 250 && p.y <= 1230) &&
      Math.abs(scale - Math.abs(fitted[1].y - fitted[0].y) / (24.7182 - 24.7136)) < 0.001,
  );

  console.log(`\nOutputs written to ${OUT_DIR}`);
  if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

main().catch((error) => {
  console.error("Verification crashed:", error);
  process.exit(1);
});
