/**
 * Evaluates the AI triage against the team's synthetic ground truth
 * (data/synthetic/synthetic_ground_truth.csv) and writes docs/EVALUATION.md.
 *
 *   npm run seed && npm run ai:process && npm run ai:eval
 *
 * Compares the local LLM with the keyword baseline (lib/triage/text.ts) on category,
 * injury, vulnerable and urgency; scores duplicate merging (pairwise precision/recall
 * against the expected incidents); and checks the priority formula's ranking of
 * incidents against a ground-truth ordering (Spearman rank correlation).
 */
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}
const { db } = await import("../lib/db");
const { getReport, triageInputFor } = await import("../lib/repo/reports");
const { analyseText } = await import("../lib/triage/text");

type Truth = { id: number; entity: string; scenario: string; category: string; injury: boolean; vulnerable: boolean; urgency: number };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/).filter((l) => l.trim())) {
    const cells: string[] = [];
    let cur = "";
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) {
        cells.push(cur);
        cur = "";
      } else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

const [header, ...body] = parseCsv(fs.readFileSync("data/synthetic/synthetic_ground_truth.csv", "utf8"));
const col = (name: string) => header.indexOf(name);
const truth: Truth[] = body.map((r) => ({
  id: Number(r[col("id")]),
  entity: r[col("expected_entity")],
  scenario: r[col("scenario")],
  category: r[col("expected_category")],
  injury: r[col("expected_injury")] === "1",
  vulnerable: r[col("expected_vulnerable")] === "1",
  urgency: Number(r[col("expected_urgency")]),
}));

// Ground-truth category labels -> what each system should output.
const TAXONOMY: Record<string, string> = {
  "Street lighting": "street_light",
  Potholes: "pothole",
  "Pavements and footpaths": "road_pavement_damage",
  "Fly-tipping": "fly_tipping",
  Graffiti: "vandalism",
  "Rubbish and bins": "litter",
};
const expectedCategory = (c: string) => TAXONOMY[c] ?? "other";
const RELATED = [
  ["pothole", "road_pavement_damage"],
  ["litter", "fly_tipping"],
];
const related = (a: string, b: string) => a === b || RELATED.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

type Row = { t: Truth; llm: Record<string, unknown> | null; base: ReturnType<typeof analyseText>; canonical: number };
const rows: Row[] = [];
for (const t of truth) {
  const r = getReport(t.id);
  if (!r) continue;
  let canonical = r.id;
  for (let i = 0, cur = r; i < 5 && cur.duplicateOf; i++) {
    canonical = cur.duplicateOf;
    cur = getReport(cur.duplicateOf)!;
  }
  const llm = r.triage?.text?.source === "llm" ? (r.triage.text as unknown as Record<string, unknown>) : null;
  rows.push({ t, llm, base: analyseText(triageInputFor(r)), canonical });
}

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : "n/a");
const withLlm = rows.filter((r) => r.llm);
const metric = (pred: (r: Row) => boolean, set = rows) => pct(set.filter(pred).length, set.length);

const baseUrgency = (r: Row) => 1 + Math.round(4 * r.base.severity);
const baseInjury = (r: Row) => r.base.keyFeatures.some((f) => /injur|accident/i.test(f));
const baseVulnerable = (r: Row) => r.base.keyFeatures.some((f) => /vulnerable|children|school/i.test(f));
const catOk = (pred: string, exp: string, strict: boolean) => (strict ? pred === exp : related(pred, exp));

const table = [
  ["Measure", "Keyword baseline", `Local LLM (${(withLlm[0]?.llm?.model as string) ?? "n/a"})`],
  ["Category exact", metric((r) => catOk(r.base.category, expectedCategory(r.t.category), true)), metric((r) => catOk(String(r.llm!.category), expectedCategory(r.t.category), true), withLlm)],
  ["Category exact or adjacent", metric((r) => catOk(r.base.category, expectedCategory(r.t.category), false)), metric((r) => catOk(String(r.llm!.category), expectedCategory(r.t.category), false), withLlm)],
  ["Fine label (LLM label = ground truth)", "n/a", metric((r) => r.llm!.llmLabel === r.t.category || (r.t.category === "Pavements and footpaths" && r.llm!.llmLabel === "Road or pavement damage") || (r.t.category === "Graffiti" && r.llm!.llmLabel === "Graffiti and vandalism") || (r.t.category === "Rubbish and bins" && r.llm!.llmLabel === "Litter and rubbish") || (r.t.category === "Other" && r.llm!.llmLabel === "Other"), withLlm)],
  ["Injury flag", metric((r) => baseInjury(r) === r.t.injury), metric((r) => Boolean(r.llm!.injury) === r.t.injury, withLlm)],
  ["Vulnerable flag", metric((r) => baseVulnerable(r) === r.t.vulnerable), metric((r) => Boolean(r.llm!.vulnerable) === r.t.vulnerable, withLlm)],
  ["Urgency exact (1-5)", metric((r) => baseUrgency(r) === r.t.urgency), metric((r) => Number(r.llm!.urgency) === r.t.urgency, withLlm)],
  ["Urgency within 1", metric((r) => Math.abs(baseUrgency(r) - r.t.urgency) <= 1), metric((r) => Math.abs(Number(r.llm!.urgency) - r.t.urgency) <= 1, withLlm)],
];

// Merging: pairwise precision / recall against the expected incidents.
let tp = 0;
let fp = 0;
let fn = 0;
for (let i = 0; i < rows.length; i++) {
  for (let j = i + 1; j < rows.length; j++) {
    const same = rows[i].t.entity === rows[j].t.entity;
    const merged = rows[i].canonical === rows[j].canonical;
    if (same && merged) tp++;
    else if (!same && merged) fp++;
    else if (same && !merged) fn++;
  }
}
const precision = tp + fp ? tp / (tp + fp) : 1;
const recall = tp + fn ? tp / (tp + fn) : 1;
const incidents = new Set(rows.map((r) => r.canonical)).size;
const entities = new Set(rows.map((r) => r.t.entity)).size;

// Priority ranking: ground-truth incident priority = max urgency, then injuries, vulnerable, size.
const byEntity = new Map<string, Row[]>();
for (const r of rows) byEntity.set(r.t.entity, [...(byEntity.get(r.t.entity) ?? []), r]);
const gt = [...byEntity.entries()].map(([entity, rs]) => {
  const key = Math.max(...rs.map((r) => r.t.urgency)) * 100 + rs.filter((r) => r.t.injury).length * 20 + rs.filter((r) => r.t.vulnerable).length * 10 + rs.length;
  // System score of the incident = highest priority among the canonical reports holding its members.
  const score = Math.max(...rs.map((r) => Number(getReport(r.canonical)?.priorityScore ?? 0)));
  return { entity, scenario: rs[0].t.scenario, key, score };
});
function ranks(values: number[]) {
  const sorted = [...values.keys()].sort((a, b) => values[b] - values[a]);
  const r = new Array<number>(values.length);
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && values[sorted[j + 1]] === values[sorted[i]]) j++;
    for (let k = i; k <= j; k++) r[sorted[k]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
function spearman(a: number[], b: number[]) {
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = ra.reduce((x, y) => x + y, 0) / ra.length;
  const mb = rb.reduce((x, y) => x + y, 0) / rb.length;
  let num = 0;
  let da = 0;
  let dbb = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    dbb += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * dbb);
}
const rho = spearman(
  gt.map((g) => g.key),
  gt.map((g) => g.score),
);

// The original team formula on the same extracted inputs, for comparison:
// 0.05 S' + 0.325 St' + 0.325 λ + 0.2 i/(i+5) + 0.1 (v+0.5)/(i+1); no photo -> St' = 0.
function originalScore(id: number): number {
  const r = getReport(id);
  const risk = r?.triage?.priority.risk;
  if (!r || !risk) return 0;
  const n = Math.max(1, 1 + r.supporters);
  const v = Math.max(0, Math.round(risk.vulnerableTerm * (n + 1) - 0.5));
  const st = risk.imageSeverity ?? 0;
  const sev = Math.max(risk.textSeverity, st);
  const lambda = risk.proximity * sev;
  const i = risk.injuriesPerWeek;
  const raw = 0.05 * risk.textSeverity + 0.325 * st + 0.325 * lambda + 0.2 * (i / (i + 5)) + 0.1 * ((v + 0.5) / (i + 1));
  return sev > 0.9 ? Math.max(raw, 0.6) : raw;
}
const original = [...byEntity.values()].map((rs) => Math.max(...rs.map((r) => originalScore(r.canonical))));
const rhoOriginal = spearman(
  gt.map((g) => g.key),
  original,
);

const timing = db()
  .prepare("SELECT COUNT(*) AS n FROM reports WHERE source = 'synthetic' AND llm_status = 'done'")
  .get() as { n: number };

const md = `# AI evaluation

Generated by \`npm run ai:eval\` on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC against the team's
${rows.length} synthetic reports (${Number(timing.n)} processed by the LLM). Ground truth: \`data/synthetic/synthetic_ground_truth.csv\`.

## Extraction: local LLM vs keyword baseline

| ${table[0].join(" | ")} |
| --- | --- | --- |
${table
  .slice(1)
  .map((r) => `| ${r.join(" | ")} |`)
  .join("\n")}

"Adjacent" counts pothole/road damage and litter/fly-tipping as matching, as the review rules do.

## Duplicate merging

- Expected incidents: ${entities}; incidents after merging: ${incidents}
- Pairwise precision ${Math.round(precision * 100)}% (merged pairs that really are the same problem)
- Pairwise recall ${Math.round(recall * 100)}% (same-problem pairs that were merged)

## Priority ranking

Spearman rank correlation between the system's incident scores and the ground-truth ordering
(max urgency, then injuries, vulnerable people, number of reports): **${rho.toFixed(2)}** (1 = identical order).
The original team formula on the same AI-extracted inputs scores **${rhoOriginal.toFixed(2)}**.

| Incident | Scenario | Score |
| --- | --- | --- |
${gt
  .sort((a, b) => b.score - a.score)
  .map((g) => `| ${g.entity} | ${g.scenario} | ${g.score} |`)
  .join("\n")}
`;
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(process.env.EVAL_OUT ?? path.join("docs", "EVALUATION.md"), md);
console.log(md);
