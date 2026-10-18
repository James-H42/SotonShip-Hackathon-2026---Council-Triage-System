import { afterEach, describe, expect, it, vi } from "vitest";
import { clearRoadCache, withRoadRoutes } from "@/lib/road-routing";
import { planRoutes, type RouteJob } from "@/lib/routing";

const job = (id: number, lat: number, lon: number): RouteJob => ({ id, ref: `R${id}`, title: `Job ${id}`, category: "pothole", priorityScore: 50, priorityBand: "high", jobMinutes: 30, lat, lon });
// Three jobs in a line; by road, 3 is reached from 1 more quickly than from 2 (a one-way system).
const jobs = [job(1, 50.9, -1.4), job(2, 50.91, -1.4), job(3, 50.92, -1.4)];

afterEach(() => {
  vi.unstubAllGlobals();
  clearRoadCache();
});

describe("road routing", () => {
  it("re-orders stops by road time and keeps the straight line for comparison", async () => {
    // Road seconds between job ids: 1-3 is quick, 2-3 is slow.
    const road: Record<string, number> = { "1-2": 600, "1-3": 300, "2-3": 900 };
    const secs = (a: number, b: number) => (a === b ? 0 : road[`${Math.min(a, b)}-${Math.max(a, b)}`]);
    const idsIn = (url: string) =>
      decodeURIComponent(url.split("/driving/")[1].split("?")[0])
        .split(";")
        .map((c) => jobs.find((j) => Math.abs(j.lat - Number(c.split(",")[1])) < 1e-6)!.id);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const ids = idsIn(url);
        const body = url.includes("/table/")
          ? { code: "Ok", durations: ids.map((a) => ids.map((b) => secs(a, b))), distances: ids.map((a) => ids.map((b) => secs(a, b) * 10)) }
          : {
              code: "Ok",
              routes: [{ geometry: { coordinates: ids.map((id) => [-1.4, jobs[id - 1].lat]) }, legs: ids.slice(1).map((b, i) => ({ distance: secs(ids[i], b) * 10, duration: secs(ids[i], b) })) }],
            };
        return new Response(JSON.stringify(body));
      }),
    );
    const plan = await withRoadRoutes(planRoutes(jobs, { crews: 1 }));
    const crew = plan.crews[0];
    expect(crew.routing).toBe("road");
    expect([[2, 1, 3], [3, 1, 2]]).toContainEqual(crew.stops.map((s) => s.job.id));
    expect(crew.roadPath).toHaveLength(3);
    expect(crew.totalKm).toBe(9);
    expect(crew.straightKm).toBeGreaterThan(0);
  });

  it("falls back to the straight-line plan when routing is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const straight = planRoutes(jobs, { crews: 1 });
    const plan = await withRoadRoutes(straight);
    expect(plan.crews[0].routing).toBe("straight");
    expect(plan.crews[0].stops.map((s) => s.job.id)).toEqual(straight.crews[0].stops.map((s) => s.job.id));
    expect(plan.crews[0].roadPath).toBeUndefined();
  });
});
