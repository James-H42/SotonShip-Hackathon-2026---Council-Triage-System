/**
 * Runs every open, unprocessed report through the local AI pipeline
 * (image model -> LLM extraction -> priority -> LLM-confirmed merging), oldest first so
 * the first report of a problem becomes the canonical incident.
 *
 *   npm run ai:process                # all open reports not yet processed by the LLM
 *   npm run ai:process -- --all       # re-run the LLM on every open report
 *   npm run ai:process -- --limit 10
 *
 * Needs Ollama (qwen3:8b) and the vision service (npm run ai:vision) running.
 */
import fs from "node:fs";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

const { db } = await import("../lib/db");
const { autoMerge, processReport } = await import("../lib/ai/pipeline");
const { retriage } = await import("../lib/repo/reports");
const { llmAvailable } = await import("../lib/ai/ollama");
const { visionAvailable } = await import("../lib/ai/vision");

const args = process.argv.slice(2);
const all = args.includes("--all");
const limitArg = args.indexOf("--limit");
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : 100_000;

const [llm, vision] = await Promise.all([llmAvailable(), visionAvailable()]);
console.log(`LLM ${llm.model}: ${llm.ok ? "ready" : `unavailable (${llm.detail})`}; vision service: ${vision.ok ? "ready" : `unavailable (${vision.detail})`}`);
if (!llm.ok) process.exit(1);

if (all) db().prepare("UPDATE reports SET llm_status = 'queued' WHERE is_open = 1 AND duplicate_of IS NULL").run();
const ids = (
  db()
    .prepare(
      // Open incidents the LLM has not read, plus any open or merged report whose photos still need the
      // image model (a merged report's photo feeds its incident's image severity).
      `SELECT id FROM reports
       WHERE (is_open = 1 AND duplicate_of IS NULL AND llm_status != 'done')
          OR ((is_open = 1 OR status = 'duplicate') AND vision_status IN ('queued','failed'))
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as { id: number }[]
).map((r) => Number(r.id));

console.log(`Processing ${ids.length} open reports...`);
const started = Date.now();
let merged = 0;
for (const [i, id] of ids.entries()) {
  const t = Date.now();
  await processReport(id);
  const r = db().prepare("SELECT ref, category, priority_score, priority_band, duplicate_of, needs_review FROM reports WHERE id = ?").get(id) as Record<string, unknown>;
  if (r.duplicate_of) merged++;
  console.log(
    `[${i + 1}/${ids.length}] ${r.ref} ${r.category} ${r.priority_band} ${r.priority_score}` +
      `${r.duplicate_of ? ` merged -> ${r.duplicate_of}` : ""}${r.needs_review ? " (review)" : ""} ${Date.now() - t}ms`,
  );
}
// Second pass: join incidents that only became comparable after earlier merges (order effects),
// then recompute every open incident so cluster statistics and priorities are current.
const incidents = (
  db().prepare("SELECT id FROM reports WHERE is_open = 1 AND duplicate_of IS NULL ORDER BY created_at DESC").all() as { id: number }[]
).map((r) => Number(r.id));
let joined = 0;
for (const id of incidents) if (await autoMerge(id, { incidents: true })) joined++;
for (const { id } of db().prepare("SELECT id FROM reports WHERE is_open = 1").all() as { id: number }[]) retriage(Number(id));
console.log(`Sweep: ${joined} incidents joined, open reports re-triaged.`);

const summary = db()
  .prepare(
    `SELECT SUM(is_open AND duplicate_of IS NULL) AS incidents, SUM(status = 'duplicate') AS merged,
       SUM(is_open AND needs_review) AS review, SUM(is_open AND priority_band = 'critical') AS critical
     FROM reports`,
  )
  .get();
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(0)}s, ${merged} merged this run.`, summary);
