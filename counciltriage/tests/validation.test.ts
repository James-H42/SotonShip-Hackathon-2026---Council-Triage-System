import { describe, expect, it } from "vitest";
import { parseImageAnalysis, parseTextAnalysis, ContractError } from "@/lib/integrations/contracts";
import { emptyDraft, validateDraft, type ReportDraft } from "@/lib/validation";

function draft(overrides: Partial<ReportDraft> = {}): ReportDraft {
  return {
    ...emptyDraft(),
    category: "pothole",
    serviceName: "Potholes",
    title: "Deep pothole on Portswood Road",
    detail: "A deep pothole near the bus stop, dangerous for cyclists.",
    answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT", pothole_statement: "true" },
    hazardLevel: "high",
    lat: 50.9235,
    lon: -1.3935,
    firstName: "Alex",
    lastName: "Resident",
    email: "alex@example.test",
    privacyAccepted: true,
    ...overrides,
  };
}

describe("resident report validation", () => {
  it("accepts a complete pothole report", () => {
    const r = validateDraft(draft());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.locationPrecision).toBe("exact");
  });

  it("requires the depth question that matches road or pavement", () => {
    const r = validateDraft(draft({ answers: { pothole_where: "FOOTWAY", pothole_statement: "true" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty("answers.pothole_depth_pavement");
  });

  it("requires the pothole depth statement", () => {
    const r = validateDraft(draft({ answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT" } }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty("answers.pothole_statement");
  });

  it("rejects locations outside Southampton", () => {
    const r = validateDraft(draft({ lat: 51.5, lon: -0.12 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.location).toMatch(/outside/);
  });

  it("allows a described location without a map point", () => {
    const r = validateDraft(draft({ lat: null, lon: null, noMap: true, locationText: "Outside 12 Portswood Road, by the bus stop" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.locationPrecision).toBe("approximate");
  });

  it("drops answers to questions that do not apply", () => {
    const r = validateDraft(draft({ answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT", pothole_depth_pavement: "MONITOR", pothole_statement: "true", junk: "x" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value.answers).sort()).toEqual(["pothole_depth_road", "pothole_statement", "pothole_where"]);
  });

  it("requires a description of the type for 'something else'", () => {
    const r = validateDraft(draft({ category: "other", serviceName: "Other", customType: "", answers: {} }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveProperty("customType");
  });
});

describe("AI result contracts", () => {
  it("normalises a valid LLM result", () => {
    const a = parseTextAnalysis({ category: "fly_tipping", categoryConfidence: 1.4, severity: "0.6", keyFeatures: ["x"], flags: ["needs_photo"], duplicateOf: ["5", 6] });
    expect(a).toMatchObject({ source: "llm", category: "fly_tipping", categoryConfidence: 1, severity: 0.6, duplicateOf: [5, 6] });
    expect(a.flags[0]).toMatchObject({ code: "needs_photo", source: "llm" });
  });

  it("rejects unknown categories", () => {
    expect(() => parseTextAnalysis({ category: "spaceship", categoryConfidence: 0.5 })).toThrow(ContractError);
    expect(() => parseImageAnalysis({ category: "spaceship", categoryConfidence: 0.5 })).toThrow(ContractError);
  });

  it("accepts an image result with no detected issue", () => {
    expect(parseImageAnalysis({ category: null, categoryConfidence: 0.95, severity: null })).toMatchObject({ category: null, severity: null });
  });
});
