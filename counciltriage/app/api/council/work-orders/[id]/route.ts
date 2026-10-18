import { officerOrUnauthorized } from "@/lib/auth";
import { getReportsByIds } from "@/lib/repo/reports";
import { getWorkOrder } from "@/lib/repo/workorders";

/** Machine-readable work order for contractor job-management systems. */
export async function GET(_request: Request, ctx: RouteContext<"/api/council/work-orders/[id]">) {
  const officer = await officerOrUnauthorized();
  if (officer instanceof Response) return officer;
  const { id } = await ctx.params;
  const order = getWorkOrder(Number(id));
  if (!order) return Response.json({ error: "Work order not found" }, { status: 404 });
  const reports = new Map(getReportsByIds(order.plan.crews.flatMap((c) => c.stops.map((s) => s.job.id))).map((r) => [r.id, r]));
  return Response.json({
    ref: order.ref,
    scheduledFor: order.scheduledFor,
    contractor: order.contractor,
    status: order.status,
    notes: order.notes,
    depot: order.plan.options.depot,
    crews: order.plan.crews.map((c) => ({
      crew: c.crew,
      staff: 2,
      totalKm: c.totalKm,
      totalMinutes: c.totalMinutes,
      navigation: c.mapsUrls,
      stops: c.stops.map((s, i) => {
        const r = reports.get(s.job.id);
        return {
          sequence: i + 1,
          reportRef: s.job.ref,
          category: s.job.category,
          priorityBand: s.job.priorityBand,
          title: s.job.title,
          lat: s.job.lat,
          lon: s.job.lon,
          locationText: r?.locationText ?? null,
          arriveMinute: s.arriveMinute,
          jobMinutes: s.job.jobMinutes,
          status: r?.status ?? null,
        };
      }),
    })),
  });
}
