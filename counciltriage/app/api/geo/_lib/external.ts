/**
 * Server-side calls to the free geocoding services used by the location picker.
 * Successful answers (including "not found") are cached with `use cache`;
 * network errors throw so they are never cached.
 */
import { cacheLife } from "next/cache";
import { haversineMetres, wardFor, type LatLon } from "@/lib/geo";
import type { GeoResult } from "@/lib/geo-search";

const USER_AGENT = "StreetTriage/0.1 (Southampton City Council hackathon prototype; map search)";
const TIMEOUT_MS = 6000;

/** Viewbox for Nominatim searches: a little wider than the city boundary. */
const NOMINATIM_VIEWBOX = "-1.50,50.97,-1.30,50.86";

/** Inside the city boundary (ward polygons, 25 m edge tolerance). */
export const insideCity = (p: LatLon) => wardFor(p) !== null;

async function getJson<T>(url: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const res = await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) throw new Error(`${new URL(url).host} returned HTTP ${res.status}`);
  return { status: res.status, body: (await res.json()) as T };
}

// ---------------------------------------------------------------------------
// postcodes.io (free, no key, Open Government Licence data)
// ---------------------------------------------------------------------------

type PostcodeResult = {
  postcode: string;
  latitude: number | null;
  longitude: number | null;
  admin_district: string | null;
  admin_ward: string | null;
  distance?: number;
};

/** Full postcode lookup. Accepted only when it is in Southampton (district) or its centre is inside the boundary. */
export async function lookupPostcode(postcode: string): Promise<{ result: GeoResult | null; reason?: string }> {
  "use cache";
  cacheLife("days");
  const { body } = await getJson<{ result: PostcodeResult }>(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
  const r = body?.result;
  if (!r) return { result: null, reason: `We could not find the postcode ${postcode}. Check it and try again.` };
  if (r.latitude == null || r.longitude == null) return { result: null, reason: `${r.postcode} has no map location. Try a street name instead.` };
  const p = { lat: r.latitude, lon: r.longitude };
  if (r.admin_district !== "Southampton" && !insideCity(p)) {
    return { result: null, reason: `${r.postcode} is in ${r.admin_district ?? "another area"}, outside Southampton City Council's area.` };
  }
  return {
    result: { label: r.postcode, detail: [r.admin_ward, r.admin_district].filter(Boolean).join(", "), lat: p.lat, lon: p.lon, source: "postcode" },
  };
}

/** Outward code (e.g. SO14): its centre, if that is inside the city. */
export async function lookupOutcode(outcode: string): Promise<{ result: GeoResult | null; reason?: string }> {
  "use cache";
  cacheLife("days");
  const { body } = await getJson<{ result: { outcode: string; latitude: number; longitude: number; admin_district: string[] } }>(
    `https://api.postcodes.io/outcodes/${encodeURIComponent(outcode)}`,
  );
  const r = body?.result;
  if (!r || r.latitude == null) return { result: null, reason: `We could not find the postcode area ${outcode}.` };
  const p = { lat: Math.round(r.latitude * 1e6) / 1e6, lon: Math.round(r.longitude * 1e6) / 1e6 };
  if (!r.admin_district?.includes("Southampton") || !insideCity(p)) {
    return { result: null, reason: `${r.outcode} is not a Southampton postcode area.` };
  }
  return {
    result: { label: r.outcode, detail: "Centre of the postcode area. Add the full postcode or move the pin to the exact spot.", lat: p.lat, lon: p.lon, source: "outcode" },
  };
}

/** Nearest postcode to a point (within 250 m). */
export async function nearestPostcode(lat: number, lon: number): Promise<{ postcode: string; distanceMetres: number } | null> {
  "use cache";
  cacheLife("days");
  const { body } = await getJson<{ result: PostcodeResult[] | null }>(
    `https://api.postcodes.io/postcodes?lon=${lon}&lat=${lat}&radius=250&limit=1`,
  );
  const r = body?.result?.[0];
  if (!r) return null;
  const distance = r.distance ?? (r.latitude != null && r.longitude != null ? haversineMetres({ lat, lon }, { lat: r.latitude, lon: r.longitude }) : 0);
  return { postcode: r.postcode, distanceMetres: Math.round(distance) };
}

// ---------------------------------------------------------------------------
// Nominatim (OpenStreetMap). Usage policy: max 1 request/second, real User-Agent, cache results.
// ---------------------------------------------------------------------------

let lastNominatim = 0;
async function nominatimSlot() {
  const wait = lastNominatim + 1100 - Date.now();
  lastNominatim = Math.max(Date.now(), lastNominatim + 1100);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

type NominatimPlace = {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
};

function shortAddress(place: NominatimPlace): string {
  const a = place.address ?? {};
  const street = [a.house_number, a.road ?? a.pedestrian ?? a.footway ?? a.path].filter(Boolean).join(" ");
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district;
  return [place.name && place.name !== a.road ? place.name : null, street || null, area].filter(Boolean).join(", ") || place.display_name;
}

/** Street or place name search, bounded to the city. Returns up to 5 matches inside the boundary. */
export async function searchPlaces(query: string): Promise<GeoResult[]> {
  "use cache";
  cacheLife("hours");
  await nominatimSlot();
  const params = new URLSearchParams({
    q: query,
    format: "jsonv2",
    addressdetails: "1",
    countrycodes: "gb",
    viewbox: NOMINATIM_VIEWBOX,
    bounded: "1",
    limit: "8",
  });
  const { body } = await getJson<NominatimPlace[]>(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-GB" },
  });
  const seen = new Set<string>();
  const results: GeoResult[] = [];
  for (const place of body ?? []) {
    const p = { lat: Number(place.lat), lon: Number(place.lon) };
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !insideCity(p)) continue;
    const label = shortAddress(place);
    if (seen.has(label)) continue;
    seen.add(label);
    results.push({
      label,
      detail: place.display_name,
      lat: Math.round(p.lat * 1e6) / 1e6,
      lon: Math.round(p.lon * 1e6) / 1e6,
      source: "place",
    });
    if (results.length === 5) break;
  }
  return results;
}

/** Street-level address for a point. */
export async function reverseAddress(lat: number, lon: number): Promise<string | null> {
  "use cache";
  cacheLife("days");
  await nominatimSlot();
  const params = new URLSearchParams({ lat: String(lat), lon: String(lon), format: "jsonv2", zoom: "17", addressdetails: "1" });
  const { body } = await getJson<NominatimPlace & { error?: string }>(`https://nominatim.openstreetmap.org/reverse?${params}`, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-GB" },
  });
  if (!body || body.error) return null;
  return shortAddress(body);
}
