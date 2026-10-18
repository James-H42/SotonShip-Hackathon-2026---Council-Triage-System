import { officerOrUnauthorized } from "@/lib/auth";
import { planForSelectionOnRoads } from "@/lib/repo/workorders";
import { routeOptionsFrom } from "@/lib/route-params";

/** Plan crew routes. Body: { category, minBand, wards[], staff, shiftHours, jobsPerCrew, limit } */
export async function POST(request: Request) {
  const officer = await officerOrUnauthorized();
  if (officer instanceof Response) return officer;
  const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  const { selection, options } = routeOptionsFrom(body);
  return Response.json(await planForSelectionOnRoads(selection, options));
}
