import { getResident } from "@/lib/auth";
import { publicEvent, publicReport } from "@/lib/public";
import { reportSummary, summaryEvent } from "@/lib/public-summary";
import { getEvents, getReportByRef } from "@/lib/repo/reports";

/**
 * Tracking information for one report. The signed-in reporter gets the full report;
 * everyone else gets only the privacy-safe summary (no description, photos or answers).
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/reports/[ref]">) {
  const { ref } = await ctx.params;
  const report = getReportByRef(ref);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  const resident = await getResident();
  const own = resident !== null && report.residentId === resident.residentId;
  const events = getEvents(report.id, { publicOnly: true });
  return Response.json({
    own,
    report: own ? publicReport(report, { withPhotos: true }) : reportSummary(report),
    timeline: own ? events.map(publicEvent) : events.map(summaryEvent),
  });
}
