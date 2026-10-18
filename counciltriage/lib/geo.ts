/**
 * Geography helpers for Southampton.
 *
 * Ward boundaries and key roads load from the committed `geo/` folder:
 * `geo/wards.geojson` (ONS May 2026 ward boundaries) and `geo/key_roads.geojson`
 * (the map team's OpenStreetMap overlay of motorway, trunk and primary roads).
 * See `geo/README.md`. Without the ward file, wards fall back to the nearest
 * built-in ward centroid.
 */
import fs from "node:fs";
import path from "node:path";

import { SOUTHAMPTON_CENTRE, isInSouthampton, type LatLon } from "./bounds";

export { SOUTHAMPTON_BOUNDS, SOUTHAMPTON_CENTRE, isInSouthampton, type LatLon } from "./bounds";

const EARTH_RADIUS_M = 6_371_000;

export function haversineMetres(a: LatLon, b: LatLon): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Degree deltas that cover `metres` around Southampton's latitude, for bounding-box prefilters in SQL. */
export function degreeRadius(metres: number, atLat = SOUTHAMPTON_CENTRE.lat) {
  const dLat = metres / 110_540;
  const dLon = metres / (111_320 * Math.cos((atLat * Math.PI) / 180));
  return { dLat, dLon };
}

// Local planar projection (metres), accurate enough at city scale.
function project(p: LatLon, refLat: number) {
  return { x: p.lon * 111_320 * Math.cos((refLat * Math.PI) / 180), y: p.lat * 110_540 };
}

export function distanceToPolylineMetres(p: LatLon, line: LatLon[]): number {
  const P = project(p, p.lat);
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const A = project(line[i], p.lat);
    const B = project(line[i + 1], p.lat);
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2));
    const cx = A.x + t * dx - P.x;
    const cy = A.y + t * dy - P.y;
    best = Math.min(best, Math.sqrt(cx * cx + cy * cy));
  }
  return best;
}

// ---------------------------------------------------------------------------
// Wards
// ---------------------------------------------------------------------------

/**
 * Approximate centres of Southampton's 17 wards (2023 boundaries). Fallback
 * nearest-centre assignment when geo/wards.geojson is missing.
 */
export const WARD_CENTROIDS: { name: string; lat: number; lon: number }[] = [
  { name: "Banister & Polygon", lat: 50.912, lon: -1.41 },
  { name: "Bargate", lat: 50.9, lon: -1.4 },
  { name: "Bassett", lat: 50.94, lon: -1.41 },
  { name: "Bevois", lat: 50.913, lon: -1.392 },
  { name: "Bitterne Park", lat: 50.932, lon: -1.367 },
  { name: "Coxford", lat: 50.936, lon: -1.448 },
  { name: "Freemantle", lat: 50.91, lon: -1.43 },
  { name: "Harefield", lat: 50.928, lon: -1.34 },
  { name: "Millbrook", lat: 50.92, lon: -1.455 },
  { name: "Peartree", lat: 50.905, lon: -1.367 },
  { name: "Portswood", lat: 50.925, lon: -1.393 },
  { name: "Redbridge", lat: 50.915, lon: -1.473 },
  { name: "Shirley", lat: 50.924, lon: -1.428 },
  { name: "Sholing", lat: 50.894, lon: -1.35 },
  { name: "Swaythling", lat: 50.942, lon: -1.378 },
  { name: "Thornhill", lat: 50.912, lon: -1.333 },
  { name: "Woolston", lat: 50.893, lon: -1.378 },
];

type Ring = [number, number][]; // [lon, lat]
type WardPolygon = { name: string; polygons: Ring[][] };
type RoadLine = { name: string; points: LatLon[] };

const GEO_DIR = path.join(process.cwd(), "geo");

function readGeoJson(file: string): { features: { properties?: { name?: string }; geometry: { type: string; coordinates: unknown } }[] } | null {
  try {
    const full = path.join(GEO_DIR, file);
    if (!fs.existsSync(full)) return null;
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return null;
  }
}

const wardPolygons: WardPolygon[] | null = (() => {
  const gj = readGeoJson("wards.geojson");
  if (!gj) return null;
  return gj.features
    .filter((f) => f.geometry && (f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"))
    .map((f) => ({
      name: String(f.properties?.name ?? "Unknown"),
      polygons: (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates) as Ring[][],
    }));
})();

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const WARD_SOURCE: "geojson" | "approximate" = wardPolygons ? "geojson" : "approximate";

export const WARD_NAMES: string[] = wardPolygons
  ? [...new Set(wardPolygons.map((w) => w.name))].sort()
  : WARD_CENTROIDS.map((w) => w.name);

/** Area-weighted centre of each ward's largest polygon, for map labels. */

/** Points on the city boundary (often a road centreline) still go to the nearest ward within this distance. */
const WARD_EDGE_TOLERANCE_M = 25;

export function wardFor(p: LatLon): string | null {
  if (!isInSouthampton(p)) return null;
  if (wardPolygons) {
    for (const w of wardPolygons) {
      for (const poly of w.polygons) {
        const [outer, ...holes] = poly;
        if (pointInRing(p.lon, p.lat, outer) && !holes.some((h) => pointInRing(p.lon, p.lat, h))) return w.name;
      }
    }
    let nearest: string | null = null;
    let nearestD = WARD_EDGE_TOLERANCE_M;
    for (const w of wardPolygons) {
      for (const ring of w.polygons.flat()) {
        const d = distanceToPolylineMetres(p, ring.map(([lon, lat]) => ({ lat, lon })));
        if (d <= nearestD) {
          nearestD = d;
          nearest = w.name;
        }
      }
    }
    return nearest;
  }
  let best: string | null = null;
  let bestD = Infinity;
  for (const w of WARD_CENTROIDS) {
    const d = haversineMetres(p, w);
    if (d < bestD) {
      bestD = d;
      best = w.name;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Major roads
// ---------------------------------------------------------------------------

function readRoads(file: string): RoadLine[] | null {
  const gj = readGeoJson(file);
  if (!gj) return null;
  const lines: RoadLine[] = [];
  for (const f of gj.features) {
    const p = (f.properties ?? {}) as { name?: string; ref?: string };
    const name = String(p.ref && p.name ? `${p.ref} ${p.name}` : (p.name ?? p.ref ?? "Major road"));
    const g = f.geometry;
    const parts = (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []) as [number, number][][];
    for (const part of parts) if (part.length > 1) lines.push({ name, points: part.map(([lon, lat]) => ({ lat, lon })) });
  }
  return lines.length ? lines : null;
}

/**
 * Key roads used for prioritisation: the map team's overlay (motorway, trunk, primary and
 * their slip roads from hampshire-roads.geojson, clipped around Southampton) in geo/key_roads.geojson.
 */
type IndexedRoad = RoadLine & { minLat: number; maxLat: number; minLon: number; maxLon: number };
const keyRoads: IndexedRoad[] = (readRoads("key_roads.geojson") ?? []).map((r) => ({
  ...r,
  minLat: Math.min(...r.points.map((p) => p.lat)),
  maxLat: Math.max(...r.points.map((p) => p.lat)),
  minLon: Math.min(...r.points.map((p) => p.lon)),
  maxLon: Math.max(...r.points.map((p) => p.lon)),
}));

/** Number of key-road lines loaded (0 means geo/key_roads.geojson is missing and road proximity is off). */
export const KEY_ROAD_LINES = keyRoads.length;

/** Distance (metres) within which a report counts as being on a major road. */
export const MAJOR_ROAD_THRESHOLD_M = 40;

/** Nearest key road within `maxMetres` (default 2 km; beyond that its proximity term is ~0). */
export function nearestMajorRoad(p: LatLon, maxMetres = 2000): { name: string; distanceMetres: number } | null {
  const { dLat, dLon } = degreeRadius(maxMetres, p.lat);
  let best: { name: string; distanceMetres: number } | null = null;
  for (const road of keyRoads) {
    if (p.lat < road.minLat - dLat || p.lat > road.maxLat + dLat || p.lon < road.minLon - dLon || p.lon > road.maxLon + dLon) continue;
    const d = distanceToPolylineMetres(p, road.points);
    if (d <= maxMetres && (!best || d < best.distanceMetres)) best = { name: road.name, distanceMetres: Math.round(d) };
  }
  return best;
}
