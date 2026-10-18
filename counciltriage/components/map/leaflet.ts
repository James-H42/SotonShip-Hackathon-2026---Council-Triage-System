/**
 * Shared Leaflet setup for MapPanel and LocationPicker (client only).
 *
 * Leaflet touches `window` when it loads, so it is imported dynamically from
 * effects, never at module top level. The base map is OpenStreetMap tiles,
 * locked to the Southampton city boundary (public/geo/boundary.geojson, the
 * 17 ONS wards dissolved), with the area outside greyed out and the red
 * key-roads overlay (public/geo/key-roads.geojson).
 */
import type * as Leaflet from "leaflet";
import type { LatLon } from "./types";

export type L = typeof Leaflet;

let leafletPromise: Promise<L> | null = null;
export function loadLeaflet(): Promise<L> {
  leafletPromise ??= import("leaflet").then((m) => (m as unknown as { default?: L }).default ?? (m as unknown as L));
  return leafletPromise;
}

type Ring = [number, number][]; // [lon, lat]

export type CityGeo = {
  /** Outer rings (and holes) of the city boundary polygon(s). */
  polygons: Ring[][];
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number };
};

export type KeyRoad = { name: string | null; ref: string | null; highway: string; line: [number, number][] /* [lat, lon] */ };

const json = <T>(url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} returned HTTP ${r.status}`);
    return r.json() as Promise<T>;
  });

type FC = { features: { properties: Record<string, string | null>; geometry: { type: string; coordinates: unknown } }[] };

let boundaryPromise: Promise<CityGeo> | null = null;
export function loadBoundary(): Promise<CityGeo> {
  boundaryPromise ??= json<FC>("/geo/boundary.geojson").then((fc) => {
    const polygons: Ring[][] = [];
    for (const f of fc.features) {
      const g = f.geometry;
      if (g.type === "Polygon") polygons.push(g.coordinates as Ring[]);
      else if (g.type === "MultiPolygon") polygons.push(...(g.coordinates as Ring[][]));
    }
    const pts = polygons.flatMap((p) => p[0]);
    const lons = pts.map((c) => c[0]);
    const lats = pts.map((c) => c[1]);
    return {
      polygons,
      bbox: { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) },
    };
  });
  boundaryPromise.catch(() => (boundaryPromise = null));
  return boundaryPromise;
}

let roadsPromise: Promise<KeyRoad[]> | null = null;
export function loadKeyRoads(): Promise<KeyRoad[]> {
  roadsPromise ??= json<FC>("/geo/key-roads.geojson").then((fc) => {
    const roads: KeyRoad[] = [];
    for (const f of fc.features) {
      const g = f.geometry;
      const parts = (g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : []) as [number, number][][];
      for (const part of parts) {
        if (part.length < 2) continue;
        roads.push({ name: f.properties.name, ref: f.properties.ref, highway: String(f.properties.highway), line: part.map(([lon, lat]) => [lat, lon]) });
      }
    }
    return roads;
  });
  roadsPromise.catch(() => (roadsPromise = null));
  return roadsPromise;
}

function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inCity(city: CityGeo, p: LatLon): boolean {
  return city.polygons.some(([outer, ...holes]) => pointInRing(p.lon, p.lat, outer) && !holes.some((h) => pointInRing(p.lon, p.lat, h)));
}

export const OUTSIDE_CITY_MESSAGE =
  "That spot is outside Southampton City Council's area, so we can't take a report for it here. Choose a point inside the dashed city boundary (the shaded area is outside it).";

export const BRAND_NAVY = "#00193c";
export const ROAD_RED = "#dc2626";

/** Base map: tiles, boundary lock, grey mask outside the city and the key-roads overlay. */
export function createBaseMap(L: L, el: HTMLElement, city: CityGeo, opts: { scrollWheelZoom?: boolean } = {}) {
  const { bbox } = city;
  const cityBounds = L.latLngBounds([bbox.minLat, bbox.minLon], [bbox.maxLat, bbox.maxLon]);
  const maxBounds = cityBounds.pad(0.12);
  const map = L.map(el, {
    preferCanvas: true,
    maxBounds,
    maxBoundsViscosity: 1,
    zoomSnap: 0.5,
    scrollWheelZoom: opts.scrollWheelZoom ?? true,
  });
  map.fitBounds(cityBounds, { padding: [8, 8] });
  map.setMinZoom(Math.max(10, map.getBoundsZoom(maxBounds) - 0.5));

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

  // Mask and roads sit below the overlay pane (z 400), where pins and routes draw.
  map.createPane("cityMask").style.zIndex = "350";
  map.createPane("keyRoads").style.zIndex = "360";
  for (const pane of ["cityMask", "keyRoads"]) map.getPane(pane)!.style.pointerEvents = "none";

  // Grey out everything outside the boundary: one big ring with the city as holes.
  const toLatLngs = (ring: Ring) => ring.map(([lon, lat]) => [lat, lon] as [number, number]);
  const pad = 1;
  const world: [number, number][] = [
    [bbox.maxLat + pad, bbox.minLon - pad],
    [bbox.maxLat + pad, bbox.maxLon + pad],
    [bbox.minLat - pad, bbox.maxLon + pad],
    [bbox.minLat - pad, bbox.minLon - pad],
  ];
  const svg = L.svg({ padding: 0.5, pane: "cityMask" });
  L.polygon([world, ...city.polygons.map((p) => toLatLngs(p[0]))], {
    renderer: svg,
    stroke: false,
    fillColor: "#334155",
    fillOpacity: 0.32,
    interactive: false,
  }).addTo(map);
  L.polygon(
    city.polygons.map((p) => toLatLngs(p[0])),
    { renderer: svg, color: BRAND_NAVY, weight: 2, opacity: 0.7, dashArray: "6 4", fill: false, interactive: false },
  ).addTo(map);

  const roadsLayer = L.layerGroup().addTo(map);
  let disposed = false;
  map.on("unload", () => (disposed = true));
  loadKeyRoads()
    .then((roads) => {
      if (disposed) return;
      // One multi-line layer on its own canvas: cheap to draw ~2,000 road pieces.
      L.polyline(
        roads.map((r) => r.line),
        { renderer: L.canvas({ padding: 0.5, pane: "keyRoads" }), color: ROAD_RED, weight: 4, opacity: 0.55, interactive: false },
      ).addTo(roadsLayer);
    })
    .catch((err) => console.warn("Key roads overlay could not load", err));

  return { map, roadsLayer, cityBounds };
}
