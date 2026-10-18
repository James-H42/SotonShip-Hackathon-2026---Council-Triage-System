/**
 * Daily route planning for two-person repair crews (README "Route planning").
 *
 * Contracted staff work in pairs and realistically complete 4-5 jobs a day, so
 * each crew gets at most `maxJobsPerCrew` jobs (default 5). There is no depot:
 * the working day starts at the crew's first job.
 *
 *   1. Selection (prize-collecting greedy): a crew's route is anchored on the
 *      highest-priority job still unassigned. Further jobs are added one at a time,
 *      choosing the one with the best value = priority - TRAVEL_PENALTY x extra
 *      driving minutes, while the day still fits in the shift.
 *   2. Ordering (exact): with at most 5-7 stops every visiting order is checked
 *      (5! = 120 permutations), so each crew's open path is the shortest possible
 *      for the jobs it was given.
 *   3. The next crew repeats with the remaining jobs, so crews cover different
 *      high-priority areas.
 */
import { haversineMetres, type LatLon } from "./geo";

export type RouteJob = LatLon & {
  id: number;
  ref: string;
  title: string;
  category: string;
  priorityScore: number;
  priorityBand: string;
  jobMinutes: number;
};

export type RouteOptions = {
  /** Number of two-person crews. */
  crews: number;
  shiftMinutes: number;
  /** Average urban driving speed including parking. */
  speedKmh: number;
  /** Road distance is longer than straight-line distance. */
  detourFactor: number;
  /** Jobs a two-person crew can realistically complete in a day. */
  maxJobsPerCrew: number;
  /** Priority points one extra minute of driving is worth giving up. */
  travelPenalty: number;
  /** Legacy: plans saved before routes started at the first job had a depot. */
  depot?: LatLon & { name: string };
};

export type RouteStop = {
  job: RouteJob;
  legKm: number;
  arriveMinute: number;
  departMinute: number;
};

export type CrewRoute = {
  crew: number;
  stops: RouteStop[];
  returnKm: number;
  totalKm: number;
  travelMinutes: number;
  workMinutes: number;
  totalMinutes: number;
  /** Stops in visiting order, ready for a map polyline (the straight-line route). */
  path: LatLon[];
  mapsUrls: string[];
  /** The same route along the actual roads (lib/road-routing.ts), when road routing answered. */
  roadPath?: LatLon[];
  routing?: "road" | "straight";
  /** Straight-line estimate (distance x detour factor), kept for comparison. */
  straightKm?: number;
  /** True when road times changed the visiting order chosen on straight lines. */
  reordered?: boolean;
};

export type RoutePlan = {
  options: RouteOptions;
  crews: CrewRoute[];
  unassigned: RouteJob[];
  totals: { jobs: number; km: number; minutes: number; priorityCovered: number; priorityAvailable: number };
  generatedAt: string;
};

export const DEFAULT_ROUTE_OPTIONS: RouteOptions = {
  crews: 2,
  shiftMinutes: 7.5 * 60,
  speedKmh: 20,
  detourFactor: 1.35,
  maxJobsPerCrew: 5,
  travelPenalty: 1,
};

type Node = LatLon;

export function travelKm(a: Node, b: Node, o: Pick<RouteOptions, "detourFactor">): number {
  return (haversineMetres(a, b) / 1000) * o.detourFactor;
}

function travelMin(a: Node, b: Node, o: RouteOptions): number {
  return (travelKm(a, b, o) / o.speedKmh) * 60;
}

/** Open path: start at the first job, finish at the last. */
function drivingMinutes(route: RouteJob[], o: RouteOptions): number {
  let t = 0;
  for (let i = 1; i < route.length; i++) t += travelMin(route[i - 1], route[i], o);
  return t;
}

function dayMinutes(route: RouteJob[], o: RouteOptions): number {
  return drivingMinutes(route, o) + route.reduce((n, j) => n + j.jobMinutes, 0);
}

/** Cheapest place to add `job` to an open path (any position, including either end). */
function bestInsertion(route: RouteJob[], job: RouteJob, o: RouteOptions): { index: number; delta: number } {
  if (!route.length) return { index: 0, delta: 0 };
  let best = { index: 0, delta: travelMin(job, route[0], o) };
  const endDelta = travelMin(route[route.length - 1], job, o);
  if (endDelta < best.delta) best = { index: route.length, delta: endDelta };
  for (let i = 1; i < route.length; i++) {
    const delta = travelMin(route[i - 1], job, o) + travelMin(job, route[i], o) - travelMin(route[i - 1], route[i], o);
    if (delta < best.delta) best = { index: i, delta };
  }
  return best;
}

/** Shortest open path through the stops: exact for small routes, 2-opt otherwise. */
export function bestOrder(route: RouteJob[], o: RouteOptions): RouteJob[] {
  if (route.length <= 2) return route.slice();
  if (route.length <= 7) {
    let best = route.slice();
    let bestMin = drivingMinutes(best, o);
    const permute = (prefix: RouteJob[], rest: RouteJob[]) => {
      if (!rest.length) {
        const m = drivingMinutes(prefix, o);
        if (m + 1e-9 < bestMin) {
          bestMin = m;
          best = prefix;
        }
        return;
      }
      for (let i = 0; i < rest.length; i++) permute([...prefix, rest[i]], [...rest.slice(0, i), ...rest.slice(i + 1)]);
    };
    permute([], route);
    return best;
  }
  return twoOpt(route, o);
}

/** Reverse segments while it shortens the open path. */
export function twoOpt(route: RouteJob[], o: RouteOptions): RouteJob[] {
  let best = route.slice();
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (drivingMinutes(candidate, o) + 1e-9 < drivingMinutes(best, o)) {
          best = candidate;
          improved = true;
        }
      }
    }
  }
  return best;
}

export function mapsUrls(stops: Node[]): string[] {
  if (!stops.length) return [];
  const fmt = (p: Node) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
  // Google Maps directions URLs accept up to 9 waypoints between origin and destination.
  const urls: string[] = [];
  for (let start = 0; start < Math.max(1, stops.length - 1); start += 10) {
    const leg = stops.slice(start, Math.min(stops.length, start + 11));
    const params = new URLSearchParams({ api: "1", origin: fmt(leg[0]), destination: fmt(leg[leg.length - 1]), travelmode: "driving" });
    if (leg.length > 2) params.set("waypoints", leg.slice(1, -1).map(fmt).join("|"));
    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }
  return urls;
}

function describeRoute(crew: number, route: RouteJob[], o: RouteOptions): CrewRoute {
  const stops: RouteStop[] = [];
  let t = 0;
  let km = 0;
  let travel = 0;
  let work = 0;
  route.forEach((job, i) => {
    const legKm = i === 0 ? 0 : travelKm(route[i - 1], job, o);
    const legMin = i === 0 ? 0 : travelMin(route[i - 1], job, o);
    t += legMin;
    travel += legMin;
    km += legKm;
    stops.push({ job, legKm: round(legKm, 2), arriveMinute: Math.round(t), departMinute: Math.round(t + job.jobMinutes) });
    t += job.jobMinutes;
    work += job.jobMinutes;
  });
  return {
    crew,
    stops,
    returnKm: 0,
    totalKm: round(km, 1),
    travelMinutes: Math.round(travel),
    workMinutes: Math.round(work),
    totalMinutes: Math.round(t),
    path: route.map((j) => ({ lat: j.lat, lon: j.lon })),
    mapsUrls: mapsUrls(route),
  };
}

function round(n: number, dp: number) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export function planRoutes(jobs: RouteJob[], options: Partial<RouteOptions> = {}): RoutePlan {
  const o: RouteOptions = { ...DEFAULT_ROUTE_OPTIONS, ...options };
  o.maxJobsPerCrew = Math.max(1, Math.min(7, Math.round(o.maxJobsPerCrew)));
  const crews = Math.max(1, Math.floor(o.crews));
  const pool = [...jobs].filter((j) => j.jobMinutes <= o.shiftMinutes).sort((a, b) => b.priorityScore - a.priorityScore || a.id - b.id);
  const tooLong = jobs.filter((j) => j.jobMinutes > o.shiftMinutes);
  const routes: RouteJob[][] = [];

  for (let c = 0; c < crews && pool.length; c++) {
    const route: RouteJob[] = [pool.shift()!];
    while (route.length < o.maxJobsPerCrew && pool.length) {
      let pick: { i: number; index: number; value: number } | null = null;
      pool.forEach((job, i) => {
        const { index, delta } = bestInsertion(route, job, o);
        if (dayMinutes(route, o) + delta + job.jobMinutes > o.shiftMinutes) return;
        const value = job.priorityScore - o.travelPenalty * delta;
        if (!pick || value > pick.value) pick = { i, index, value };
      });
      if (!pick) break;
      const { i, index } = pick;
      route.splice(index, 0, pool.splice(i, 1)[0]);
    }
    routes.push(bestOrder(route, o));
  }

  const described = routes.map((r, i) => describeRoute(i + 1, r, o));
  const assigned = described.flatMap((c) => c.stops.map((s) => s.job));
  return {
    options: o,
    crews: described,
    unassigned: [...pool, ...tooLong],
    totals: {
      jobs: assigned.length,
      km: round(
        described.reduce((n, c) => n + c.totalKm, 0),
        1,
      ),
      minutes: described.reduce((n, c) => n + c.totalMinutes, 0),
      priorityCovered: assigned.reduce((n, j) => n + j.priorityScore, 0),
      priorityAvailable: jobs.reduce((n, j) => n + j.priorityScore, 0),
    },
    generatedAt: new Date().toISOString(),
  };
}
