import { officerOrUnauthorized } from "@/lib/auth";
import { searchReports } from "@/lib/repo/reports";
import { parseSearchParams } from "@/lib/search-params";

/** Prioritised report list for officers (same filters as the dashboard URL). */
export async function GET(request: Request) {
  const officer = await officerOrUnauthorized();
  if (officer instanceof Response) return officer;
  const filters = parseSearchParams(new URL(request.url).searchParams);
  const result = searchReports(filters);
  return Response.json({
    ...result,
    items: result.items.map(({ triage, ...r }) => ({ ...r, priorityFactors: triage?.priority.factors ?? [] })),
  });
}
