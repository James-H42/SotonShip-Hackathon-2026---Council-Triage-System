/**
 * End-to-end data workflow against an in-memory database: resident
 * submission, automatic triage, duplicate handling, officer overrides,
 * external AI results, route planning and work orders.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase, setDatabase } from "@/lib/db";
import {
  addSupporter,
  applyImageAnalysis,
  applyTextAnalysis,
  createResidentReport,
  getEvents,
  getLinkedReports,
  getPhotos,
  getReport,
  integrationQueue,
  mergeReports,
  overrideCategory,
  overridePriority,
  searchReports,
  setModeration,
  unmergeReport,
  updateStatus,
  type NewReportInput,
} from "@/lib/repo/reports";
import { candidateJobs, completeJob, createWorkOrder, planForSelection } from "@/lib/repo/workorders";
import { db } from "@/lib/db";

const officer = { type: "officer" as const, name: "Test Officer", officerId: null };

function newReport(overrides: Partial<NewReportInput> = {}): NewReportInput {
  return {
    category: "pothole",
    serviceName: "Potholes",
    title: "Deep pothole on Portswood Road",
    detail: "Deep pothole in the road outside the shops, dangerous for cyclists.",
    answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "URGENT", pothole_statement: "true" },
    hazardLevel: "high",
    lat: 50.9235,
    lon: -1.3935,
    locationPrecision: "exact",
    contact: { firstName: "Alex", lastName: "Resident", email: "alex@example.test" },
    photos: [],
    ...overrides,
  };
}

beforeEach(() => {
  setDatabase(openDatabase(":memory:"));
});

describe("resident submission and automatic triage", () => {
  it("creates a resident report with a reference, timeline and policy-based priority", () => {
    const r = createResidentReport(newReport());
    expect(r.ref).toBe("SR000001");
    expect(r.source).toBe("resident");
    expect(r.ward).toBe("Portswood");
    expect(r.priorityBand).toBe("critical");
    expect(r.responseTarget).toBe("Within 24 hours");
    expect(r.llmStatus).toBe("queued");
    const events = getEvents(r.id);
    expect(events.map((e) => e.kind)).toEqual(["created", "triage"]);
    expect(getEvents(r.id, { publicOnly: true })).toHaveLength(1);
  });

  it("automatically moves shallow potholes to monitoring with the council policy message", () => {
    const r = createResidentReport(newReport({ answers: { pothole_where: "FOOTWAY", pothole_depth_pavement: "MONITOR", pothole_statement: "true" } }));
    expect(r.status).toBe("monitoring");
    expect(r.priorityBand).toBe("monitor");
    expect(getEvents(r.id, { publicOnly: true }).at(-1)?.message).toMatch(/intervention level/);
  });

  it("suggests duplicates for the same problem nearby and supports merging", () => {
    const first = createResidentReport(newReport());
    const second = createResidentReport(
      newReport({ lat: 50.92352, lon: -1.39352, title: "Pothole Portswood Road", detail: "Deep pothole outside the shops", contact: { firstName: "Sam", lastName: "Other", email: "sam@example.test" } }),
    );
    expect(second.flags.map((f) => f.code)).toContain("possible_duplicate");
    expect(getLinkedReports(second.id).suggested.map((l) => l.report.id)).toContain(first.id);

    const merged = mergeReports(second.id, first.id, officer);
    expect(merged.supporters).toBe(1);
    expect(getReport(second.id)?.status).toBe("duplicate");
    expect(getReport(second.id)?.duplicateOf).toBe(first.id);

    // Updates on the canonical report reach the merged reporter's timeline.
    updateStatus(first.id, "repair_scheduled", { actor: officer, isPublic: true });
    expect(getEvents(second.id, { publicOnly: true }).at(-1)?.message).toMatch(/original report/);
  });

  it("an officer can undo a merge, and the pair is not suggested again", () => {
    const first = createResidentReport(newReport());
    const second = createResidentReport(newReport({ title: "Pothole near the bus stop" }));
    mergeReports(second.id, first.id, officer);
    const separated = unmergeReport(second.id, officer);
    expect(separated.status).toBe("received");
    expect(separated.duplicateOf).toBeNull();
    expect(getReport(first.id)?.supporters).toBe(0);
    expect(getLinkedReports(second.id).suggested.map((l) => l.report.id)).not.toContain(first.id);
  });

  it("'me too' support raises priority and is counted once per email", () => {
    const r = createResidentReport(newReport({ answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "STANDARD", pothole_statement: "true" }, hazardLevel: "low" }));
    const before = r.priorityScore;
    expect(addSupporter(r.id, "neighbour@example.test", null).added).toBe(true);
    expect(addSupporter(r.id, "NEIGHBOUR@example.test", null).added).toBe(false);
    const after = getReport(r.id)!;
    expect(after.supporters).toBe(1);
    // Corroboration term r = 1 - 0.5^((n-1)/2) with weight 0.1: one extra report adds about 3 points.
    expect(after.priorityScore).toBeGreaterThan(before);
  });
});

describe("human in the loop", () => {
  it("officer category and priority overrides stick through re-triage and are logged as feedback", () => {
    const r = createResidentReport(newReport({ category: "other", serviceName: "Other", customType: "something", title: "Problem here", detail: "There is a problem on the corner", answers: {} }));
    expect(r.category).toBe("tbc");
    expect(r.needsReview).toBe(true);
    expect(searchReports({ queue: "review" }).total).toBe(1);

    const confirmed = overrideCategory(r.id, "litter", officer);
    expect(confirmed.category).toBe("litter");
    expect(confirmed.needsReview).toBe(false);

    const prioritised = overridePriority(r.id, 88, officer, "Outside a school");
    expect(prioritised.priorityScore).toBe(88);
    expect(prioritised.priorityBand).toBe("critical");

    const feedback = db().prepare("SELECT field, model_value, officer_value FROM triage_feedback ORDER BY id").all();
    expect(feedback.map((f) => f.field)).toEqual(["category", "priority"]);
    expect(feedback[0]).toMatchObject({ model_value: "tbc", officer_value: "litter" });
  });

  it("marking a report dubious lowers it and genuine clears automatic dubious flags", () => {
    const r = createResidentReport(newReport({ title: "test", detail: "test test test" }));
    expect(r.dubious).toBe(true);
    const genuine = setModeration(r.id, "genuine", officer);
    expect(genuine.dubious).toBe(false);
    const dubious = setModeration(r.id, "dubious", officer);
    expect(dubious.dubious).toBe(true);
  });
});

describe("external AI results", () => {
  it("LLM analysis replaces the baseline and is kept on later re-triage", () => {
    const r = createResidentReport(newReport({ category: "other", serviceName: "Other", customType: "unsure", title: "Mess", detail: "Mess on the pavement", answers: {} }));
    expect(integrationQueue("llm", 10).map((x) => x.id)).toContain(r.id);
    const updated = applyTextAnalysis(r.id, {
      source: "llm",
      model: "test-llm",
      category: "fly_tipping",
      categoryConfidence: 0.9,
      severity: 0.5,
      keyFeatures: ["Blocking pavement"],
      flags: [],
      analysedAt: new Date().toISOString(),
    })!;
    expect(updated.category).toBe("fly_tipping");
    expect(updated.llmStatus).toBe("done");
    expect(updated.triageSource).toBe("llm");
    expect(integrationQueue("llm", 10).map((x) => x.id)).not.toContain(r.id);
    // A later officer action re-triages but keeps the LLM text result.
    updateStatus(r.id, "in_progress", { actor: officer });
    expect(getReport(r.id)?.triage?.text?.model).toBe("test-llm");
  });

  it("image analysis is stored per photo and can raise severity", () => {
    const r = createResidentReport(newReport({ photos: [{ fileName: "resident/test.jpg", mime: "image/jpeg", bytes: 10, sha256: "x" }], hazardLevel: "low", answers: { pothole_where: "CARRIAGEWAY", pothole_depth_road: "STANDARD", pothole_statement: "true" } }));
    expect(r.visionStatus).toBe("queued");
    const photo = getPhotos(r.id)[0];
    const updated = applyImageAnalysis(photo.id, { source: "vision", category: "pothole", categoryConfidence: 0.9, severity: 0.9, analysedAt: new Date().toISOString() })!;
    expect(updated.visionStatus).toBe("done");
    expect(updated.priorityScore).toBeGreaterThan(r.priorityScore);
  });
});

describe("routes and work orders", () => {
  it("plans crews from open reports and issuing a work order updates residents", () => {
    const ids = [
      createResidentReport(newReport()).id,
      createResidentReport(newReport({ lat: 50.9, lon: -1.4, title: "Pothole in Bargate", detail: "Big pothole by the shops", contact: { firstName: "B", lastName: "C", email: "b@example.test" } })).id,
      createResidentReport(newReport({ lat: 50.935, lon: -1.45, title: "Pothole Coxford", detail: "Pothole near roundabout", contact: { firstName: "D", lastName: "E", email: "d@example.test" } })).id,
    ];
    expect(candidateJobs({ category: "pothole", minBand: "high" }).map((j) => j.id).sort()).toEqual([...ids].sort());
    const plan = planForSelection({ category: "pothole", minBand: "high" }, { crews: 2, shiftMinutes: 450 });
    expect(plan.totals.jobs).toBe(3);

    const order = createWorkOrder({ plan, scheduledFor: "2026-10-20", contractor: "Test Contractor", actor: officer });
    expect(order.ref).toMatch(/^WO\d{5}$/);
    for (const id of ids) {
      const r = getReport(id)!;
      expect(r.status).toBe("repair_scheduled");
      expect(r.workOrderId).toBe(order.id);
    }
    // Jobs already on an order cannot be planned or issued again.
    expect(candidateJobs({ category: "pothole", minBand: "high" })).toHaveLength(0);
    expect(() => createWorkOrder({ plan, scheduledFor: "2026-10-21", actor: officer })).toThrow(/Already on another work order/);

    for (const id of ids) completeJob(order.id, id, officer);
    expect(getReport(ids[0])?.status).toBe("completed");
    expect((db().prepare("SELECT status FROM work_orders WHERE id = ?").get(order.id) as { status: string }).status).toBe("completed");
  });
});
