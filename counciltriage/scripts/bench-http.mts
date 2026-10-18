/**
 * HTTP benchmark for the running app: response time and page weight per route.
 *   npx tsx scripts/bench-http.mts [baseUrl] [runs]
 * Signs an officer and a resident session locally (needs data/.session-secret and the demo accounts).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const base = process.argv[2] ?? "http://localhost:3000";
const runs = Number(process.argv[3] ?? 8);
const { db } = await import("../lib/db");

const secret = process.env.SESSION_SECRET || fs.readFileSync(path.join(process.env.DATA_DIR ?? "data", ".session-secret"), "utf8").trim();
function sign(payload: object) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}
const exp = Math.floor(Date.now() / 1000) + 3600;
const officer = db().prepare("SELECT id, name, email, role FROM officers LIMIT 1").get() as { id: number; name: string; email: string; role: string };
const resident = db().prepare("SELECT id, email FROM residents WHERE password_hash IS NOT NULL LIMIT 1").get() as { id: number; email: string } | undefined;
const officerCookie = `st_officer=${sign({ kind: "officer", officerId: officer.id, name: officer.name, email: officer.email, role: officer.role, exp })}`;
const residentCookie = resident ? `st_resident=${sign({ kind: "resident", residentId: resident.id, email: resident.email, exp })}` : "";
const topId = (db().prepare("SELECT id FROM reports WHERE is_open = 1 ORDER BY priority_score DESC LIMIT 1").get() as { id: number }).id;
const topRef = (db().prepare("SELECT ref FROM reports WHERE id = ?").get(topId) as { ref: string }).ref;

const routes: [string, string, string][] = [
  ["resident", "/", ""],
  ["resident", "/report", residentCookie],
  ["resident", "/reports", ""],
  ["resident", "/reports?q=pothole&ward=Portswood", ""],
  ["resident", `/reports/${topRef}`, ""],
  ["resident", "/my-reports", residentCookie],
  ["resident", "/api/reports/nearby?lat=50.9243&lon=-1.3942&radius=150", ""],
  ["officer", "/council", officerCookie],
  ["officer", "/council?queue=review", officerCookie],
  ["officer", "/council?category=pothole&ward=Portswood&sort=due", officerCookie],
  ["officer", "/council?q=pothole%20cyclist", officerCookie],
  ["officer", "/council?page=50", officerCookie],
  ["officer", `/council/reports/${topId}`, officerCookie],
  ["officer", "/council/routes?plan=1&category=pothole&minBand=medium&staff=4&shiftHours=7.5&limit=60", officerCookie],
  ["officer", "/council/work-orders", officerCookie],
  ["officer", "/council/integrations", officerCookie],
  ["officer", "/api/council/map/pins?category=pothole", officerCookie],
];

console.log(`Benchmarking ${base} (${runs} runs per route)\n`);
console.log(`${"area".padEnd(9)}${"route".padEnd(58)}${"p50 ms".padStart(8)}${"p95 ms".padStart(8)}${"KB".padStart(8)}  status`);
for (const [area, route, cookie] of routes) {
  const times: number[] = [];
  let bytes = 0;
  let status = 0;
  for (let i = 0; i <= runs; i++) {
    const t = performance.now();
    const res = await fetch(base + route, { headers: cookie ? { cookie } : {}, redirect: "manual" });
    const body = await res.arrayBuffer();
    if (i > 0) times.push(performance.now() - t); // first request warms caches/compilation
    bytes = body.byteLength;
    status = res.status;
  }
  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(times.length / 2)];
  const p95 = times[Math.min(times.length - 1, Math.floor(times.length * 0.95))];
  console.log(`${area.padEnd(9)}${route.slice(0, 56).padEnd(58)}${p50.toFixed(0).padStart(8)}${p95.toFixed(0).padStart(8)}${(bytes / 1024).toFixed(0).padStart(8)}  ${status}`);
}
