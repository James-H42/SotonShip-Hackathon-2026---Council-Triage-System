import { describe, expect, it } from "vitest";
import { buildTriageRecord } from "@/lib/triage/combine";
import { duplicateScore } from "@/lib/triage/duplicates";
import { CRITICAL_SCORE, INJURY_FLOOR, RISK, computePriority } from "@/lib/triage/priority";
import { analyseText } from "@/lib/triage/text";
import type { ImageAnalysis, TextAnalysis, TriageInput } from "@/lib/triage/types";

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    id: 1,
    title: "Pothole",
    detail: "Large pothole in the road",
    residentCategory: "pothole",
    serviceName: "Potholes",
    answers: {},
    hazardLevel: null,
    lat: 50.92,
    lon: -1.39,
    hasPhoto: false,
    createdAt: new Date().toISOString(),
    status: "received",
    supporters: 0,
    geoContext: { ward: "Portswood", majorRoad: { name: "A335", distanceMetres: 500 } },
    ...overrides,
  };
}

describe("council pothole policy", () => {
  it("road potholes deeper than 7.5cm are critical with a 24 hour target", () => {
    const p = computePriority({
      input: input({ answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT" } }),
      category: "pothole",
      text: null,
      images: [],
      flags: [],
    });
    expect(p.band).toBe("critical");
    expect(p.score).toBeGreaterThanOrEqual(CRITICAL_SCORE);
    expect(p.responseTarget).toBe("Within 24 hours");
  });

  it("pavement potholes of 2-4cm get the 6 month target", () => {
    const p = computePriority({
      input: input({ answers: { pothole_where: "FOOTWAY", pothole_depth_pavement: "STANDARD" } }),
      category: "pothole",
      text: null,
      images: [],
      flags: [],
    });
    expect(p.responseTarget).toBe("Within 6 months");
    expect(p.band).not.toBe("monitor");
  });

  it("shallow potholes are monitored only", () => {
    const p = computePriority({
      input: input({ answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "MONITOR" }, hazardLevel: "high" }),
      category: "pothole",
      text: null,
      images: [],
      flags: [],
    });
    expect(p.band).toBe("monitor");
    expect(p.responseTarget).toBe("Monitored only");
    expect(p.score).toBeLessThanOrEqual(30);
  });

  it("being on a major road raises priority", () => {
    const base = { category: "pothole" as const, text: null, images: [], flags: [] };
    // λ = p x sev, so proximity only matters for a problem with some severity.
    const off = computePriority({ ...base, input: input({ hazardLevel: "medium" }) });
    const on = computePriority({ ...base, input: input({ hazardLevel: "medium", geoContext: { ward: "Bargate", majorRoad: { name: "A33", distanceMetres: 10 } } }) });
    // λ = 0.5^(d/100) x sev with weight 0.3: 10 m from a key road vs none nearby.
    expect(on.score).toBeGreaterThan(off.score);
    expect(on.risk?.roadDistanceMetres).toBe(10);
    expect(on.factors.some((f) => f.factor.startsWith("Key-road proximity"))).toBe(true);
    const far = computePriority({ ...base, input: input({ hazardLevel: "medium", geoContext: { ward: "Bargate", majorRoad: { name: "A33", distanceMetres: 400 } } }) });
    expect(far.score).toBeLessThan(on.score);
  });
});

describe("baseline text analysis", () => {
  it("extracts severity features from the wording", () => {
    const t = analyseText(input({ detail: "Very deep pothole, dangerous for cyclists. A child fell off her bike." }));
    expect(t.severity).toBeGreaterThan(0.5);
    expect(t.keyFeatures).toEqual(expect.arrayContaining(["Risk to cyclists or riders", "Injury or accident reported"]));
  });

  it("sends unclassifiable 'Other' reports to TBC", () => {
    const t = analyseText(input({ residentCategory: "other", serviceName: "Other", title: "Persistent speeding", detail: "Cars go too fast here every night" }));
    expect(t.category).toBe("tbc");
    expect(t.flags.map((f) => f.code)).toContain("needs_category");
  });

  it("recategorises generic 'Other' reports when the text is clear", () => {
    const t = analyseText(input({ residentCategory: "other", serviceName: "Other", title: "Fly tipping", detail: "Someone dumped a mattress and black bags" }));
    expect(t.category).toBe("fly_tipping");
    expect(t.categoryConfidence).toBeGreaterThanOrEqual(0.6);
  });

  it("flags a mismatch between the chosen category and the description", () => {
    const t = analyseText(input({ residentCategory: "street_light", serviceName: "Street lighting", title: "Graffiti", detail: "Graffiti spray painted all over the wall, vandalised" }));
    expect(t.flags.map((f) => f.code)).toContain("category_mismatch");
  });

  it("flags personal data and test submissions", () => {
    expect(analyseText(input({ detail: "contact me on someone@example.com" })).flags.map((f) => f.code)).toContain("contains_personal_data");
    const test = analyseText(input({ title: "test", detail: "test" }));
    expect(test.flags.find((f) => f.code === "test_submission")?.dubious).toBe(true);
  });

  it("treats swearing as a moderation issue, not a dubious report", () => {
    const t = analyseText(input({ detail: "Some shit has dumped rubbish everywhere" }));
    const flag = t.flags.find((f) => f.code === "abusive_language");
    expect(flag).toBeDefined();
    expect(flag?.dubious).toBeFalsy();
  });
});

describe("combining text and image analysis", () => {
  it("a confident image can recategorise a low-confidence report", () => {
    const i = input({ residentCategory: "other", serviceName: "Other", title: "Problem", detail: "Something on the corner" });
    const record = buildTriageRecord({
      input: i,
      text: analyseText(i),
      images: [{ source: "vision", category: "fly_tipping", categoryConfidence: 0.9, severity: 0.6, analysedAt: new Date().toISOString() }],
      duplicates: [],
    });
    expect(record.category.category).toBe("fly_tipping");
    expect(record.category.source).toBe("vision");
  });

  it("an officer override always wins and clears category review", () => {
    const i = input({ residentCategory: "other", serviceName: "Other", title: "Problem", detail: "Something on the corner" });
    const record = buildTriageRecord({ input: i, text: analyseText(i), images: [], duplicates: [], overrides: { category: "litter" } });
    expect(record.category).toMatchObject({ category: "litter", source: "officer" });
    expect(record.needsReview).toBe(false);
  });

  it("reports outside Southampton are flagged dubious", () => {
    const i = input({ geoContext: { ward: null } });
    const record = buildTriageRecord({ input: i, text: analyseText(i), images: [], duplicates: [] });
    expect(record.dubious).toBe(true);
    expect(record.flags.map((f) => f.code)).toContain("outside_area");
  });
});

describe("duplicate scoring", () => {
  const a = { id: 1, lat: 50.92, lon: -1.39, category: "pothole", title: "Large pothole", detail: "Deep pothole outside the shop", createdAt: "2026-10-01T10:00:00Z" };
  it("same problem reported nearby within days is a duplicate", () => {
    const b = { ...a, id: 2, lat: 50.92005, title: "Pot hole", detail: "Deep pothole outside the shop on the corner", createdAt: "2026-10-03T10:00:00Z" };
    expect(duplicateScore(a, b).score).toBeGreaterThanOrEqual(0.6);
  });
  it("unrelated categories are never duplicates", () => {
    const b = { ...a, id: 2, category: "street_light", title: "Light out", detail: "Street light not working" };
    expect(duplicateScore(a, b).score).toBe(0);
  });
  it("reports far apart are not duplicates", () => {
    const b = { ...a, id: 2, lat: 50.93 };
    expect(duplicateScore(a, b).score).toBe(0);
  });
});

describe("Incident Risk Priority Score", () => {
  const llm = (urgency: number, extra: Partial<TextAnalysis> = {}): TextAnalysis => ({
    source: "llm",
    category: "pothole",
    categoryConfidence: 0.95,
    severity: (urgency - 1) / 4,
    urgency,
    keyFeatures: [],
    flags: [],
    analysedAt: new Date().toISOString(),
    ...extra,
  });
  const photo = (severity: number, uncertainty: number): ImageAnalysis => ({
    source: "vision",
    category: "pothole",
    categoryConfidence: 0.9,
    severity,
    uncertainty,
    analysedAt: new Date().toISOString(),
  });
  const onRoad = { ward: "Portswood", majorRoad: { name: "A335", distanceMetres: 0 } };

  it("both weightings sum to 1", () => {
    for (const w of [RISK.WITH_IMAGE, RISK.NO_IMAGE]) expect(Object.values(w as Record<string, number>).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it("matches the hand calculation for a text-only report", () => {
    // S' = 0.75 (urgency 4), d = 100 m -> p = 0.5, λ = 0.375, no injury, c = 0.5/2 = 0.25, r = 0.
    const p = computePriority({ input: input({ geoContext: { ward: "Portswood", majorRoad: { name: "A335", distanceMetres: 100 } } }), category: "pothole", text: llm(4), images: [], flags: [] });
    expect(p.risk?.raw).toBeCloseTo(0.35 * 0.75 + 0.3 * 0.375 + 0.1 * 0.25, 3);
    expect(p.risk?.imageSeverity).toBeNull();
  });

  it("uses image severity only when the photo is confident", () => {
    const base = { input: input({ geoContext: onRoad }), category: "pothole" as const, text: llm(2), flags: [] };
    const clear = computePriority({ ...base, images: [photo(0.85, 0.2)] });
    const unclear = computePriority({ ...base, images: [photo(0.85, 0.9)] });
    const none = computePriority({ ...base, images: [] });
    expect(clear.risk?.imageSeverity).toBeCloseTo(0.85);
    expect(clear.score).toBeGreaterThan(none.score);
    expect(unclear.score).toBe(none.score);
  });

  it("escalates severity above 0.9 and keeps injuries at least high", () => {
    expect(computePriority({ input: input(), category: "pothole", text: llm(5), images: [], flags: [] }).band).toBe("critical");
    const hurt = computePriority({ input: input(), category: "pothole", text: llm(4, { injury: true }), images: [], flags: [] });
    expect(hurt.score).toBeGreaterThanOrEqual(INJURY_FLOOR);
    expect(hurt.band).toBe("high");
  });

  it("sends a photo that contradicts both the resident and the LLM to officer review", () => {
    const record = buildTriageRecord({
      input: input({ residentCategory: "vandalism", title: "Graffiti", detail: "Tagging on the wall" }),
      text: llm(2, { category: "vandalism" }),
      images: [photo(0.5, 0.2)],
      duplicates: [],
    });
    expect(record.flags.some((f) => f.code === "image_conflict")).toBe(true);
    expect(record.needsReview).toBe(true);
  });
});
