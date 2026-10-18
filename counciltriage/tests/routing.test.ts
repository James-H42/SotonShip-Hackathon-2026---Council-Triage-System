import { describe, expect, it } from "vitest";
import { planRoutes, type RouteJob } from "@/lib/routing";

function job(id: number, lat: number, lon: number, priorityScore: number, jobMinutes = 40): RouteJob {
  return { id, ref: `R${id}`, title: `Job ${id}`, category: "pothole", priorityScore, priorityBand: "high", lat, lon, jobMinutes };
}

describe("route planning", () => {
  const grid = Array.from({ length: 40 }, (_, i) => job(i + 1, 50.89 + (i % 8) * 0.008, -1.46 + Math.floor(i / 8) * 0.025, 50 + (i % 30)));

  it("gives each two-person crew at most 5 jobs within the shift", () => {
    const plan = planRoutes(grid, { crews: 2, shiftMinutes: 450 });
    for (const crew of plan.crews) {
      expect(crew.stops.length).toBeLessThanOrEqual(5);
      expect(crew.totalMinutes).toBeLessThanOrEqual(450);
    }
    expect(plan.totals.jobs).toBe(10);
    expect(plan.totals.jobs + plan.unassigned.length).toBe(40);
  });

  it("starts the day at the first job, with no depot", () => {
    const plan = planRoutes(grid, { crews: 1 });
    const [crew] = plan.crews;
    expect(crew.path[0]).toEqual({ lat: crew.stops[0].job.lat, lon: crew.stops[0].job.lon });
    expect(crew.path).toHaveLength(crew.stops.length);
    expect(crew.stops[0].arriveMinute).toBe(0);
    expect(crew.stops[0].legKm).toBe(0);
  });

  it("always includes the highest-priority job and respects the job limit", () => {
    const plan = planRoutes(grid, { crews: 1, maxJobsPerCrew: 4 });
    const top = [...grid].sort((a, b) => b.priorityScore - a.priorityScore)[0];
    expect(plan.crews[0].stops.map((s) => s.job.id)).toContain(top.id);
    expect(plan.crews[0].stops).toHaveLength(4);
  });

  it("visits the stops in the shortest order", () => {
    // Four jobs on a line, given in a scrambled order: the best open path walks the line.
    const line = [job(1, 50.9, -1.4, 90), job(2, 50.9, -1.37, 80), job(3, 50.9, -1.39, 85), job(4, 50.9, -1.38, 70)];
    const ids = planRoutes(line, { crews: 1 }).crews[0].stops.map((s) => s.job.id);
    expect([ids, [...ids].reverse()]).toContainEqual([1, 3, 4, 2]);
  });

  it("uses every crew and gives each an ordered route with a navigation link", () => {
    const jobs = [job(1, 50.89, -1.46, 80), job(2, 50.895, -1.455, 70), job(3, 50.94, -1.35, 75), job(4, 50.935, -1.355, 65)];
    const plan = planRoutes(jobs, { crews: 2, shiftMinutes: 450, maxJobsPerCrew: 2 });
    expect(plan.crews.every((c) => c.stops.length > 0)).toBe(true);
    for (const c of plan.crews) {
      const arrivals = c.stops.map((s) => s.arriveMinute);
      expect([...arrivals].sort((a, b) => a - b)).toEqual(arrivals);
      expect(c.mapsUrls[0]).toMatch(/^https:\/\/www\.google\.com\/maps\/dir\//);
    }
  });
});
