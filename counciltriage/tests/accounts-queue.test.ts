import { beforeEach, describe, expect, it } from "vitest";
import { db, openDatabase, setDatabase } from "@/lib/db";
import { createResidentReport, dashboardStats, queueNeighbours, searchReports, updateStatus, type NewReportInput } from "@/lib/repo/reports";
import { authenticateResident, createResidentAccount, getResidentAccount } from "@/lib/repo/residents";

const officer = { type: "officer" as const, name: "Officer", officerId: null };

function report(i: number, overrides: Partial<NewReportInput> = {}): NewReportInput {
  return {
    category: i % 2 ? "pothole" : "fly_tipping",
    serviceName: i % 2 ? "Potholes" : "Flytipping",
    title: `Report number ${i}`,
    detail: `Problem number ${i} somewhere in the city`,
    answers:
      i % 2
        ? { pothole_where: "CARRIAGEWAY", pothole_depth_road: i % 3 ? "STANDARD" : "URGENT", pothole_statement: "true" }
        : { waste_types: ["bags"], waste_amount: "single" },
    hazardLevel: (["low", "medium", "high"] as const)[i % 3],
    lat: 50.9 + (i % 7) * 0.005,
    lon: -1.44 + (i % 5) * 0.02,
    locationPrecision: "exact",
    contact: { firstName: "R", lastName: String(i), email: `r${i}@example.test` },
    photos: [],
    ...overrides,
  };
}

beforeEach(() => setDatabase(openDatabase(":memory:")));

describe("resident accounts", () => {
  it("signs in with the right password only, case-insensitively by email", () => {
    const id = createResidentAccount({ email: "Demo@Example.test", firstName: "Alex", lastName: "Morgan", password: "correct horse" });
    expect(authenticateResident("demo@example.test", "correct horse")?.id).toBe(id);
    expect(authenticateResident("demo@example.test", "wrong")).toBeNull();
    expect(getResidentAccount(id)).toMatchObject({ firstName: "Alex", hasPassword: true });
  });

  it("reports made before creating an account stay linked to the same resident", () => {
    const r = createResidentReport(report(1, { contact: { firstName: "Alex", lastName: "Morgan", email: "alex@example.test" } }));
    const id = createResidentAccount({ email: "alex@example.test", firstName: "Alex", lastName: "Morgan", password: "pw-12345" });
    expect(r.residentId).toBe(id);
    expect(searchReports({ residentId: id, status: "all" }).total).toBe(1);
  });
});

describe("dashboard queries", () => {
  beforeEach(() => {
    for (let i = 1; i <= 30; i++) createResidentReport(report(i));
    updateStatus(90_000_003, "completed", { actor: officer });
  });

  it("stats from the single grouped query match direct counts", () => {
    const s = dashboardStats();
    const count = (sql: string) => Number((db().prepare(sql).get() as { n: number }).n);
    expect(s.open).toBe(count("SELECT COUNT(*) AS n FROM reports WHERE status IN ('received','in_progress','repair_scheduled','monitoring')"));
    expect(s.needsReview).toBe(count("SELECT COUNT(*) AS n FROM reports WHERE is_open = 1 AND needs_review = 1"));
    expect(Object.values(s.byBand).reduce((a, b) => a + (b ?? 0), 0)).toBe(s.open);
    expect(s.byCategory.reduce((a, c) => a + c.count, 0)).toBe(s.open);
    expect(s.byBand.critical).toBe(count("SELECT COUNT(*) AS n FROM reports WHERE is_open = 1 AND priority_band = 'critical'"));
  });

  it("two-phase pagination keeps priority order across pages", () => {
    const all = searchReports({ pageSize: 200 }).items.map((r) => r.id);
    const paged = [1, 2, 3].flatMap((page) => searchReports({ pageSize: 10, page }).items.map((r) => r.id));
    expect(paged).toEqual(all.slice(0, 30));
    const scores = searchReports({ pageSize: 200 }).items.map((r) => r.priorityScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("queue navigation walks the same order as the list", () => {
    const ids = searchReports({ category: "pothole", pageSize: 200 }).items.map((r) => r.id);
    const mid = queueNeighbours({ category: "pothole" }, ids[3]);
    expect(mid).toMatchObject({ position: 4, total: ids.length, prevId: ids[2], nextId: ids[4] });
    expect(queueNeighbours({ category: "pothole" }, ids.at(-1)!).nextId).toBeNull();
  });
});
