/**
 * Road-network routing on top of the straight-line planner (lib/routing.ts).
 *
 * The straight-line model (distance x 1.35 at 20 km/h) still chooses which jobs each crew gets:
 * it is instant and good enough for shortlisting. Then, for each crew, OSRM (OpenStreetMap road
 * network) gives the real driving time between every pair of its stops, every visiting order is
 * checked again on those road times, and the chosen order is drawn along the actual roads.
 *
 * Only job coordinates are sent (no report text or personal data). OSRM_URL can point at a
 * council-hosted OSRM instance; by default the public OSRM demo server is used. If routing is
 * unavailable, the straight-line plan is kept unchanged (`routing: "straight"`).
 */
import type { LatLon } from "./geo";
import { mapsUrls, type CrewRoute, type RouteJob, type RoutePlan } from "./routing";

const OSRM = (process.env.OSRM_URL ?? "https://router.project-osrm.org").replace(/\/$/, "");
const TIMEOUT_MS = 5000;
/** OSRM times are free-flow: allow for urban traffic, and for parking at each stop. */
const TRAFFIC_FACTOR = 1.3;
const PARKING_MINUTES = 4;

type Table = { durations: number[][]; distances: number[][] };
const cache = new Map<string, unknown>();
/** For tests. */
export const clearRoadCache = () => cache.clear();

async function osrm<T>(path: string): Promise<T> {
  if (cache.has(path)) return cache.get(path) as T;
  const res = await fetch(`${OSRM}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "StreetTriage/0.1 (SotonShip 2026 prototype)" } });
  if (!res.ok) throw new Error(`OSRM returned HTTP ${res.status}`);
  const body = (await res.json()) as T & { code?: string };
  if (body.code && body.code !== "Ok") throw new Error(`OSRM: ${body.code}`);
  if (cache.size > 500) cache.clear();
  cache.set(path, body);
  return body;
}

const coords = (pts: LatLon[]) => pts.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(";");

/** Every visiting order of up to 7 stops (open path); returns the order with the least road time. */
function bestRoadOrder(n: number, seconds: number[][]): number[] {
  const idx = [...Array(n).keys()];
  if (n <= 2) return idx;
  let best = idx;
  let bestCost = Infinity;
  const permute = (prefix: number[], rest: number[], cost: number) => {
    if (cost >= bestCost) return;
    if (!rest.length) {
      bestCost = cost;
      best = prefix;
      return;
    }
    for (let i = 0; i < rest.length; i++) {
      const next = rest[i];
      const add = prefix.length ? seconds[prefix[prefix.length - 1]][next] : 0;
      permute([...prefix, next], [...rest.slice(0, i), ...rest.slice(i + 1)], cost + add);
    }
  };
  permute([], idx, 0);
  return best;
}

async function roadCrew(crew: CrewRoute): Promise<CrewRoute> {
  const jobs: RouteJob[] = crew.stops.map((s) => s.job);
  const straightKm = crew.totalKm;
  if (jobs.length < 2) return { ...crew, routing: "road", straightKm, roadPath: jobs.map((j) => ({ lat: j.lat, lon: j.lon })) };
  const table = await osrm<Table>(`/table/v1/driving/${coords(jobs)}?annotations=duration,distance`);
  const order = jobs.length <= 7 ? bestRoadOrder(jobs.length, table.durations) : jobs.map((_, i) => i);
  const ordered = order.map((i) => jobs[i]);
  const route = await osrm<{ routes: { geometry: { coordinates: [number, number][] }; legs: { distance: number; duration: number }[] }[] }>(
    `/route/v1/driving/${coords(ordered)}?overview=full&geometries=geojson`,
  );
  const r = route.routes[0];
  let t = 0;
  let km = 0;
  let travel = 0;
  const stops = ordered.map((job, i) => {
    const leg = i === 0 ? null : r.legs[i - 1];
    const legKm = leg ? leg.distance / 1000 : 0;
    const legMin = leg ? (leg.duration / 60) * TRAFFIC_FACTOR + PARKING_MINUTES : 0;
    t += legMin;
    travel += legMin;
    km += legKm;
    const stop = { job, legKm: Math.round(legKm * 100) / 100, arriveMinute: Math.round(t), departMinute: Math.round(t + job.jobMinutes) };
    t += job.jobMinutes;
    return stop;
  });
  return {
    ...crew,
    stops,
    totalKm: Math.round(km * 10) / 10,
    travelMinutes: Math.round(travel),
    totalMinutes: Math.round(t),
    path: ordered.map((j) => ({ lat: j.lat, lon: j.lon })),
    mapsUrls: mapsUrls(ordered),
    roadPath: r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    routing: "road",
    straightKm,
    reordered: order.some((v, i) => v !== i),
  };
}

/** Replace straight-line legs with road routes where OSRM answers; keep the straight plan otherwise. */
export async function withRoadRoutes(plan: RoutePlan): Promise<RoutePlan> {
  const crews = await Promise.all(
    plan.crews.map((c) =>
      roadCrew(c).catch((err) => {
        console.warn("[road-routing] using straight-line route:", (err as Error).message);
        return { ...c, routing: "straight" as const, straightKm: c.totalKm };
      }),
    ),
  );
  return {
    ...plan,
    crews,
    totals: { ...plan.totals, km: Math.round(crews.reduce((n, c) => n + c.totalKm, 0) * 10) / 10, minutes: crews.reduce((n, c) => n + c.totalMinutes, 0) },
  };
}
