/**
 * Builds geo/wards.geojson and geo/key_roads.geojson from open data
 * downloads (see geo/README.md for the exact queries and licences). The committed
 * key_roads.geojson came from the map team's hampshire-roads.geojson overlay; this
 * rebuilds the same schema (name, ref, highway) straight from OpenStreetMap.
 *
 *   npm run build:geo -- <ons-wards.geojson> <overpass-roads.json>
 *
 * Wards: ONS Wards (May 2026) Boundaries UK BFE, filtered to Southampton
 * (E06000045), already WGS84. Roads: OpenStreetMap motorway/trunk/primary
 * ways (and their slip roads) from Overpass `out tags geom`, clipped to the
 * city boundary, merged per road and simplified. Run `npm run retriage`
 * afterwards to refresh stored wards and priorities.
 */
import fs from "node:fs";
import path from "node:path";

const [wardsFile, roadsFile] = process.argv.slice(2);
if (!wardsFile || !roadsFile) {
  console.error("Usage: npm run build:geo -- <ons-wards.geojson> <overpass-roads.json>");
  process.exit(1);
}

const SOUTHAMPTON_LAD = "E06000045";
const OUT_DIR = path.join(process.cwd(), "geo");
/** Douglas-Peucker tolerance for road lines, in metres. */
const SIMPLIFY_M = 1.5;

type Pt = [number, number]; // [lon, lat]
type Ring = Pt[];

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const roundPt = ([lon, lat]: Pt): Pt => [round6(lon), round6(lat)];

// ---------------------------------------------------------------------------
// Wards
// ---------------------------------------------------------------------------

type OnsFeature = {
  properties: { WD26CD: string; WD26NM: string; LAD26CD: string };
  geometry: { type: "Polygon"; coordinates: Ring[] } | { type: "MultiPolygon"; coordinates: Ring[][] };
};

const ons = JSON.parse(fs.readFileSync(wardsFile, "utf8")) as { features: OnsFeature[] };
const onsWards = ons.features.filter((f) => f.properties.LAD26CD === SOUTHAMPTON_LAD);
if (onsWards.length !== 17) throw new Error(`Expected 17 Southampton wards, found ${onsWards.length}`);

const wardFeatures = onsWards
  .map((f) => ({
    type: "Feature",
    properties: { name: f.properties.WD26NM, code: f.properties.WD26CD },
    geometry: {
      type: f.geometry.type,
      coordinates:
        f.geometry.type === "Polygon"
          ? f.geometry.coordinates.map((ring) => ring.map(roundPt))
          : f.geometry.coordinates.map((poly) => poly.map((ring) => ring.map(roundPt))),
    },
  }))
  .sort((a, b) => a.properties.name.localeCompare(b.properties.name));

const cityPolygons: Ring[][] = onsWards.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates));

function pointInRing([lon, lat]: Pt, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const inCity = (p: Pt) => cityPolygons.some(([outer, ...holes]) => pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h)));

// ---------------------------------------------------------------------------
// Major roads
// ---------------------------------------------------------------------------

type OsmWay = { type: "way"; id: number; tags: Record<string, string>; geometry: { lat: number; lon: number }[] };

const overpass = JSON.parse(fs.readFileSync(roadsFile, "utf8")) as { elements: OsmWay[] };
const ways = overpass.elements
  .filter((e) => e.type === "way" && e.geometry?.length >= 2)
  .map((e) => ({ id: e.id, tags: e.tags, points: e.geometry.map((g) => [g.lon, g.lat] as Pt) }));

const CLASS_RANK = ["primary", "trunk", "motorway"];
const roadClass = (highway: string) => highway.replace(/_link$/, "");
const key = ([lon, lat]: Pt) => `${lon.toFixed(7)},${lat.toFixed(7)}`;
const cleanRef = (ref: string | undefined) => ref?.split(";").map((r) => r.trim()).filter(Boolean).join("/") || undefined;

// Unnumbered slip roads and roundabout arms take the number of the road they join.
const refByWay = new Map<number, string | undefined>(ways.map((w) => [w.id, cleanRef(w.tags.ref)]));
for (let pass = 0; pass < 3; pass++) {
  const refsAtNode = new Map<string, Set<string>>();
  for (const w of ways) {
    const ref = refByWay.get(w.id);
    if (!ref) continue;
    for (const p of w.points) {
      const k = key(p);
      if (!refsAtNode.has(k)) refsAtNode.set(k, new Set());
      refsAtNode.get(k)!.add(ref);
    }
  }
  for (const w of ways) {
    if (refByWay.get(w.id) || w.tags.name) continue;
    const ends = [w.points[0], w.points[w.points.length - 1]];
    const refs = [...new Set(ends.flatMap((p) => [...(refsAtNode.get(key(p)) ?? [])]))].sort();
    if (refs.length) refByWay.set(w.id, refs.join("/"));
  }
}

function displayName(w: (typeof ways)[number]): string {
  const ref = refByWay.get(w.id);
  const name = w.tags.name;
  const isLink = w.tags.highway.endsWith("_link");
  if (name) return [ref, name].filter(Boolean).join(" ");
  if (ref) return isLink ? `${ref} slip road` : ref;
  return isLink ? "Slip road" : "Major road";
}

/** Keeps each in-city stretch plus one point either side, so lines reach the boundary. */
function clipToCity(points: Pt[]): Pt[][] {
  const inside = points.map(inCity);
  const keep = points.map((_, i) => inside[i] || inside[i - 1] === true || inside[i + 1] === true);
  const parts: Pt[][] = [];
  let run: Pt[] = [];
  points.forEach((p, i) => {
    if (keep[i]) run.push(p);
    else {
      if (run.length >= 2) parts.push(run);
      run = [];
    }
  });
  if (run.length >= 2) parts.push(run);
  return parts;
}

/** Joins parts that meet end to end (either direction) to cut the number of lines. */
function mergeLines(parts: Pt[][]): Pt[][] {
  const lines = parts.map((p) => [...p]);
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < lines.length; i++) {
      for (let j = 0; j < lines.length; j++) {
        if (i === j) continue;
        const a = lines[i];
        const b = lines[j];
        let joined: Pt[] | null = null;
        if (key(a[a.length - 1]) === key(b[0])) joined = [...a, ...b.slice(1)];
        else if (key(a[a.length - 1]) === key(b[b.length - 1])) joined = [...a, ...b.slice(0, -1).reverse()];
        else if (key(a[0]) === key(b[0])) joined = [...a.slice().reverse(), ...b.slice(1)];
        if (joined) {
          lines[i] = joined;
          lines.splice(j, 1);
          merged = true;
          break outer;
        }
      }
    }
  }
  return lines;
}

function simplify(points: Pt[], toleranceM: number): Pt[] {
  if (points.length <= 2) return points;
  const refLat = points[0][1];
  const xy = points.map(([lon, lat]) => [lon * 111_320 * Math.cos((refLat * Math.PI) / 180), lat * 110_540]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    const [ax, ay] = xy[s];
    const [bx, by] = xy[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = xy[i];
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const d = Math.hypot(ax + t * dx - px, ay + t * dy - py);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > toleranceM) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const groups = new Map<string, { ref?: string; roadClass: string; parts: Pt[][] }>();
for (const w of ways) {
  const parts = clipToCity(w.points);
  if (!parts.length) continue;
  const name = displayName(w);
  const cls = roadClass(w.tags.highway);
  const g = groups.get(name) ?? { ref: refByWay.get(w.id), roadClass: cls, parts: [] };
  if (CLASS_RANK.indexOf(cls) > CLASS_RANK.indexOf(g.roadClass)) g.roadClass = cls;
  g.parts.push(...parts);
  groups.set(name, g);
}

const roadFeatures = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, g]) => {
    const lines = mergeLines(g.parts).map((l) => simplify(l, SIMPLIFY_M).map(roundPt));
    return {
      type: "Feature",
      properties: { name, ref: g.ref ?? null, highway: g.roadClass },
      geometry: lines.length === 1 ? { type: "LineString", coordinates: lines[0] } : { type: "MultiLineString", coordinates: lines },
    };
  });

// ---------------------------------------------------------------------------
// Output (one feature per line keeps diffs readable)
// ---------------------------------------------------------------------------

function writeCollection(file: string, meta: Record<string, string>, features: unknown[]) {
  const head = JSON.stringify({ type: "FeatureCollection", ...meta }).slice(0, -1);
  const body = features.map((f) => JSON.stringify(f)).join(",\n");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const full = path.join(OUT_DIR, file);
  fs.writeFileSync(full, `${head},"features":[\n${body}\n]}\n`);
  console.log(`${file}: ${features.length} features, ${(fs.statSync(full).size / 1024).toFixed(0)} KB`);
}

writeCollection(
  "wards.geojson",
  {
    name: "Southampton wards (May 2026)",
    source: "Office for National Statistics, Wards (May 2026) Boundaries UK BFE",
    licence: "Source: Office for National Statistics licensed under the Open Government Licence v.3.0. Contains OS data © Crown copyright and database right 2026.",
  },
  wardFeatures,
);
writeCollection(
  "key_roads.geojson",
  {
    name: "Southampton key roads (motorway, trunk and primary)",
    source: "OpenStreetMap via Overpass API, clipped to the Southampton City Council boundary",
    licence: "© OpenStreetMap contributors, available under the Open Database Licence (ODbL) 1.0.",
  },
  roadFeatures,
);

console.log("Copy geo/key_roads.geojson to public/geo/key-roads.geojson so the map overlay matches.");
const vertexCount = roadFeatures.reduce((n, f) => n + (f.geometry.type === "LineString" ? f.geometry.coordinates.length : (f.geometry.coordinates as Pt[][]).flat().length), 0);
console.log(`Roads: ${ways.length} OSM ways -> ${roadFeatures.length} named roads, ${vertexCount} vertices`);
console.log(`Road numbers: ${[...new Set(roadFeatures.map((f) => f.properties.ref).filter(Boolean))].sort().join(", ")}`);
