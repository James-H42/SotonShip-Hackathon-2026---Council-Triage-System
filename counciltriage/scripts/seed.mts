/**
 * Builds the local database from the FixMyStreet scrape.
 *
 *   npm run seed                 # import every report
 *   npm run seed -- --limit 2000 # quicker partial import
 *
 * Reads FMS_DATA_DIR (default ../../FixMyStreet Scraper/fixmystreet_sample): reports.jsonl
 * if present (has timestamps), otherwise reports_trimmed.jsonl, plus photos/.
 * Existing data is replaced.
 *
 * Only reports from the last OPEN_WINDOW_DAYS (default 120, about 4 months) can be open:
 * older FixMyStreet reports still marked open are archived as closed history, so the
 * queue does not show potholes from 2011 as outstanding.
 *
 * Also loads the team's synthetic test reports (data/synthetic/synthetic_reports.jsonl),
 * dated over the last three weeks, which exercise merging, injuries and vulnerability.
 * Run `npm run ai:process` afterwards to triage open reports with the local LLM + image model.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const { config } = await import("../lib/config");
const { openDatabase, setDatabase, transaction } = await import("../lib/db");
const { categoryForService, isCategoryId } = await import("../lib/taxonomy");
const { statusFromFixMyStreet } = await import("../lib/statuses");
const { addEvent, addSupporter, createResidentReport, geoContextFor, retriage, updateStatus } = await import("../lib/repo/reports");
const { createOfficer } = await import("../lib/repo/officers");
const { createResidentAccount } = await import("../lib/repo/residents");

/**
 * The two live-demo accounts (one per area), read from .secrets/demo-accounts.json
 * (git-ignored). Environment variables override the file. Test credentials only.
 * On a fresh clone the file is created with random passwords.
 */
const { readFileSync, existsSync } = await import("node:fs");
const { randomBytes } = await import("node:crypto");
const secretsPath = new URL("../.secrets/demo-accounts.json", import.meta.url);
if (!existsSync(secretsPath)) {
  const pw = () => randomBytes(9).toString("base64url");
  fs.mkdirSync(new URL("../.secrets/", import.meta.url), { recursive: true });
  fs.writeFileSync(
    secretsPath,
    JSON.stringify(
      {
        _note: "Local demo accounts created by npm run seed. Test credentials only; git-ignored.",
        officer: { email: "officer@counciltriage.test", name: "Sam Patel", password: pw() },
        resident: { email: "resident@counciltriage.test", firstName: "Alex", lastName: "Morgan", password: pw() },
      },
      null,
      1,
    ),
  );
  console.log("Created .secrets/demo-accounts.json with new demo passwords.");
}
const secrets = JSON.parse(readFileSync(secretsPath, "utf8")) as {
  officer: { email: string; name: string; password: string };
  resident: { email: string; firstName: string; lastName: string; password: string };
};
const DEMO_OFFICER = {
  email: process.env.OFFICER_EMAIL ?? secrets.officer.email,
  name: process.env.OFFICER_NAME ?? secrets.officer.name,
  password: process.env.OFFICER_PASSWORD ?? secrets.officer.password,
};
const DEMO_RESIDENT = {
  email: process.env.RESIDENT_EMAIL ?? secrets.resident.email,
  firstName: process.env.RESIDENT_FIRST_NAME ?? secrets.resident.firstName,
  lastName: process.env.RESIDENT_LAST_NAME ?? secrets.resident.lastName,
  password: process.env.RESIDENT_PASSWORD ?? secrets.resident.password,
};

type FmsRecord = {
  id: number;
  status: string;
  service_name: string;
  category: string;
  title: string;
  detail: string;
  lat: number;
  lon: number;
  has_photo: boolean;
  in_sample: boolean;
  photo_path: string | null;
  requested_at?: string;
  updated_at?: string;
  report_url?: string;
  interface_used?: string;
  photo_bytes?: number | null;
  photo_sha256?: string | null;
};

const args = process.argv.slice(2);
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const fmsDir = config.fixMyStreetDir;
const source = ["reports.jsonl", "reports_trimmed.jsonl"].map((f) => path.join(fmsDir, f)).find((f) => fs.existsSync(f));
if (!source) {
  console.warn(
    `No FixMyStreet scrape found in ${fmsDir} (reports.jsonl). Seeding the synthetic reports and demo accounts only; set FMS_DATA_DIR to import the real Southampton reports.`,
  );
}

for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(config.dbPath + suffix, { force: true });
fs.rmSync(path.join(config.uploadDir, "fms"), { recursive: true, force: true });
fs.mkdirSync(path.join(config.uploadDir, "fms"), { recursive: true });

const database = openDatabase(config.dbPath);
setDatabase(database);
createOfficer(DEMO_OFFICER.email, DEMO_OFFICER.name, DEMO_OFFICER.password, "officer");

if (source) console.log(`Importing from ${source}`);
const started = Date.now();
const records: FmsRecord[] = [];
const rl = source ? readline.createInterface({ input: fs.createReadStream(source), crlfDelay: Infinity }) : [];
for await (const line of rl) {
  if (!line.trim()) continue;
  const r = JSON.parse(line) as FmsRecord;
  records.push({
    id: r.id,
    status: r.status,
    service_name: r.service_name,
    category: r.category,
    title: r.title,
    detail: r.detail,
    lat: r.lat,
    lon: r.lon,
    has_photo: r.has_photo,
    in_sample: r.in_sample,
    photo_path: r.photo_path,
    requested_at: r.requested_at,
    updated_at: r.updated_at,
    report_url: r.report_url,
    interface_used: r.interface_used,
    photo_bytes: r.photo_bytes,
    photo_sha256: r.photo_sha256,
  });
  if (records.length >= limit) break;
}

const insert = database.prepare(
  `INSERT INTO reports (id, ref, source, external_url, status, created_at, updated_at, title, detail, lat, lon, ward,
     resident_category, service_name, answers, has_photo, in_sample, category, category_source, llm_status, vision_status, geo_context)
   VALUES (?, ?, 'fixmystreet', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, 'resident', ?, ?, ?)`,
);
const insertPhoto = database.prepare(
  "INSERT INTO report_photos (report_id, file_name, mime, bytes, sha256, created_at) VALUES (?, ?, 'image/jpeg', ?, ?, ?)",
);

const OPEN_STATUSES = new Set(["received", "in_progress", "repair_scheduled", "monitoring"]);
const OPEN_WINDOW_DAYS = Number(process.env.OPEN_WINDOW_DAYS ?? 120);
const openCutoff = new Date(Date.now() - OPEN_WINDOW_DAYS * 86_400_000).toISOString();
let photos = 0;
let archived = 0;
transaction(() => {
  for (const r of records) {
    const createdAt = r.requested_at ?? "2020-01-01T00:00:00Z";
    const updatedAt = r.updated_at ?? createdAt;
    const fmsStatus = statusFromFixMyStreet(r.status);
    const historical = fmsStatus === "received" && createdAt < openCutoff;
    if (historical) archived++;
    const status = historical ? "closed" : fmsStatus;
    // Keep the dataset's tag; fall back to the service mapping for anything unexpected.
    const category = isCategoryId(r.category) ? r.category : categoryForService(r.service_name);
    const geo = geoContextFor(r.lat, r.lon);

    let photoFile: string | null = null;
    if (r.photo_path) {
      const from = path.join(fmsDir, r.photo_path);
      if (fs.existsSync(from)) {
        photoFile = `fms/${r.id}${path.extname(from) || ".jpeg"}`;
        fs.copyFileSync(from, path.join(config.uploadDir, photoFile));
      }
    }

    insert.run(
      r.id,
      `FMS${r.id}`,
      r.report_url ?? `https://www.fixmystreet.com/report/${r.id}`,
      status,
      createdAt,
      updatedAt,
      r.title || "(no title)",
      r.detail || "",
      r.lat,
      r.lon,
      geo.ward ?? null,
      category,
      r.service_name,
      r.has_photo ? 1 : 0,
      r.in_sample ? 1 : 0,
      category,
      // Closed history is never sent to the models.
      OPEN_STATUSES.has(status) ? "queued" : "skipped",
      photoFile ? (OPEN_STATUSES.has(status) ? "queued" : "skipped") : "none",
      JSON.stringify(geo),
    );
    if (photoFile) {
      insertPhoto.run(r.id, photoFile, r.photo_bytes ?? null, r.photo_sha256 ?? null, createdAt);
      photos++;
    }
    addEvent(r.id, {
      kind: "created",
      status: "received",
      message: `Reported via FixMyStreet${r.interface_used ? ` (${r.interface_used})` : ""}.`,
      isPublic: true,
      actor: { type: "resident" },
      createdAt,
    });
    if (historical) {
      addEvent(r.id, {
        kind: "status",
        status: "closed",
        message: `Historical report (older than ${OPEN_WINDOW_DAYS} days when imported): archived, not part of the active queue.`,
        isPublic: true,
        actor: { type: "system", name: "FixMyStreet import" },
        createdAt: updatedAt,
      });
    } else if (status !== "received") {
      addEvent(r.id, {
        kind: "status",
        status,
        message: "Marked as fixed or closed on FixMyStreet.",
        isPublic: true,
        actor: { type: "system", name: "FixMyStreet import" },
        createdAt: updatedAt,
      });
    }
  }
}, database);
console.log(
  `Inserted ${records.length} reports (${photos} photos) in ${((Date.now() - started) / 1000).toFixed(1)}s; ` +
    `${archived} open reports older than ${OPEN_WINDOW_DAYS} days archived as history`,
);

// ---------------------------------------------------------------------------
// Synthetic test reports (team dataset with ground truth in synthetic_ground_truth.csv)
// ---------------------------------------------------------------------------
const SYNTHETIC_CATEGORY: Record<string, string> = {
  "Street lighting": "street_light",
  Potholes: "pothole",
  "Fly-tipping": "fly_tipping",
  Graffiti: "vandalism",
  "Pavements and footpaths": "road_pavement_damage",
  "Rubbish and bins": "litter",
};
/** Photos from the FixMyStreet scrape attached to some synthetic reports, to exercise the image model. */
const SYNTHETIC_PHOTOS: Record<number, number> = {
  900008: 6221483, // huge pothole on Bitterne Road <- clear pothole photo
  900011: 5590868, // pothole <- "35x45 cm" pothole
  900013: 9279274, // fly-tipping <- large corner suite dumped
  900016: 7191586, // dumped furniture <- sofa and bags
  900019: 8059189, // graffiti <- graffiti
  900029: 7954984, // vague "see photo" <- litter: the image model fills in the category
  900020: 5736484, // graffiti report with a POTHOLE photo: image/text mismatch -> officer review
};
const syntheticFile = path.join(process.cwd(), "data/synthetic/synthetic_reports.jsonl");
const syntheticIds: number[] = [];
if (fs.existsSync(syntheticFile)) {
  const rows = fs
    .readFileSync(syntheticFile, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { id: number; category: string; title: string; detail: string; lat: number; lon: number });
  const insertSynthetic = database.prepare(
    `INSERT INTO reports (id, ref, source, status, created_at, updated_at, title, detail, lat, lon, ward,
       resident_category, service_name, answers, has_photo, in_sample, category, category_source, llm_status, vision_status, geo_context)
     VALUES (?, ?, 'synthetic', 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, 0, ?, 'resident', 'queued', ?, ?)`,
  );
  transaction(() => {
    rows.forEach((r, i) => {
      // Spread over the last three weeks in file order, so clusters build up over time.
      const createdAt = new Date(Date.now() - (rows.length - i) * 12 * 3_600_000).toISOString();
      const category = SYNTHETIC_CATEGORY[r.category] ?? "other";
      const geo = geoContextFor(r.lat, r.lon);
      const photoId = SYNTHETIC_PHOTOS[r.id];
      let photoFile: string | null = null;
      if (photoId) {
        const from = path.join(fmsDir, `photos/${photoId}.jpeg`);
        if (fs.existsSync(from)) {
          photoFile = `fms/synthetic-${r.id}.jpeg`;
          fs.copyFileSync(from, path.join(config.uploadDir, photoFile));
        }
      }
      insertSynthetic.run(
        r.id, `SYN${r.id}`, createdAt, createdAt, r.title, r.detail, r.lat, r.lon, geo.ward ?? null,
        category, r.category === "other" ? "Other" : r.category, photoFile ? 1 : 0, category, photoFile ? "queued" : "none", JSON.stringify(geo),
      );
      if (photoFile) insertPhoto.run(r.id, photoFile, fs.statSync(path.join(config.uploadDir, photoFile)).size, null, createdAt);
      addEvent(r.id, { kind: "created", status: "received", message: "Synthetic test report (team dataset).", isPublic: true, actor: { type: "resident" }, createdAt });
      syntheticIds.push(r.id);
    });
  }, database);
  console.log(`Inserted ${syntheticIds.length} synthetic test reports`);
}

const triageStart = Date.now();
transaction(() => {
  [...records.map((r) => r.id), ...syntheticIds].forEach((id, i) => {
    retriage(id);
    if ((i + 1) % 2500 === 0) console.log(`  triaged ${i + 1}/${records.length}`);
  });
}, database);
console.log(`Triage complete in ${((Date.now() - triageStart) / 1000).toFixed(1)}s`);

// Demo resident with a history of reports at different stages.
const residentId = createResidentAccount({ ...DEMO_RESIDENT, phone: null });
const contact = { firstName: DEMO_RESIDENT.firstName, lastName: DEMO_RESIDENT.lastName, email: DEMO_RESIDENT.email };
const officerActor = { type: "officer" as const, name: DEMO_OFFICER.name, officerId: 1 };
const daysAgo = (d: number, h = 10) => new Date(Date.now() - d * 86_400_000 + (h - 12) * 3_600_000).toISOString();
const demoPhoto = (() => {
  const from = path.join(fmsDir, "photos/5503344.jpeg");
  if (!fs.existsSync(from)) return [];
  fs.mkdirSync(path.join(config.uploadDir, "resident"), { recursive: true });
  const fileName = "resident/demo-flytipping.jpeg";
  fs.copyFileSync(from, path.join(config.uploadDir, fileName));
  return [{ fileName, mime: "image/jpeg", bytes: fs.statSync(from).size, sha256: "demo" }];
})();

const light = createResidentReport({
  category: "street_light",
  serviceName: "Street lighting",
  title: "Street light out on Hill Lane",
  detail: "The street light outside number 42 has been out for a week. The pavement is very dark walking home from the station.",
  answers: { light_fault: "out", light_count: "one", light_number: "HL-17" },
  hazardLevel: "medium",
  lat: 50.9189,
  lon: -1.4228,
  locationText: "Outside 42 Hill Lane",
  locationPrecision: "exact",
  contact,
  photos: [],
  createdAt: daysAgo(14),
});
updateStatus(light.id, "in_progress", { actor: officerActor, message: "Passed to our street lighting contractor.", at: daysAgo(13) });
updateStatus(light.id, "repair_scheduled", { actor: officerActor, message: "An electrician is booked to replace the lamp this week.", at: daysAgo(11) });
updateStatus(light.id, "completed", { actor: officerActor, message: "The lamp has been replaced and the light is working again.", at: daysAgo(9) });

const pothole = createResidentReport({
  category: "pothole",
  serviceName: "Potholes",
  title: "Deep pothole at the Portswood Road crossing",
  detail: "Very deep pothole in the road next to the pedestrian crossing outside the shops. Cyclists swerve into traffic to avoid it.",
  answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT", pothole_width: "large", pothole_statement: "true" },
  hazardLevel: "high",
  lat: 50.92434,
  lon: -1.39417,
  locationText: "Portswood Road, by the pedestrian crossing outside the shops",
  locationPrecision: "exact",
  contact,
  photos: [],
  createdAt: daysAgo(2, 9),
});
updateStatus(pothole.id, "in_progress", { actor: officerActor, message: "An inspector has been asked to make the pothole safe today.", at: daysAgo(2, 11) });

createResidentReport({
  category: "fly_tipping",
  serviceName: "Flytipping",
  title: "Mattress and bags dumped by the alley",
  detail: "Someone has dumped a mattress and several black bags at the entrance to the alley behind the shops. It is blocking the path.",
  answers: { waste_types: ["furniture", "bags"], waste_amount: "car_boot", waste_obstruction: "yes", waste_land: "public" },
  hazardLevel: "medium",
  lat: 50.9133,
  lon: -1.3925,
  locationText: "Alley entrance behind Bevois Valley Road shops",
  locationPrecision: "exact",
  contact,
  photos: demoPhoto,
  createdAt: daysAgo(0, 8),
});

createResidentReport({
  category: "pothole",
  serviceName: "Potholes",
  title: "Small dip in the pavement on Burgess Road",
  detail: "Shallow dip in the pavement near the bus stop. Not dangerous yet but getting bigger.",
  answers: { pothole_where: "FOOTWAY", pothole_depth_pavement: "MONITOR", pothole_width: "small", pothole_statement: "true" },
  hazardLevel: "low",
  lat: 50.9352,
  lon: -1.4105,
  locationText: "Burgess Road, near the bus stop",
  locationPrecision: "exact",
  contact,
  photos: [],
  createdAt: daysAgo(20),
});

// The demo resident has also backed an existing report near home.
const nearby = database.prepare("SELECT id FROM reports WHERE source = 'fixmystreet' AND is_open = 1 AND category = 'pothole' ORDER BY priority_score DESC LIMIT 1").get() as { id: number } | undefined;
if (nearby) addSupporter(nearby.id, DEMO_RESIDENT.email, residentId);
console.log(`Demo resident: ${DEMO_RESIDENT.email} with 4 reports (password in .secrets/demo-accounts.json)`);

const summary = database
  .prepare(
    `SELECT COUNT(*) AS total,
       SUM(status IN ('received','in_progress','repair_scheduled','monitoring')) AS open,
       SUM(needs_review) AS review, SUM(dubious) AS dubious, SUM(category = 'tbc') AS tbc,
       (SELECT COUNT(DISTINCT report_id) FROM report_links WHERE kind = 'suggested_duplicate') AS dupes
     FROM reports`,
  )
  .get();
console.log(summary);
console.log(`Demo officer: ${DEMO_OFFICER.email} (password in .secrets/demo-accounts.json)`);
database.close();
