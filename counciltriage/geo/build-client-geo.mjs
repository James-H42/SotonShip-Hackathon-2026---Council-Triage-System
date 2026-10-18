// Builds the browser copies of the map data in public/geo/ (see geo/README.md, "Client map files").
// Needs Turf: run from a temporary folder with `npm i @turf/union @turf/helpers @turf/simplify @turf/truncate`.
// Usage: node build-client-geo.mjs <counciltriage>/geo <counciltriage>/public/geo
import fs from "node:fs";
import { union } from "@turf/union";
import { featureCollection } from "@turf/helpers";
import { simplify } from "@turf/simplify";
import { truncate } from "@turf/truncate";
const [,, geoDir, outDir] = process.argv;
fs.mkdirSync(outDir, { recursive: true });
// Boundary: dissolve the 17 wards.
const wards = JSON.parse(fs.readFileSync(`${geoDir}/wards.geojson`, "utf8"));
let city = union(featureCollection(wards.features));
city = truncate(simplify(city, { tolerance: 0.00003, highQuality: true }), { precision: 5 });
city.properties = { name: "Southampton" };
fs.writeFileSync(`${outDir}/boundary.geojson`, JSON.stringify(featureCollection([city])));
console.log("boundary", city.geometry.type, city.geometry.coordinates.length, fs.statSync(`${outDir}/boundary.geojson`).size);
// Key roads: simplify ~2 m and round to 5 dp (~1 m). Schema unchanged.
const roads = JSON.parse(fs.readFileSync(`${geoDir}/key_roads.geojson`, "utf8"));
const out = roads.features.map((f) => {
  const s = truncate(simplify(f, { tolerance: 0.00004, highQuality: true }), { precision: 5 });
  return { type: "Feature", properties: { name: f.properties.name, ref: f.properties.ref, highway: f.properties.highway }, geometry: s.geometry };
});
fs.writeFileSync(`${outDir}/key-roads.geojson`, JSON.stringify({ type: "FeatureCollection", name: "key_roads", features: out }));
console.log("roads", out.length, fs.statSync(`${outDir}/key-roads.geojson`).size);
