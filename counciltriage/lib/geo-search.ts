/**
 * Location search helpers shared by the resident location picker and the
 * /api/geo/* routes. Pure functions only (no Node APIs), so the client can
 * classify a query before choosing which route to call.
 */

export type SearchKind = "postcode" | "outcode" | "what3words" | "coords" | "place";

export type GeoResult = {
  /** Main line shown to the resident, e.g. "SO14 7LY" or "Above Bar Street". */
  label: string;
  /** Secondary line, e.g. the full address. */
  detail?: string;
  lat: number;
  lon: number;
  source: SearchKind;
};

export type SearchResponse = { results: GeoResult[]; message?: string; error?: string };

export type ReverseResponse = {
  inSouthampton: boolean;
  ward: string | null;
  postcode: { postcode: string; distanceMetres: number } | null;
  address: string | null;
  majorRoad: { name: string; distanceMetres: number; near: boolean } | null;
};

// Full UK postcode, e.g. "SO14 7LY", "so147ly". Outward code alone, e.g. "SO14".
const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/i;
const OUTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?$/i;
// what3words: three words separated by dots, optionally prefixed with ///.
const W3W_RE = /^(?:\/{3})?\s*([\p{L}\p{M}]+)\.([\p{L}\p{M}]+)\.([\p{L}\p{M}]+)$/u;

export function normalisePostcode(q: string): string | null {
  const m = q.trim().match(POSTCODE_RE);
  return m ? `${m[1].toUpperCase()} ${m[2].toUpperCase()}` : null;
}

export function parseWhat3words(q: string): string | null {
  const m = q.trim().match(W3W_RE);
  return m ? `${m[1]}.${m[2]}.${m[3]}`.toLowerCase() : null;
}

// Latitude and longitude: "50.9097, -1.4044", "50.9097 -1.4044" or "50.9097N 1.4044W".
const COORDS_RE = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i;

/** Parse a latitude/longitude pair. Accepts either order (UK latitudes are about 50, longitudes about -1). */
export function parseCoords(q: string): { lat: number; lon: number } | null {
  const m = q.trim().match(COORDS_RE);
  if (!m) return null;
  let a = Number(m[1]);
  let b = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") a = -Math.abs(a);
  if (m[4]?.toUpperCase() === "W") b = -Math.abs(b);
  if (Math.abs(a) <= 10 && Math.abs(b) > 10) [a, b] = [b, a];
  if (Math.abs(a) > 90 || Math.abs(b) > 180) return null;
  return { lat: Math.round(a * 1e6) / 1e6, lon: Math.round(b * 1e6) / 1e6 };
}

export function classifyQuery(q: string): { kind: SearchKind; value: string } | null {
  const text = q.trim();
  if (text.length < 2) return null;
  const postcode = normalisePostcode(text);
  if (postcode) return { kind: "postcode", value: postcode };
  if (OUTCODE_RE.test(text)) return { kind: "outcode", value: text.toUpperCase() };
  const coords = parseCoords(text);
  if (coords) return { kind: "coords", value: `${coords.lat},${coords.lon}` };
  const words = parseWhat3words(text);
  if (words) return { kind: "what3words", value: words };
  if (text.startsWith("///")) return { kind: "what3words", value: text.slice(3) };
  return { kind: "place", value: text.slice(0, 120) };
}

