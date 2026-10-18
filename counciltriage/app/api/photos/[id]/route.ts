import fs from "node:fs/promises";
import { getOfficer, getResident } from "@/lib/auth";
import { integrationAuth } from "@/lib/integrations/auth";
import { getPhoto, getReport } from "@/lib/repo/reports";
import { photoPath } from "@/lib/uploads";

/**
 * Report photos are private: only council officers, the resident who made the report,
 * and external AI services (x-integration-key) may fetch them. Other residents never see them.
 */
async function mayView(request: Request, reportId: number): Promise<boolean> {
  if (request.headers.has("x-integration-key")) return (await integrationAuth(request)) === null;
  if (await getOfficer()) return true;
  const resident = await getResident();
  return resident !== null && getReport(reportId)?.residentId === resident.residentId;
}

export async function GET(request: Request, ctx: RouteContext<"/api/photos/[id]">) {
  const { id } = await ctx.params;
  const photo = Number.isInteger(Number(id)) ? getPhoto(Number(id)) : null;
  const file = photo ? photoPath(photo.fileName) : null;
  if (!photo || !file || !(await mayView(request, photo.reportId))) return new Response("Not found", { status: 404 });
  try {
    const bytes = await fs.readFile(file);
    return new Response(bytes, {
      headers: { "content-type": photo.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
