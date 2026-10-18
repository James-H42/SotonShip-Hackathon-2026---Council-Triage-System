/**
 * Recalculate ward, road context and triage for every report without touching
 * any other data. Run after changing geo/*.geojson or triage rules.
 *
 *   npm run retriage
 */
import fs from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const { db, transaction } = await import("../lib/db");
const { geoContextFor, retriage } = await import("../lib/repo/reports");

const rows = db().prepare("SELECT id, lat, lon, geo_context FROM reports ORDER BY id").all() as { id: number; lat: number; lon: number; geo_context: string }[];
const update = db().prepare("UPDATE reports SET ward = ?, geo_context = ? WHERE id = ?");
const started = Date.now();
transaction(() => {
  rows.forEach((r, i) => {
    // Keep enrichments supplied by other teams (nearSchool, roadClass, ...), refresh ward and road.
    const previous = JSON.parse(r.geo_context || "{}");
    const geo = { ...previous, ...geoContextFor(Number(r.lat), Number(r.lon)) };
    update.run(geo.ward ?? null, JSON.stringify(geo), Number(r.id));
    retriage(Number(r.id));
    if ((i + 1) % 2500 === 0) console.log(`  ${i + 1}/${rows.length}`);
  });
});
console.log(`Re-triaged ${rows.length} reports in ${((Date.now() - started) / 1000).toFixed(1)}s`);
