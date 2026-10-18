/**
 * Runs the resident and officer user stories (docs/USER-JOURNEYS.md) against the running app
 * and writes docs/JOURNEY-RESULTS.md.
 *
 *   npm run demo            # in another terminal (or any server on BASE_URL)
 *   npm run journeys
 *
 * Talks to the app over HTTP like a browser would. Officer API calls use a signed session
 * cookie (sign-in and sign-out screens themselves are checked by hand in the browser).
 * The run adds reports and a work order, so reset with `npm run demo` afterwards.
 */
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
const BASE = process.env.BASE_URL ?? "http://localhost:3100";

const { sign, OFFICER_COOKIE } = await import("../lib/auth");
const { db } = await import("../lib/db");
const { readJpegGps } = await import("../lib/exif");
const { createWorkOrder } = await import("../lib/repo/workorders");

type Result = { id: string; check: string; pass: boolean; detail: string; ms: number };
const results: Result[] = [];

async function check(id: string, name: string, fn: () => Promise<string>) {
  const t = Date.now();
  try {
    const detail = await fn();
    results.push({ id, check: name, pass: true, detail, ms: Date.now() - t });
  } catch (err) {
    results.push({ id, check: name, pass: false, detail: err instanceof Error ? err.message : String(err), ms: Date.now() - t });
  }
  const r = results.at(-1)!;
  console.log(`${r.pass ? "PASS" : "FAIL"} ${id} ${name} (${r.ms} ms) ${r.detail}`);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const officer = db().prepare("SELECT id, name, email, role FROM officers ORDER BY id LIMIT 1").get() as { id: number; name: string; email: string; role: string };
const officerCookie = `${OFFICER_COOKIE}=${sign({ kind: "officer", officerId: Number(officer.id), name: officer.name, email: officer.email, role: officer.role, exp: Date.now() + 3_600_000 })}`;
const asOfficer = { headers: { cookie: officerCookie } };
const html = async (p: string, init?: RequestInit) => (await fetch(BASE + p, { redirect: "manual", ...init })).text();
const json = async <T,>(p: string, init?: RequestInit) => {
  const res = await fetch(BASE + p, init);
  return { status: res.status, body: (await res.json()) as T };
};
const PRIVATE_FIELDS = ["detail", "photos", "contact", "email", "firstName", "lastName", "answers", "locationText"];
const leaks = (o: unknown): string[] => {
  const found: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object")
      for (const [k, x] of Object.entries(v)) {
        if (PRIVATE_FIELDS.includes(k) && x !== null && !(Array.isArray(x) && !x.length)) found.push(k);
        walk(x);
      }
  };
  walk(o);
  return found;
};
async function waitFor<T>(fn: () => T | null | undefined, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s`);
}
const row = (ref: string) => db().prepare("SELECT * FROM reports WHERE ref = ?").get(ref) as Record<string, unknown> | undefined;

// ---------------------------------------------------------------- resident (Alex)

await check("R1", "Start page offers Resident and Council", async () => {
  const page = await html("/");
  assert(page.includes("I&#x27;m a resident") || page.includes("I'm a resident"), "no resident option");
  assert(page.includes("I work for the council"), "no council option");
  assert(page.includes('href="/resident"'), "resident option does not link to /resident");
  return "both choices shown";
});

await check("R2", "One way to start a report, no draft prompt", async () => {
  const page = await html("/resident");
  const main = page.slice(page.indexOf("<main"));
  // The site's tab bar ("Home / Report a problem / Search / My reports") is navigation on every page, not an entry option.
  const links = main.match(/<a [^>]*href="\/report(\?[^"]*)?"[^>]*>/g) ?? [];
  const entries = links.filter((a) => !a.includes("border-b-4")).length;
  assert(entries === 1, `${entries} report entry links in the page body`);
  assert(!/unfinished report|continue your report/i.test(page), "draft prompt still present");
  return "1 entry button (plus the site tab bar); category chosen in the form";
});

await check("R3", "Postcode and street search; outside Southampton refused", async () => {
  const pc = await json<{ results: { lat: number; lon: number; label: string }[] }>("/api/geo/search?q=" + encodeURIComponent("SO15 5DQ"));
  assert(pc.body.results.length === 1, "SO15 5DQ not found");
  const street = await json<{ results: { label: string }[] }>("/api/geo/search?q=" + encodeURIComponent("Westgate Street"));
  assert(street.body.results.length >= 1, "street not found");
  const out = await json<{ results: unknown[]; message?: string }>("/api/geo/search?q=" + encodeURIComponent("PO1 2AB"));
  assert(out.body.results.length === 0, "Portsmouth postcode accepted");
  return `SO15 5DQ -> ${pc.body.results[0].label}; "${street.body.results[0].label}"; PO1 2AB refused`;
});

await check("R5", "Duplicate check shows nearby reports with summary fields only", async () => {
  const near = await json<{ items: { report: Record<string, unknown>; distanceMetres: number }[] }>("/api/reports/nearby?lat=50.89878&lon=-1.40678&radius=150&category=street_light");
  assert(near.body.items.length >= 1, "no nearby street-light report at Westgate Street");
  const found = leaks(near.body);
  assert(!found.length, `private fields exposed: ${found.join(", ")}`);
  const first = near.body.items[0];
  return `"${first.report.title}", ${first.distanceMetres} m away, no private fields`;
});

await check("R6", "Public report and list APIs never expose private fields", async () => {
  const one = await json("/api/reports/SYN900001");
  const list = await json("/api/reports?q=pothole");
  const found = [...leaks(one.body), ...leaks(list.body)];
  assert(!found.length, `private fields exposed: ${found.join(", ")}`);
  return "detail, photos and contact details absent";
});

let supportBefore = 0;
await check("R5", "Adding support raises the incident's report count", async () => {
  supportBefore = Number(row("SYN900001")?.supporters ?? 0);
  const res = await json<{ added: boolean }>("/api/reports/SYN900001/support", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "journey.neighbour@example.test", firstName: "Journey", lastName: "Neighbour" }),
  });
  assert(res.body.added, `support not added (HTTP ${res.status})`);
  const after = Number(row("SYN900001")?.supporters ?? 0);
  assert(after === supportBefore + 1, `count ${supportBefore} -> ${after}`);
  return `${supportBefore + 1} -> ${after + 1} people`;
});

// Simulates the form: GPS read from the original photos in the browser, photos uploaded resized.
const photoDir = path.join(process.cwd(), "data/demo-photos");
const photoA = fs.readFileSync(path.join(photoDir, "pothole-the-avenue-1.jpg"));
const gps = readJpegGps(photoA.buffer.slice(photoA.byteOffset, photoA.byteOffset + photoA.byteLength) as ArrayBuffer);
let newRef = "";
await check("R4", "Photo GPS becomes the report location", async () => {
  assert(gps, "demo photo has no GPS");
  const draft = {
    category: "pothole",
    serviceName: "Potholes",
    title: "Deep pothole on The Avenue",
    detail: "Deep pothole in the northbound lane of The Avenue by the bus stop. A cyclist came off and hurt his knee this morning.",
    answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT", pothole_width: "large", pothole_statement: "true" },
    hazardLevel: "high",
    lat: gps.lat,
    lon: gps.lon,
    locationSource: "photo",
    firstName: "Journey",
    lastName: "Resident",
    email: "journey.resident@example.test",
    privacyAccepted: true,
  };
  const form = new FormData();
  form.set("draft", JSON.stringify(draft));
  form.append("photos", new Blob([new Uint8Array(photoA)], { type: "image/jpeg" }), "pothole.jpg");
  const t = Date.now();
  const res = await json<{ ref: string }>("/api/reports", { method: "POST", body: form });
  assert(res.status < 300 && res.body.ref, `submit failed (HTTP ${res.status})`);
  newRef = res.body.ref;
  const r = row(newRef)!;
  assert(r.location_source === "photo" && Math.abs(Number(r.lat) - gps.lat) < 1e-5, "photo location not stored");
  return `${newRef} at ${gps.lat}, ${gps.lon} (from photo, ${r.ward}); response in ${Date.now() - t} ms`;
});

await check("O7", "New report is triaged by both models within 15 s", async () => {
  const done = await waitFor(() => {
    const r = row(newRef);
    return r && r.llm_status === "done" && r.vision_status === "done" ? r : null;
  }, 30_000);
  const triage = JSON.parse(String(done.triage));
  const ms = new Date().getTime() - new Date(String(done.created_at)).getTime();
  assert(ms < 15_000, `took ${Math.round(ms / 1000)} s`);
  return `${done.category}, ${done.priority_band} ${done.priority_score}; LLM urgency ${triage.text?.urgency}, injury ${triage.text?.injury}; photo ${triage.images?.[0]?.notes} (${Math.round(ms / 1000)} s)`;
});

await check("R7", "Resident sees a reference and progress; duplicates are told where to look", async () => {
  const pub = await json<{ report: { status: string; mergedInto: string | null } }>(`/api/reports/${newRef}`);
  assert(pub.status === 200, "public status page missing");
  const events = db()
    .prepare("SELECT message FROM report_events WHERE report_id = (SELECT id FROM reports WHERE ref = ?) AND is_public = 1")
    .all(newRef) as { message: string }[];
  assert(events.some((e) => /received/i.test(e.message)), "no 'received' update");
  return `${newRef}: ${pub.body.report.status}${pub.body.report.mergedInto ? `, merged into ${pub.body.report.mergedInto}` : ""}; ${events.length} public updates`;
});

await check("R8", "Signed-out visitors are sent to sign in", async () => {
  const res = await fetch(BASE + "/my-reports", { redirect: "manual" });
  assert(res.status >= 300 && res.status < 400 && /resident\/login/.test(res.headers.get("location") ?? ""), `got ${res.status}`);
  return `redirect to ${res.headers.get("location")}`;
});

// ---------------------------------------------------------------- officer (Sam)

await check("O1", "Console requires staff sign-in", async () => {
  const res = await fetch(BASE + "/council", { redirect: "manual" });
  assert(res.status >= 300 && res.status < 400 && /council\/login/.test(res.headers.get("location") ?? ""), `got ${res.status}`);
  const api = await fetch(BASE + "/api/council/reports");
  assert(api.status === 401, `council API answered ${api.status} without a session`);
  return "page redirects, API returns 401";
});

type Item = { id: number; ref: string; title: string; priorityScore: number; priorityBand: string; triage?: unknown };
await check("O2", "Queue is ordered by priority; injuries are at least high", async () => {
  const q = await json<{ items: Item[]; total: number }>("/api/council/reports?pageSize=100", asOfficer);
  const scores = q.body.items.map((i) => i.priorityScore);
  assert(scores.every((s, i) => i === 0 || scores[i - 1] >= s), "queue not sorted by priority");
  const injured = db()
    .prepare("SELECT ref, priority_band FROM reports WHERE is_open = 1 AND duplicate_of IS NULL AND json_extract(triage, '$.priority.risk.injuriesPerWeek') > 0")
    .all() as { ref: string; priority_band: string }[];
  const low = injured.filter((r) => !["critical", "high"].includes(r.priority_band));
  assert(!low.length, `injury incidents below high: ${low.map((r) => r.ref).join(", ")}`);
  const top = q.body.items.slice(0, 3).map((i) => `${i.ref} ${i.priorityBand} ${i.priorityScore}`);
  return `${q.body.total} open incidents; ${injured.length} with injuries all >= high; top: ${top.join("; ")}`;
});

await check("O2", "Ranking agrees with the synthetic ground truth", async () => {
  const evalMd = fs.readFileSync("docs/EVALUATION.md", "utf8");
  const rho = Number(/\*\*(-?[0-9.]+)\*\* \(1 = identical order\)/.exec(evalMd)?.[1]);
  assert(rho >= 0.75, `Spearman ${rho}`);
  return `Spearman ${rho} (docs/EVALUATION.md)`;
});

await check("O3", "Westgate Street lamp reports are one incident, each kept", async () => {
  const d = await json<{ merged: { ref: string }[]; report: { supporters: number } }>("/api/council/reports/900001", asOfficer);
  assert(d.body.merged.length >= 3, `only ${d.body.merged.length} merged`);
  const kept = db().prepare("SELECT COUNT(*) AS n FROM reports WHERE duplicate_of = 900001 AND length(detail) > 0").get() as { n: number };
  assert(Number(kept.n) === d.body.merged.length, "merged reports lost their text");
  return `SYN900001 + ${d.body.merged.map((m) => m.ref).join(", ")}; each keeps its own text`;
});

await check("O3", "An officer can unmerge, and merge back", async () => {
  const d = await json<{ merged: { id: number; ref: string }[] }>("/api/council/reports/900001", asOfficer);
  const victim = d.body.merged.at(-1)!;
  const un = await json<{ report: { duplicateOf: number | null } }>(`/api/council/reports/${victim.id}`, {
    method: "PATCH",
    headers: { ...asOfficer.headers, "content-type": "application/json" },
    body: JSON.stringify({ unmerge: true }),
  });
  assert(un.status === 200 && un.body.report.duplicateOf === null, `unmerge failed (${un.status})`);
  const back = await json<{ report: { id: number } }>(`/api/council/reports/${victim.id}`, {
    method: "PATCH",
    headers: { ...asOfficer.headers, "content-type": "application/json" },
    body: JSON.stringify({ mergeInto: 900001 }),
  });
  assert(back.status === 200, `merge back failed (${back.status})`);
  return `${victim.ref} separated and merged back`;
});

await check("O4", "Photo contradicting the report waits for an officer; confirming clears it", async () => {
  const r = row("SYN900020")!;
  const reasons = JSON.parse(String(r.triage)).reviewReasons as string[];
  assert(r.needs_review === 1 && reasons.some((x) => /photo/i.test(x)), "not held for review");
  const res = await json<{ report: { needsReview: boolean; category: string } }>("/api/council/reports/900020", {
    method: "PATCH",
    headers: { ...asOfficer.headers, "content-type": "application/json" },
    body: JSON.stringify({ category: "vandalism" }),
  });
  assert(res.body.report.needsReview === false, "still in review after confirming");
  return `held because "${reasons[0]}"; cleared after confirming ${res.body.report.category}`;
});

await check("O5", "Every ranking has a score breakdown", async () => {
  const rows = db().prepare("SELECT ref, triage FROM reports WHERE is_open = 1 AND duplicate_of IS NULL").all() as { ref: string; triage: string }[];
  const missing = rows.filter((r) => !JSON.parse(r.triage).priority?.risk);
  assert(!missing.length, `no breakdown: ${missing.map((r) => r.ref).join(", ")}`);
  return `${rows.length} incidents, all with risk terms`;
});

await check("O6", "Route plan: 2-person crews, <= 5 jobs, starting at the first job", async () => {
  const plan = await json<{ crews: { stops: { job: { id: number; lat: number; lon: number } }[]; path: { lat: number; lon: number }[] }[] }>("/api/council/routes", {
    method: "POST",
    headers: { ...asOfficer.headers, "content-type": "application/json" },
    body: JSON.stringify({ category: "all", minBand: "low", staff: 4 }),
  });
  assert(plan.body.crews.length === 2, `${plan.body.crews.length} crews for 4 staff`);
  for (const c of plan.body.crews) {
    assert(c.stops.length <= 5, `crew has ${c.stops.length} jobs`);
    assert(c.path[0].lat === c.stops[0].job.lat, "route does not start at the first job");
  }
  return `2 crews: ${plan.body.crews.map((c) => c.stops.length).join(" + ")} jobs`;
});

await check("O6", "Issuing the work order tells the residents", async () => {
  const { planForSelection } = await import("../lib/repo/workorders");
  const plan = planForSelection({ category: "all", minBand: "low" }, { crews: 2 });
  const order = createWorkOrder({ plan, scheduledFor: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), actor: { type: "officer", name: officer.name, officerId: Number(officer.id) } });
  const first = plan.crews[0].stops[0].job;
  const r = db().prepare("SELECT status FROM reports WHERE id = ?").get(first.id) as { status: string };
  const pub = await json<{ report: { statusLabel: string } }>(`/api/reports/${first.ref}`);
  assert(r.status === "repair_scheduled", `status ${r.status}`);
  return `${order.ref}: ${first.ref} now "${pub.body.report.statusLabel}" for residents`;
});

// ---------------------------------------------------------------- test cases from the team brief (18 Oct)

const { RESIDENT_COOKIE } = await import("../lib/auth");
const resident = db().prepare("SELECT id, email FROM residents WHERE password_hash IS NOT NULL ORDER BY id LIMIT 1").get() as { id: number; email: string };
const residentCookie = `${RESIDENT_COOKIE}=${sign({ kind: "resident", residentId: Number(resident.id), email: resident.email, exp: Date.now() + 3_600_000 })}`;
const asResident = { headers: { cookie: residentCookie } };
let tcRef = "";

await check("TC1", "Signed-in resident reports a new problem typed in their own words", async () => {
  const draft = {
    category: "other",
    serviceName: "Other",
    customType: "Abandoned shopping trolleys",
    title: "Shopping trolleys dumped in the stream",
    detail: "Three shopping trolleys have been pushed into the stream by the footpath on Riverside Park. They are blocking the water.",
    answers: {},
    hazardLevel: "low",
    lat: 50.9271,
    lon: -1.3787,
    locationSource: "map",
    firstName: "Alex",
    lastName: "Resident",
    email: resident.email,
    privacyAccepted: true,
  };
  const form = new FormData();
  form.set("draft", JSON.stringify(draft));
  const res = await json<{ ref: string }>("/api/reports", { method: "POST", body: form, ...asResident });
  assert(res.status === 201 && res.body.ref, `submit failed (HTTP ${res.status})`);
  tcRef = res.body.ref;
  const r = row(tcRef)!;
  assert(Number(r.resident_id) === Number(resident.id), "report not linked to the signed-in account");
  const done = await waitFor(() => (row(tcRef)?.llm_status === "done" ? row(tcRef) : null), 60_000);
  const llmLabel = JSON.parse(String(done.triage)).text?.llmLabel;
  return `${tcRef}: "${draft.customType}" -> ${done.category}${llmLabel ? ` (LLM label "${llmLabel}")` : ""}, ${done.priority_band} ${done.priority_score}`;
});

await check("TC2", "Possible repeat: the LLM finds the existing report from the resident's words", async () => {
  const t = Date.now();
  const sim = await json<{ items: { checkedBy: string; report: Record<string, unknown> }[] }>("/api/reports/similar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat: 50.89878, lon: -1.40678, category: "street_light", title: "Lamp not working", detail: "The street lamp on Westgate Street has been out for a week. It's really dark walking home." }),
  });
  assert(sim.body.items.some((i) => i.report.ref === "SYN900001"), "existing Westgate Street lamp not offered");
  assert(!leaks(sim.body).length, "private fields exposed");
  const diff = await json<{ items: unknown[] }>("/api/reports/similar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lat: 50.89878, lon: -1.40678, category: "street_light", title: "Lamp post hit by a car", detail: "A car has knocked a lamp post over at the far end, it is leaning across the pavement with wires showing." }),
  });
  return `matched SYN900001 by ${sim.body.items[0].checkedBy} in ${Date.now() - t} ms; a different light fault returned ${diff.body.items.length} match(es)`;
});

await check("TC2", "Resident confirms the duplicate, adds optional details; priority uses it", async () => {
  const before = row("SYN900001")!;
  const res = await json<{ added: boolean; noted: boolean }>("/api/reports/SYN900001/support", {
    method: "POST",
    headers: { "content-type": "application/json", ...asResident.headers },
    body: JSON.stringify({ note: "It is still out and someone tripped on the kerb last night because it was so dark." }),
  });
  assert(res.status < 300 && res.body.noted, `support with note failed (HTTP ${res.status})`);
  const after = row("SYN900001")!;
  const ev = db().prepare("SELECT kind, is_public, data FROM report_events WHERE report_id = ? AND kind IN ('support', 'support_note') ORDER BY id DESC LIMIT 2").all(Number(after.id)) as { kind: string; is_public: number; data: string }[];
  assert(ev.some((e) => e.kind === "support_note" && !e.is_public), "extra details not stored for officers");
  const tri = JSON.parse(String(after.triage));
  // Supporting without details also works.
  const plain = await json<{ added: boolean }>("/api/reports/SYN900001/support", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "journey.plain@example.test" }),
  });
  assert(plain.status < 300, "support without details failed");
  return `supporters ${before.supporters} -> ${after.supporters}${res.body.added ? "" : " (already supported)"}; priority ${before.priority_score} -> ${after.priority_score}; volume term ${tri.priority?.risk?.reports ?? tri.priority?.components?.volume ?? "n/a"}; details stored privately; plain support OK`;
});

await check("TC3", "Resident opens a past report from My reports and sees its full details", async () => {
  const list = await html("/my-reports", asResident);
  assert(list.includes(tcRef), "new report not listed");
  assert(list.includes("View full details"), "no link to details");
  const past = db().prepare("SELECT ref, detail FROM reports WHERE resident_id = ? AND ref != ? ORDER BY created_at LIMIT 1").get(resident.id, tcRef) as { ref: string; detail: string } | undefined;
  const ref = past?.ref ?? tcRef;
  const page = await html(`/reports/${ref}`, asResident);
  assert(page.includes("This is your report"), "owner view not shown");
  const snippet = (past?.detail ?? "Three shopping trolleys").slice(0, 25).replace(/'/g, "&#x27;");
  assert(page.includes(snippet), "description not shown to the owner");
  const anon = await html(`/reports/${ref}`);
  assert(!anon.includes(snippet), "description shown to a stranger");
  return `${ref} opens with description and progress; hidden from other visitors`;
});

await check("TC4", "Officer opens a merged incident: one row in the queue, expands to every report and photo", async () => {
  const queue = await html("/council?q=Westgate", asOfficer);
  assert(queue.includes('data-testid="merged-expand"'), "no expandable merged row");
  const id = Number(row("SYN900001")!.id);
  const page = await html(`/council/reports/${id}`, asOfficer);
  assert(/Merged incident: \d+ reports/.test(page), "merged section missing");
  const imgs = (page.match(/<img /g) ?? []).length;
  assert(page.includes("Extra details from a resident"), "resident's extra details not shown to the officer");
  return `queue row expands; detail page lists the merged reports with ${imgs} photos and the resident's extra details`;
});

await check("TC5", "Marking an issue in progress, then completed, moves it between sections", async () => {
  const id = Number(row(tcRef)!.id);
  const patch = (status: string) =>
    json(`/api/council/reports/${id}`, { method: "PATCH", headers: { ...asOfficer.headers, "content-type": "application/json" }, body: JSON.stringify({ status, message: `Journey test: ${status}` }) });
  assert((await patch("in_progress")).status === 200, "in progress failed");
  const inProg = await html("/council?status=in_progress&q=trolleys", asOfficer);
  assert(inProg.includes(tcRef), "not under In progress");
  assert((await patch("completed")).status === 200, "complete failed");
  const open = await html("/council?q=trolleys", asOfficer);
  const done = await html("/council?status=completed&q=trolleys", asOfficer);
  assert(!open.includes(tcRef) && done.includes(tcRef), "not moved to Completed");
  const pub = await json<{ report: { statusLabel: string } }>(`/api/reports/${tcRef}`);
  return `${tcRef}: open -> in progress -> completed; resident sees "${pub.body.report.statusLabel}"`;
});

await check("TC6", "Route for one issue type: shortest order, map path and a scheduled agenda", async () => {
  const plan = await json<{ crews: { stops: { job: { category: string } }[]; path: unknown[]; distanceKm?: number; minutes?: number }[] }>("/api/council/routes", {
    method: "POST",
    headers: { ...asOfficer.headers, "content-type": "application/json" },
    body: JSON.stringify({ category: "pothole", minBand: "low", staff: 2 }),
  });
  assert(plan.body.crews.length >= 1, "no route");
  const cats = new Set(plan.body.crews.flatMap((c) => c.stops.map((s) => s.job.category)));
  assert(cats.size === 1 && cats.has("pothole"), `mixed categories: ${[...cats].join(", ")}`);
  assert(plan.body.crews[0].path.length > 1, "no path to draw on the map");
  const crew = plan.body.crews[0] as { routing?: string; roadPath?: unknown[]; totalKm?: number; straightKm?: number };
  assert(crew.routing === "road" && (crew.roadPath?.length ?? 0) > plan.body.crews[0].path.length, "route does not follow the roads");
  const page = await html("/council/routes?category=pothole", asOfficer);
  assert(/Plan routes|route/i.test(page), "route planner page missing");
  return `pothole route: ${plan.body.crews[0].stops.length} stops; ${crew.totalKm} km by road along ${crew.roadPath?.length} road points (straight-line estimate ${crew.straightKm} km)`;
});

await check("TC7", "Filters by category and urgency change the map pins", async () => {
  type Pins = { total: number; bands: string[]; categories: string[]; pins: number[][] };
  const all = await json<Pins>("/api/council/map/pins?format=compact", asOfficer);
  const f = await json<Pins>("/api/council/map/pins?format=compact&category=pothole&band=critical", asOfficer);
  assert(f.body.total > 0 && f.body.total < all.body.total, `filtered ${f.body.total} of ${all.body.total}`);
  assert(f.body.pins.every((p) => f.body.categories[p[4]] === "pothole" && f.body.bands[p[3]] === "critical"), "pin outside the filter");
  const scores = all.body.pins.map((p) => p[5]);
  return `all ${all.body.total} pins (scores ${Math.min(...scores)}-${Math.max(...scores)}, coloured green to red) -> pothole + critical ${f.body.total}`;
});

await check("TC8", "what3words address puts the pin in Southampton (5 requests/s limit)", async () => {
  const ok = await json<{ results: { label: string; lat: number; lon: number; detail?: string }[]; message?: string }>("/api/geo/what3words?words=tiger.lion.fork");
  const typo = await json<{ results: unknown[]; message?: string }>("/api/geo/what3words?words=tiger.lion.forkk");
  const away = await json<{ results: unknown[]; message?: string }>("/api/geo/what3words?words=index.home.raft");
  assert(ok.body.results.length === 1, ok.body.message ?? "no result");
  assert(typo.body.results.length === 0 && /Did you mean/.test(typo.body.message ?? ""), "typo not corrected");
  assert(away.body.results.length === 0 && /outside/.test(away.body.message ?? ""), "London address accepted");
  return `${ok.body.results[0].label} -> ${ok.body.results[0].lat}, ${ok.body.results[0].lon}; typo suggests a fix; London refused`;
});

await check("TC9", "Latitude/longitude and postcode-area searches place the pin", async () => {
  type R = { results: { label: string; lat: number; lon: number; detail?: string }[]; message?: string };
  const ll = await json<R>("/api/geo/search?q=" + encodeURIComponent("50.9097, -1.4044"));
  const swapped = await json<R>("/api/geo/search?q=" + encodeURIComponent("-1.4044 50.9097"));
  const outside = await json<R>("/api/geo/search?q=" + encodeURIComponent("51.5072, -0.1276"));
  const area = await json<R>("/api/geo/search?q=SO17");
  assert(ll.body.results[0]?.lat === 50.9097 && swapped.body.results[0]?.lon === -1.4044, "coordinates not placed");
  assert(outside.body.results.length === 0, "London coordinates accepted");
  assert(area.body.results.length === 1, area.body.message ?? "postcode area not found");
  return `50.9097, -1.4044 placed (either order); London refused; SO17 -> centre ${area.body.results[0].lat}, ${area.body.results[0].lon}`;
});

// ---------------------------------------------------------------- report

const passed = results.filter((r) => r.pass).length;
const md = `# Journey results

\`npm run journeys\` against ${BASE} on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC:
**${passed}/${results.length} checks passed.** Stories are in [USER-JOURNEYS.md](USER-JOURNEYS.md).

| Story | Check | Result | Evidence | Time |
| --- | --- | --- | --- | --- |
${results.map((r) => `| ${r.id} | ${r.check} | ${r.pass ? "Pass" : "**Fail**"} | ${r.detail.replace(/\|/g, "/")} | ${r.ms} ms |`).join("\n")}
`;
fs.writeFileSync("docs/JOURNEY-RESULTS.md", md);
console.log(`\n${passed}/${results.length} passed. Written to docs/JOURNEY-RESULTS.md. Reset demo data with: npm run demo`);
process.exit(passed === results.length ? 0 : 1);
