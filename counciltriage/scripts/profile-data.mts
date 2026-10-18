/**
 * Times the data functions behind the officer dashboard against the local database.
 *   npx tsx scripts/profile-data.mts
 */
import fs from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const { dashboardStats, getEvents, getLinkedReports, getReport, mapPins, nearbyOpenReports, searchReports } = await import("../lib/repo/reports");
const { planForSelection } = await import("../lib/repo/workorders");

function time(label: string, fn: () => unknown, runs = 20) {
  fn(); // warm up
  const samples: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(runs / 2)];
  const p95 = samples[Math.floor(runs * 0.95)];
  console.log(`${label.padEnd(44)} p50 ${p50.toFixed(2).padStart(7)} ms   p95 ${p95.toFixed(2).padStart(7)} ms`);
  return p50;
}

const top = searchReports({ pageSize: 1 }).items[0];
time("dashboardStats()", () => dashboardStats());
time("searchReports(default page)", () => searchReports({ pageSize: 50 }));
time("searchReports(page 100)", () => searchReports({ pageSize: 50, page: 100 }));
time("searchReports(queue=review)", () => searchReports({ queue: "review", pageSize: 50 }));
time("searchReports(queue=duplicates)", () => searchReports({ queue: "duplicates", pageSize: 50 }));
time("searchReports(category+ward)", () => searchReports({ category: "pothole", ward: "Portswood", pageSize: 50 }));
time("searchReports(q=pothole cyclist)", () => searchReports({ q: "pothole cyclist", pageSize: 50 }));
time("searchReports(sort=due)", () => searchReports({ sort: "due", pageSize: 50 }));
time("searchReports(status=all)", () => searchReports({ status: "all", pageSize: 50 }));
time("mapPins(1500)", () => mapPins({}, 1500));
time("mapPins(5000)", () => mapPins({}, 5000));
time("getReport + events + links", () => {
  getReport(top.id);
  getEvents(top.id);
  getLinkedReports(top.id);
});
time("nearbyOpenReports(150m)", () => nearbyOpenReports(50.9243, -1.3942, { radiusMetres: 150 }));
time("planForSelection(60 potholes, 2 crews)", () => planForSelection({ category: "pothole", minBand: "medium", limit: 60 }, { crews: 2 }), 5);
time("planForSelection(150 any, 5 crews)", () => planForSelection({ category: "fly_tipping", minBand: "low", limit: 150 }, { crews: 5 }), 3);
