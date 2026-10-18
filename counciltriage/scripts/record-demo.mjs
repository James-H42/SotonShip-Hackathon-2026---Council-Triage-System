/**
 * Records the demo video (docs/VIDEO-PLAN.md) against a freshly reset demo.
 *
 *   npm run demo                                        # full reset, serves :3100
 *   PLAYWRIGHT_DIR=/path/with/node_modules/playwright node scripts/record-demo.mjs
 *
 * Playwright drives Chromium with a visible cursor, click ripples, a caption bar and highlight
 * boxes. There is no title or end card: each scene stays on screen long enough to read its
 * caption. Writes a silent docs/StreetTriage-demo.mp4; scripts/narrate-demo.py then adds the
 * English voice-over that reads each caption.
 * Demo logins come from .secrets/demo-accounts.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(process.env.PLAYWRIGHT_DIR ?? ROOT, "package.json"));
const { chromium } = require("playwright");
const BASE = process.env.BASE_URL ?? "http://localhost:3100";
const OUT = path.join(ROOT, "docs/StreetTriage-demo.mp4");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "st-video-"));
const accounts = JSON.parse(fs.readFileSync(path.join(ROOT, ".secrets/demo-accounts.json"), "utf8"));
const W = 1600;
const H = 1000;

// ---------------------------------------------------------------- captions (no audio)

const CAPTIONS = {
  problem: "StreetTriage: Southampton street reports, triaged by local AI. Here is a resident, then a council officer.",
  signin: "Test case 1: a resident signs in to their account",
  pick: "They pick the problem from the list. Their photos' GPS places the pin, and they can click the map to adjust it.",
  details: "A few questions and a short description in their own words",
  sent: "Sent with a reference number. The local AI triages it in the background.",
  repeat: "Test case 2: a report that may be a repeat (a street light on Westgate Street)",
  match: "The local LLM compared their words with nearby reports and found a match. The resident confirms and adds their details.",
  history: "Test case 3: the resident opens a past report to check its details and progress",
  queue: "Test case 4: the officer's queue is sorted by risk. Each issue has photos and a full score breakdown.",
  status: "Test case 5: 'Start processing' moves the issue to the In progress section, and the resident is told",
  merged1: "MERGED REPORTS: several residents reported the same street light. The AI merged them into ONE incident in the queue.",
  merged2: "Expand the incident to see every individual report that was merged into it",
  merged3: "Open it: each original report is kept, with its own words, photos and date",
  merged4: "The resident who confirmed the duplicate added extra details. Officers see them here.",
  map: "Test case 6: the map shows every report from green (low) to red (critical). Filter by issue and urgency.",
  route: "Test case 7: the shortest route between same-type issues. Solid line = real roads, dashed line = straight line.",
  route2: "Booked as a work order: the crew's agenda for the day, with arrival times, and the residents are told",
};
/** Time to read a caption: about 2.8 words a second, at least 4.2 s. */
const readMs = (id) => Math.max(4200, Math.round((CAPTIONS[id].split(/\s+/).length / 2.8) * 1000));

// ---------------------------------------------------------------- browser

const OVERLAY = () => {
  const install = () => {
    if (document.getElementById("__cur")) return;
    const cur = document.createElement("div");
    cur.id = "__cur";
    cur.innerHTML =
      '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2l16 9-7 2-3 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    const pos = JSON.parse(sessionStorage.getItem("__pos") || "[800,500]");
    cur.style.cssText = `position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;transform:translate(${pos[0] - 4}px,${pos[1] - 2}px)`;
    document.documentElement.appendChild(cur);
    addEventListener(
      "mousemove",
      (e) => {
        cur.style.transform = `translate(${e.clientX - 4}px,${e.clientY - 2}px)`;
        sessionStorage.setItem("__pos", JSON.stringify([e.clientX, e.clientY]));
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        const r = document.createElement("div");
        r.style.cssText = `position:fixed;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #f5a524;z-index:2147483646;pointer-events:none;transition:all .45s ease-out;opacity:1`;
        document.documentElement.appendChild(r);
        requestAnimationFrame(() => {
          r.style.transform = "scale(1.8)";
          r.style.opacity = "0";
        });
        setTimeout(() => r.remove(), 500);
      },
      true,
    );
    const cap = document.createElement("div");
    cap.id = "__cap";
    cap.style.cssText =
      "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);max-width:1200px;z-index:2147483645;pointer-events:none;background:rgba(0,25,60,.92);color:#fff;font:600 22px/1.35 system-ui,-apple-system,sans-serif;padding:12px 22px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.3);text-align:center";
    cap.textContent = sessionStorage.getItem("__cap") || "";
    cap.style.display = cap.textContent ? "block" : "none";
    document.documentElement.appendChild(cap);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
};

const browser = await chromium.launch({ headless: true });
// Sign both accounts in off camera, then record with those cookies.
{
  const ctx = await browser.newContext({ viewport: { width: W, height: H } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/council/login`);
  await p.fill('input[type="email"]', accounts.officer.email);
  await p.fill('input[type="password"]', accounts.officer.password);
  await Promise.all([p.waitForURL(/\/council(\?|$)/), p.click('button:has-text("Sign in")')]);
  await ctx.storageState({ path: path.join(TMP, "state.json") });
  await ctx.close();
}
const context = await browser.newContext({
  viewport: { width: W, height: H },
  storageState: path.join(TMP, "state.json"),
  recordVideo: { dir: TMP, size: { width: W, height: H } },
});
await context.addInitScript(OVERLAY);
const page = await context.newPage();
const t0 = Date.now();
const timeline = [];
let current = null;

async function caption(text) {
  await page.evaluate((t) => {
    sessionStorage.setItem("__cap", t);
    const c = document.getElementById("__cap");
    if (c) {
      c.textContent = t;
      c.style.display = t ? "block" : "none";
    }
  }, text);
}
/** Start a scene: its caption goes on screen now. */
async function scene(id) {
  await finish();
  current = { id, start: Date.now() };
  timeline.push({ id, at: Date.now() - t0 });
  await caption(CAPTIONS[id]).catch(() => {});
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s ${id}`);
}
/** Wait until the current caption has been on screen long enough to read (plus a short pause). */
async function finish(pad = 800) {
  if (!current) return;
  const left = readMs(current.id) + pad - (Date.now() - current.start);
  if (left > 0) await page.waitForTimeout(left);
  current = null;
}
async function moveTo(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
  await page.waitForTimeout(120);
}
async function click(locator) {
  await moveTo(locator);
  await locator.click();
}
async function type(locator, text) {
  await click(locator);
  await locator.pressSequentially(text, { delay: 22 });
}
async function scroll(dy, steps = 8) {
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dy / steps);
    await page.waitForTimeout(40);
  }
}
/** Draw an orange box around an element for a few seconds, so viewers know where to look. */
async function highlight(locator) {
  await locator.first().evaluate((el) => {
    const r = el.getBoundingClientRect();
    const box = document.createElement("div");
    box.style.cssText = `position:fixed;left:${r.left - 6}px;top:${r.top - 6}px;width:${r.width + 12}px;height:${r.height + 12}px;border:4px solid #f5a524;border-radius:10px;box-shadow:0 0 0 9999px rgba(0,25,60,.18);z-index:2147483640;pointer-events:none;transition:opacity .4s`;
    document.documentElement.appendChild(box);
    setTimeout(() => (box.style.opacity = "0"), 3600);
    setTimeout(() => box.remove(), 4100);
  });
}
/** Scroll so the element sits in the middle of the screen. */
async function centre(locator) {
  await optional(() => locator.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }), null, { timeout: 4000 }));
  await page.waitForTimeout(900);
}
/** A nice-to-have camera move: skip it rather than stop the recording. */
async function optional(fn) {
  try {
    await fn();
  } catch (err) {
    console.log("  (skipped:", String(err.message).split("\n")[0], ")");
  }
}
const label = (text) => page.locator("label").filter({ hasText: text }).first();
const button = (text) => page.getByRole("button", { name: text }).first();

try {
  // 1. Start page
  await page.goto(`${BASE}/`);
  await scene("problem");
  await page.mouse.move(W / 2, H / 2, { steps: 20 });

  // 3. Resident signs in (password field is masked)
  await finish();
  await page.goto(`${BASE}/resident/login`);
  await scene("signin");
  await type(page.locator('[data-testid="resident-signin"] input[name="email"]'), accounts.resident.email);
  await type(page.locator('[data-testid="resident-signin"] input[name="password"]'), accounts.resident.password);
  await click(page.locator('[data-testid="resident-signin"] button[type="submit"], [data-testid="resident-signin"] button:has-text("Sign in")').first());
  await page.waitForURL((u) => !u.pathname.includes("/login"));

  // 4. New report: pothole on The Avenue, photo GPS, map click
  await click(page.getByRole("link", { name: "Report a problem" }).first());
  await page.waitForURL(/\/report/);
  await scene("pick");
  await click(label(/^Pothole/));
  await click(button("Continue"));
  await page
    .locator('[data-testid="location-photo-input"]')
    .setInputFiles([path.join(ROOT, "data/demo-photos/pothole-the-avenue-1.jpg"), path.join(ROOT, "data/demo-photos/pothole-the-avenue-2.jpg")]);
  await page.waitForTimeout(1500);
  const map = page.locator(".leaflet-container").first();
  await map.scrollIntoViewIfNeeded();
  await scroll(250);
  const mb = await map.boundingBox();
  if (mb) {
    await page.mouse.move(mb.x + mb.width / 2 + 30, mb.y + mb.height / 2 + 18, { steps: 18 });
    await page.mouse.click(mb.x + mb.width / 2 + 30, mb.y + mb.height / 2 + 18);
  }
  await page.waitForTimeout(800);
  await finish();
  await click(button("Continue"));
  await scene("details");
  await click(label(/^Road$/));
  await click(label("More than 7.5cm"));
  await click(label("Larger than a dustbin lid"));
  await click(label("I confirm the information"));
  await click(label("Immediate danger"));
  await type(page.locator("#title"), "Deep pothole on The Avenue by the bus stop");
  await type(page.locator("#detail"), "Deep pothole in the northbound lane by the bus stop. A cyclist came off this morning and hurt their knee.");
  await click(button("Continue"));
  await click(label("I have read how my information"));
  await click(button("Check your report"));
  // A nearby report might look similar: this one is new, so send it as new.
  await page.waitForFunction(() => !document.body.innerText.includes("Checking whether this problem"), null, { timeout: 30000 });
  const different = page.locator('[data-testid="similar-different"]');
  if (await different.isVisible()) await click(different);
  await scene("sent");
  await click(button("Send report"));
  await page.waitForURL(/\/report\/submitted\//, { timeout: 20000 });
  await page.mouse.move(W / 2, 380, { steps: 15 });

  // 5. Possible repeat: Westgate Street light
  await finish();
  await page.goto(`${BASE}/report`);
  await scene("repeat");
  await click(label(/^Street light/));
  await click(button("Continue"));
  await type(page.getByPlaceholder(/SO14 7LY/), "SO14 2AY");
  await page.keyboard.press("Enter");
  await page.getByText("Is it one of these?").waitFor({ timeout: 15000 });
  await scroll(350);
  await page.waitForTimeout(600);
  await click(page.locator('[data-testid="not-duplicate"], button:has-text("Continue")').last());
  await click(label("Not working"));
  await click(label("Just one"));
  await click(label("Could cause injury or damage"));
  await type(page.locator("#title"), "Lamp not working on Westgate Street");
  await type(page.locator("#detail"), "The street lamp by the old town walls has been out for a week. It is really dark walking home.");
  await click(button("Continue"));
  await click(label("I have read how my information"));
  await click(button("Check your report"));
  await page.locator('[data-testid="same-add-details"]').first().waitFor({ timeout: 40000 });
  await scene("match");
  await page.waitForTimeout(1800);
  await click(page.locator('[data-testid="same-add-details"]').first());
  await page.locator('[data-testid="similar-done"]').waitFor({ timeout: 15000 });
  await page.mouse.move(500, 330, { steps: 15 });

  // 6. My reports: open a past report
  await finish();
  await click(page.getByRole("link", { name: "My reports" }).first());
  await page.waitForURL(/my-reports/);
  await scene("history");
  await scroll(300);
  await click(page.locator('[data-testid="view-report"]').nth(1));
  await page.waitForTimeout(1200);
  await scroll(350);

  // 7. Officer: queue, then Alex's pothole and its score breakdown
  await finish();
  await page.goto(`${BASE}/council`);
  await scene("queue");
  const pothole = page.getByRole("link", { name: "Deep pothole on The Avenue by the bus stop" }).first();
  await moveTo(pothole);
  await page.waitForTimeout(900);
  await click(pothole);
  await page.waitForURL(/\/council\/reports\/\d+/);
  await page.waitForTimeout(800);
  const risk = page.locator('[data-testid="risk-terms"] summary');
  if (await risk.count()) {
    await click(risk.first());
    await page.waitForTimeout(600);
  }
  await scroll(250);

  // 8. Status change: start processing, then the In progress tab
  await finish();
  await scene("status");
  await scroll(-2000, 4);
  await click(page.locator('[data-testid="quick-actions"] button', { hasText: "Start processing" }));
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/council`);
  await click(page.locator('[data-testid="tab-in_progress"]'));
  await page.waitForURL(/status=in_progress/);
  await moveTo(page.getByRole("link", { name: "Deep pothole on The Avenue by the bus stop" }).first());

  // 9. Merged reports: one row in the queue, expanded, then the incident page
  await finish();
  await page.goto(`${BASE}/council?q=Westgate`);
  await scene("merged1");
  const mergedRow = page.locator("tr", { has: page.locator('[data-testid="merged-expand"]') }).first();
  await highlight(mergedRow);
  await moveTo(mergedRow.locator('[data-testid="merged-expand"] summary'));
  await scene("merged2");
  await click(mergedRow.locator('[data-testid="merged-expand"] summary'));
  await highlight(mergedRow.locator('[data-testid="merged-expand"]'));
  await page.waitForTimeout(1200);
  await scene("merged3");
  await click(mergedRow.locator("a").first());
  await page.waitForURL(/\/council\/reports\/\d+/);
  const mergedCard = page.locator("section, div").filter({ has: page.getByText(/Merged incident: \d+ reports of this problem/) }).last();
  await optional(() => page.getByText(/Merged incident: \d+ reports of this problem/).filter({ visible: true }).first().scrollIntoViewIfNeeded({ timeout: 4000 }));
  await scroll(-120, 3);
  await optional(() => highlight(mergedCard));
  await page.waitForTimeout(1500);
  await scroll(450, 12);
  await page.waitForTimeout(1500);
  await scroll(450, 12);
  await scene("merged4");
  await optional(async () => {
    const extra = page.getByText("Extra details from a resident").filter({ visible: true }).first();
    await extra.scrollIntoViewIfNeeded({ timeout: 4000 });
    await highlight(extra);
  });
  await page.waitForTimeout(800);

  // 10. Map: all reports green to red, chip filter, then urgency filter
  await finish();
  await page.goto(`${BASE}/council?status=all`);
  await scene("map");
  await page.locator('[data-testid="map-category-chips"]').waitFor({ timeout: 30000 });
  await centre(page.locator('[data-testid="city-map"]').first());
  await page.waitForTimeout(1500);
  await click(page.locator('[data-testid="map-category-chips"] button', { hasText: "Pothole" }).first());
  await page.waitForTimeout(1500);
  await click(page.locator('select[aria-label="Priority"]'));
  await page.locator('select[aria-label="Priority"]').selectOption("critical");
  await click(button("Apply"));
  await page.waitForURL(/band=critical/);
  await page.locator('[data-testid="map-category-chips"], [data-testid="city-map"]').first().waitFor();
  await page.waitForTimeout(1500);

  // 11. Route planner: potholes, plan, schedule the work order
  await finish();
  await click(page.getByRole("link", { name: "Route planner" }).first());
  await page.waitForURL(/\/council\/routes/);
  await scene("route");
  const routeForm = page.locator('[data-testid="route-form"]');
  await routeForm.waitFor({ timeout: 15000 });
  await click(routeForm.locator('select[name="category"]'));
  await routeForm.locator('select[name="category"]').selectOption("pothole");
  await click(button("Plan routes"));
  await page.waitForURL(/plan=1/);
  await page.waitForTimeout(1200);
  await centre(page.locator('[data-testid="city-map"]').first());
  await page.waitForTimeout(1500);
  await optional(() => highlight(page.locator('[data-testid="city-map"]').first()));
  await page.waitForTimeout(3500);
  await finish();
  const create = page.getByRole("button", { name: /Create work order/ }).first();
  await moveTo(create);
  await click(create);
  await page.waitForURL(/\/council\/work-orders\/\d+/, { timeout: 20000 });
  await scene("route2");
  await page.waitForTimeout(1500);
  await scroll(500, 12);
  await page.waitForTimeout(1500);

  await finish();
  await caption("");
} catch (err) {
  console.error("Recording stopped:", err);
  await page.screenshot({ path: path.join(TMP, "failure.png") }).catch(() => {});
  console.error("Screenshot:", path.join(TMP, "failure.png"));
  process.exitCode = 1;
}

const video = await page.video().path();
await context.close();
await browser.close();
if (process.exitCode) process.exit(1);

// ---------------------------------------------------------------- encode (silent)

execFileSync(
  "ffmpeg",
  ["-y", "-i", video, "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30", "-movflags", "+faststart", OUT],
  { stdio: "inherit" },
);
fs.writeFileSync(path.join(TMP, "timeline.json"), JSON.stringify(timeline, null, 1));
console.log(`Wrote ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)} s recorded). Scene log: ${path.join(TMP, "timeline.json")}`);
