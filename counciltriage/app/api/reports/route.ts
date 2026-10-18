import { after } from "next/server";
import { SOUTHAMPTON_CENTRE } from "@/lib/geo";
import { dispatchNewReport } from "@/lib/integrations/dispatch";
import { publicReport } from "@/lib/public";
import { reportSummary } from "@/lib/public-summary";
import { createResidentReport, searchReports } from "@/lib/repo/reports";
import { STATUS_BY_ID } from "@/lib/statuses";
import { removePhotos, savePhotos, UploadError, type SavedPhoto } from "@/lib/uploads";
import { emptyDraft, validateDraft, type ReportDraft } from "@/lib/validation";
import { parseSearchParams } from "@/lib/search-params";

/** Public search across reports: privacy-safe summaries only. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const filters = parseSearchParams(params, { defaultSort: "newest" });
  const result = searchReports({ ...filters, publicOnly: true, pageSize: Math.min(filters.pageSize ?? 20, 100) });
  return Response.json({ ...result, items: result.items.map((r) => reportSummary(r)) });
}

/**
 * Submit a resident report.
 * Accepts multipart/form-data (`draft` JSON field plus `photos` files) or a JSON body with the draft.
 */
export async function POST(request: Request) {
  let draft: Partial<ReportDraft>;
  let files: File[] = [];
  const type = request.headers.get("content-type") ?? "";
  try {
    if (type.includes("multipart/form-data")) {
      const form = await request.formData();
      draft = JSON.parse(String(form.get("draft") ?? "{}"));
      files = form.getAll("photos").filter((f): f is File => f instanceof File);
    } else {
      draft = await request.json();
    }
  } catch {
    return Response.json({ error: "Could not read the submission." }, { status: 400 });
  }

  const result = validateDraft({ ...emptyDraft(), ...draft, answers: draft.answers ?? {} });
  if (!result.ok) return Response.json({ error: "Some answers need attention.", errors: result.errors }, { status: 422 });

  let photos: SavedPhoto[] = [];
  try {
    photos = await savePhotos(files);
  } catch (err) {
    if (err instanceof UploadError) return Response.json({ error: err.message, errors: { photos: err.message } }, { status: 422 });
    throw err;
  }

  const v = result.value;
  let report;
  try {
    report = createResidentReport({
      category: v.category,
      serviceName: v.serviceName,
      customType: v.customType,
      title: v.title,
      detail: v.detail,
      answers: v.answers,
      hazardLevel: v.hazardLevel,
      lat: v.lat ?? SOUTHAMPTON_CENTRE.lat,
      lon: v.lon ?? SOUTHAMPTON_CENTRE.lon,
      locationText: v.locationText,
      locationPrecision: v.locationPrecision,
      locationSource: v.locationSource,
      contact: v.contact,
      photos,
    });
  } catch (err) {
    await removePhotos(photos);
    throw err;
  }

  // Hand the report to the external LLM / image services (if configured) after responding.
  after(() => dispatchNewReport(report.id));

  return Response.json(
    {
      ref: report.ref,
      status: report.status,
      statusLabel: STATUS_BY_ID[report.status].label,
      responseTarget: report.responseTarget,
      report: publicReport(report),
    },
    { status: 201 },
  );
}
