import { getResident } from "@/lib/auth";
import { reportSummary } from "@/lib/public-summary";
import { addSupporter, getReportByRef, isOpen, upsertResident } from "@/lib/repo/reports";
import { EMAIL_RE } from "@/lib/validation";

/**
 * "I'm reporting this too": joins an existing report instead of creating a duplicate.
 * Never signs anyone in: typing an email address here must not open that person's account.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/reports/[ref]/support">) {
  const { ref } = await ctx.params;
  const report = getReportByRef(ref);
  if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
  if (!isOpen(report) && report.status !== "duplicate") {
    return Response.json({ error: "This report is closed. Please submit a new report if the problem has come back." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as { email?: string; firstName?: string; lastName?: string; note?: string };
  const session = await getResident();
  const email = (body.email ?? session?.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return Response.json({ error: "Enter a valid email address so we can send you updates.", errors: { email: "Enter a valid email address." } }, { status: 422 });

  const residentId = session?.email === email ? session.residentId : upsertResident({ firstName: body.firstName ?? "", lastName: body.lastName ?? "", email });
  const { added, report: canonical } = addSupporter(report.id, email, residentId, typeof body.note === "string" ? body.note : null);
  return Response.json({ added, noted: Boolean(body.note?.trim()), report: reportSummary(canonical) }, { status: added ? 201 : 200 });
}
