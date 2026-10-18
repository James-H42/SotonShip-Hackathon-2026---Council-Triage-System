"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CategoryIcon } from "@/components/icons";
import { LocationPicker } from "@/components/map/LocationPicker";
import type { LatLon, MapPin } from "@/components/map/types";
import { buttonStyles, cx, inputStyles, StatusBadge } from "@/components/ui";
import { loadBoundary, inCity } from "@/components/map/leaflet";
import { readJpegGps } from "@/lib/exif";
import { formatDate } from "@/lib/format";
import { choosePhotoLocation, type PhotoLocationDecision } from "@/lib/photo-location";
import type { ReportStatus } from "@/lib/statuses";
import {
  CATEGORIES,
  CATEGORY_BY_ID,
  HAZARD_LEVELS,
  describeAnswers,
  isCategoryId,
  visibleQuestions,
  type Question,
} from "@/lib/taxonomy";
import {
  emptyDraft,
  inSouthampton,
  validateCategory,
  validateContact,
  validateDetails,
  validateLocation,
  type FieldErrors,
  type ReportDraft,
} from "@/lib/validation";

// Index 0 is unused so step numbers match what residents see (1-5).
const STEPS = ["", "The problem", "Location", "Details", "Your details", "Check and send"] as const;
const LAST_STEP = STEPS.length - 1;
const MAX_PHOTOS = 3;
const MAX_DIMENSION = 1600;

/** `gps` is read from the original file, before resizing strips the EXIF data. */
type Photo = { id: string; file: File; preview: string; gps: LatLon | null };
/** Privacy-safe summary from /api/reports/nearby: no description, photos or contact details. */
type NearbyItem = {
  distanceMetres: number;
  report: { ref: string; title: string; categoryLabel: string; approxLocation: string; status: ReportStatus; createdAt: string; lat: number; lon: number; supporters: number };
};

function stepForField(field: string): number {
  if (["category", "serviceName", "customType"].includes(field)) return 1;
  if (["location", "locationText"].includes(field)) return 2;
  if (["firstName", "lastName", "email", "phone", "privacyAccepted"].includes(field)) return 4;
  return 3;
}

/** Downscale large phone photos in the browser before upload. */
async function shrinkImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1.5 * 1024 * 1024) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  } catch {
    return file;
  }
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm font-medium text-red-700">
      {message}
    </p>
  );
}

function ErrorSummary({ errors }: { errors: FieldErrors }) {
  const entries = Object.entries(errors);
  if (!entries.length) return null;
  return (
    <div role="alert" className="mb-6 rounded-lg border-2 border-red-600 bg-red-50 p-4" tabIndex={-1}>
      <h2 className="font-semibold text-red-800">There is a problem</h2>
      <ul className="mt-2 list-disc pl-5 text-sm text-red-800">
        {entries.map(([field, msg]) => (
          <li key={field}>
            <a href={`#field-${field.replace(/\./g, "-")}`} className="underline">
              {msg}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionField({ q, value, error, onChange }: { q: Question; value: string | string[] | undefined; error?: string; onChange: (v: string | string[]) => void }) {
  const id = `field-answers-${q.id}`;
  const errId = `${id}-error`;
  if (q.type === "text") {
    return (
      <div id={id}>
        <label htmlFor={`${id}-input`} className="block font-medium text-slate-900">
          {q.label}
        </label>
        {q.hint && <p className="text-sm text-slate-500">{q.hint}</p>}
        <input
          id={`${id}-input`}
          className={cx(inputStyles, "mt-2 max-w-sm", error && "border-red-600")}
          value={(value as string) ?? ""}
          maxLength={q.maxLength}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errId : undefined}
        />
        <FieldError id={errId} message={error} />
      </div>
    );
  }
  if (q.type === "confirm") {
    return (
      <div id={id} className={cx("rounded-lg border p-4", error ? "border-red-600 bg-red-50" : "border-slate-200 bg-slate-50")}>
        <label className="flex gap-3 text-sm text-slate-800">
          <input
            type="checkbox"
            className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
            checked={value === "true"}
            onChange={(e) => onChange(e.target.checked ? "true" : "")}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errId : undefined}
          />
          <span>{q.label}</span>
        </label>
        <FieldError id={errId} message={error} />
      </div>
    );
  }
  const multiple = q.type === "checkbox-group";
  const selected = Array.isArray(value) ? value : value ? [value] : [];
  return (
    <fieldset id={id} aria-describedby={error ? errId : undefined}>
      <legend className="font-medium text-slate-900">
        {q.label}
        {!q.required && <span className="font-normal text-slate-500"> (optional)</span>}
      </legend>
      {q.hint && <p className="text-sm text-slate-500">{q.hint}</p>}
      <FieldError id={errId} message={error} />
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {q.options!.map((o) => {
          const checked = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={cx(
                "flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 text-sm",
                checked ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-300 bg-white hover:border-slate-400",
              )}
            >
              <input
                type={multiple ? "checkbox" : "radio"}
                name={q.id}
                value={o.value}
                checked={checked}
                className="mt-0.5 h-4 w-4 shrink-0 accent-brand-600"
                onChange={(e) => {
                  if (!multiple) onChange(o.value);
                  else onChange(e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value));
                }}
              />
              <span>
                <span className="font-medium text-slate-900">{o.label}</span>
                {o.hint && <span className="block text-slate-500">{o.hint}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function Section({ title, children, onChange }: { title: string; children: ReactNode; onChange?: () => void }) {
  return (
    <div className="border-b border-slate-200 py-4 last:border-0">
      <div className="flex items-start justify-between gap-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        {onChange && (
          <button type="button" onClick={onChange} className={buttonStyles.ghost}>
            Change
          </button>
        )}
      </div>
      <div className="mt-1 text-sm text-slate-700">{children}</div>
    </div>
  );
}

export type WizardAccount = { firstName: string; lastName: string; email: string; phone: string } | null;

function PhotoLocationNotice({ decision, applied }: { decision: PhotoLocationDecision | null; applied: boolean }) {
  if (!decision || (decision.source === "map" && decision.reason === "no_gps")) return null;
  let text: string;
  if (decision.source === "photo") {
    text = applied
      ? `We've used the location saved in your photo${decision.photos > 1 ? "s" : ""} as the place of the problem. If that's wrong, move the pin on the map in the Location step.`
      : "Your photo has a location, but you moved the pin, so we'll use your pin.";
  } else if (decision.reason === "photos_disagree") {
    text = `Your photos were taken in different places (about ${decision.spreadMetres} m apart), so we'll use the location you chose on the map.`;
  } else {
    text = "The location saved in your photo is outside Southampton, so we'll use the location you chose on the map.";
  }
  return (
    <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700" role="status" data-testid="photo-location">
      {text}
    </p>
  );
}

export function ReportWizard({ account }: { account: WizardAccount }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState<ReportDraft>(() => ({
    ...emptyDraft(),
    ...(account ? { firstName: account.firstName, lastName: account.lastName, email: account.email, phone: account.phone } : {}),
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // draft.lat/lon is always the resident's own pin; a usable photo location is applied on top of it.
  const [photoDecision, setPhotoDecision] = useState<PhotoLocationDecision | null>(null);
  // Moving the pin after a photo set the location means the resident knows better.
  const [preferMap, setPreferMap] = useState(false);
  const [nearby, setNearby] = useState<{ loading: boolean; items: NearbyItem[]; checked: boolean }>({ loading: false, items: [], checked: false });
  const [place, setPlace] = useState<{ ward: string | null; inSouthampton: boolean; majorRoad?: { name: string; distanceMetres: number } | null } | null>(null);
  const [supportRef, setSupportRef] = useState<string | null>(null);
  const [supportState, setSupportState] = useState<{ status: "idle" | "sending" | "done" | "error"; message?: string; ref?: string }>({ status: "idle" });
  const [supportNote, setSupportNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "sending" | "done" | "error">("idle");
  // LLM check on the Check and send step: does the finished report match an open one?
  const [similar, setSimilar] = useState<{ items: NearbyItem[]; dismissed: boolean; key: string }>({ items: [], dismissed: false, key: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [step]);

  const pinPoint: LatLon | null = draft.lat !== null && draft.lon !== null && draft.lat !== "" && draft.lon !== "" ? { lat: Number(draft.lat), lon: Number(draft.lon) } : null;
  // A usable photo location wins over the pin, unless the resident has moved the pin since.
  const usePhotoPoint = photoDecision?.source === "photo" && !preferMap;
  const point: LatLon | null = photoDecision?.source === "photo" && usePhotoPoint ? photoDecision.point : pinPoint;
  const locationSource = usePhotoPoint ? "photo" : "map";
  const category = isCategoryId(draft.category) ? CATEGORY_BY_ID[draft.category] : null;

  // Look up ward and existing reports whenever the point or category changes.
  useEffect(() => {
    if (!point) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setNearby((n) => ({ ...n, loading: true }));
      try {
        const qs = `lat=${point.lat}&lon=${point.lon}`;
        const [geoRes, nearRes] = await Promise.all([
          fetch(`/api/geo/lookup?${qs}`, { signal: controller.signal }),
          fetch(`/api/reports/nearby?${qs}&radius=150${draft.category ? `&category=${draft.category}` : ""}`, { signal: controller.signal }),
        ]);
        setPlace(await geoRes.json());
        const data = (await nearRes.json()) as { items: NearbyItem[] };
        setNearby({ loading: false, items: data.items ?? [], checked: true });
      } catch (err) {
        if ((err as Error).name !== "AbortError") setNearby({ loading: false, items: [], checked: true });
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lon, draft.category]);

  // On "Check and send", ask the local LLM whether this report matches an open one nearby.
  const similarKey = point && step === LAST_STEP ? `${point.lat},${point.lon},${draft.category},${draft.title},${draft.detail}` : "";
  useEffect(() => {
    if (!similarKey || !point || supportState.status === "done" || similar.key === similarKey) return;
    const controller = new AbortController();
    fetch("/api/reports/similar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lat: point.lat, lon: point.lon, category: draft.category, title: draft.title, detail: draft.detail }),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d: { items?: NearbyItem[] }) => setSimilar({ items: d.items ?? [], dismissed: false, key: similarKey }))
      .catch((err) => {
        if ((err as Error).name !== "AbortError") setSimilar({ items: [], dismissed: false, key: similarKey });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [similarKey]);

  const similarLoading = Boolean(similarKey) && similar.key !== similarKey && supportState.status !== "done";

  // Photo GPS: decide whenever the photos change (lib/photo-location.ts has the rules).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const points = photos.map((p) => p.gps);
      if (!points.some(Boolean)) return setPhotoDecision(null);
      const city = await loadBoundary().catch(() => null);
      const inArea = (pt: LatLon) => (city ? inCity(city, pt) : inSouthampton(pt.lat, pt.lon));
      if (!cancelled) setPhotoDecision(choosePhotoLocation(points, inArea));
    })();
    return () => {
      cancelled = true;
    };
  }, [photos]);

  const hasPoint = point !== null;
  const nearbyPins: MapPin[] = useMemo(
    () =>
      (hasPoint ? nearby.items : []).map((n, i) => ({
        id: i,
        ref: n.report.ref,
        lat: n.report.lat,
        lon: n.report.lon,
        category: draft.category,
        priorityBand: "low",
        title: n.report.title,
      })),
    [nearby.items, draft.category, hasPoint],
  );

  function update<K extends keyof ReportDraft>(key: K, value: ReportDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const next = { ...e };
      delete next[key as string];
      return next;
    });
  }

  function setAnswer(id: string, value: string | string[]) {
    setDraft((d) => ({ ...d, answers: { ...d.answers, [id]: value } }));
    setErrors((e) => {
      const next = { ...e };
      delete next[`answers.${id}`];
      return next;
    });
  }

  function validateStep(s: number): FieldErrors {
    if (s === 1) return validateCategory(draft);
    // A location from the photos' GPS counts as a location.
    if (s === 2) return validateLocation({ ...draft, lat: point?.lat ?? null, lon: point?.lon ?? null });
    if (s === 3) return validateDetails(draft);
    if (s === 4) {
      const e = validateContact(draft);
      return e;
    }
    return {};
  }

  function next() {
    const e = validateStep(step);
    setErrors(e);
    if (Object.keys(e).length) {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setStep((s) => Math.min(s + 1, LAST_STEP));
    window.scrollTo({ top: 0 });
  }

  function back() {
    setErrors({});
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0 });
  }

  async function addPhotos(files: FileList | null) {
    if (!files) return;
    setPhotoError(null);
    const room = MAX_PHOTOS - photos.length;
    const chosen = Array.from(files).slice(0, room);
    if (files.length > room) setPhotoError(`You can attach up to ${MAX_PHOTOS} photos.`);
    const added: Photo[] = [];
    for (const f of chosen) {
      if (!["image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"].includes(f.type) && !f.type.startsWith("image/")) {
        setPhotoError("Photos must be image files (JPEG, PNG, WebP or GIF).");
        continue;
      }
      const gps = f.type === "image/jpeg" ? readJpegGps(await f.arrayBuffer()) : null;
      const small = await shrinkImage(f);
      if (small.size > 5 * 1024 * 1024) {
        setPhotoError("Each photo must be under 5MB.");
        continue;
      }
      added.push({ id: crypto.randomUUID(), file: small, preview: URL.createObjectURL(small), gps });
    }
    setPreferMap(false);
    setPhotos((p) => [...p, ...added]);
  }

  function removePhoto(id: string) {
    setPhotos((p) => {
      const target = p.find((x) => x.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return p.filter((x) => x.id !== id);
    });
  }

  async function support(ref: string, note?: string) {
    setSupportState({ status: "sending" });
    try {
      const res = await fetch(`/api/reports/${ref}/support`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: draft.email, firstName: draft.firstName, lastName: draft.lastName, note }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSupportState({ status: "error", message: data.error ?? "Something went wrong." });
        return;
      }
      setSupportState({ status: "done", ref: data.report.ref, message: data.added ? undefined : "You had already added your support to this report." });
      if (note) setNoteState("done");
    } catch {
      setSupportState({ status: "error", message: "We could not reach the server. Try again." });
    }
  }

  async function sendSupportNote() {
    if (!supportState.ref || !supportNote.trim()) return;
    setNoteState("sending");
    const res = await fetch(`/api/reports/${supportState.ref}/support`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: draft.email, firstName: draft.firstName, lastName: draft.lastName, note: supportNote }),
    }).catch(() => null);
    setNoteState(res?.ok ? "done" : "error");
  }

  async function submit() {
    const all = {
      ...validateCategory(draft),
      ...validateLocation({ ...draft, lat: point?.lat ?? null, lon: point?.lon ?? null }),
      ...validateDetails(draft),
      ...validateContact(draft),
    };
    if (Object.keys(all).length) {
      setErrors(all);
      setStep(stepForField(Object.keys(all)[0]));
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = new FormData();
      body.set("draft", JSON.stringify({ ...draft, lat: point?.lat ?? null, lon: point?.lon ?? null, locationSource }));
      for (const p of photos) body.append("photos", p.file, p.file.name);
      const res = await fetch("/api/reports", { method: "POST", body });
      const data = await res.json();
      if (res.status === 201) {
        router.push(`/report/submitted/${data.ref}`);
        return;
      }
      if (data.errors) {
        setErrors(data.errors);
        setStep(stepForField(Object.keys(data.errors)[0]));
      }
      setSubmitError(data.error ?? "Your report could not be sent.");
    } catch {
      setSubmitError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const progress = Math.round(((step - 1) / (LAST_STEP - 1)) * 100);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <p className="text-sm font-medium text-brand-700">
          Step {step} of {LAST_STEP}
          <span className="text-slate-500"> · {progress}% complete</span>
        </p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200" aria-hidden>
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
        <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-2xl font-semibold text-slate-900 outline-none sm:text-3xl">
          {step === 1 ? "What is the problem?" : STEPS[step]}
        </h1>
      </div>

      <ErrorSummary errors={errors} />

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        {step === 1 && (
          <div className="space-y-6">
            <fieldset id="field-category">
              <legend className="font-medium text-slate-900">What kind of problem are you reporting?</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {CATEGORIES.map((c) => (
                  <label
                    key={c.id}
                    className={cx(
                      "flex cursor-pointer gap-3 rounded-xl border p-4",
                      draft.category === c.id ? "border-brand-600 bg-brand-50 ring-1 ring-brand-600" : "border-slate-300 hover:border-slate-400",
                    )}
                  >
                    <input
                      type="radio"
                      name="category"
                      value={c.id}
                      checked={draft.category === c.id}
                      onChange={() => {
                        setDraft((d) => ({
                          ...d,
                          category: c.id,
                          serviceName: c.services.length === 1 ? c.services[0] : "",
                          answers: d.category === c.id ? d.answers : {},
                        }));
                        setErrors({});
                      }}
                      className="sr-only"
                    />
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-xl text-scc-navy">
                      <CategoryIcon category={c.id} />
                    </span>
                    <span>
                      <span className="block font-semibold text-slate-900">{c.label}</span>
                      <span className="text-sm text-slate-600">{c.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {category && category.services.length > 1 && category.id !== "other" && (
              <QuestionField
                q={{ id: "service", label: "Which best describes it?", type: "radio", required: true, options: category.services.map((s) => ({ value: s, label: s })) }}
                value={draft.serviceName}
                error={errors.serviceName}
                onChange={(v) => update("serviceName", v as string)}
              />
            )}
            {category?.id === "other" && (
              <div id="field-serviceName">
                <label htmlFor="service-select" className="block font-medium text-slate-900">
                  Which best describes it?
                </label>
                <select
                  id="service-select"
                  className={cx(inputStyles, "mt-2 max-w-md", errors.serviceName && "border-red-600")}
                  value={draft.serviceName}
                  onChange={(e) => update("serviceName", e.target.value)}
                >
                  <option value="">Choose an option</option>
                  {category.services.map((s) => (
                    <option key={s} value={s}>
                      {s === "Other" ? "Something not listed here" : s}
                    </option>
                  ))}
                </select>
                <FieldError id="service-error" message={errors.serviceName} />
                {draft.serviceName === "Other" && (
                  <div className="mt-4" id="field-customType">
                    <label htmlFor="custom-type" className="block font-medium text-slate-900">
                      What kind of problem is it?
                    </label>
                    <input
                      id="custom-type"
                      className={cx(inputStyles, "mt-2 max-w-md", errors.customType && "border-red-600")}
                      value={draft.customType}
                      onChange={(e) => update("customType", e.target.value)}
                      placeholder="For example: blocked drain, broken bench"
                      maxLength={80}
                    />
                    <FieldError id="custom-type-error" message={errors.customType} />
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div id="field-location">
              <p className="text-slate-700">Mark where the {category?.label.toLowerCase() ?? "problem"} is. Use your current location if you are there now, or click the map.</p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <label className={cx(buttonStyles.secondary, "cursor-pointer")}>
                  Use my photo&apos;s location
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    data-testid="location-photo-input"
                    onChange={(e) => {
                      void addPhotos(e.target.files);
                      e.target.value = "";
                    }}
                  />
                </label>
                <span className="text-sm text-slate-500">Photos taken with location turned on can set the place for you. They are added to your report.</span>
              </div>
              <PhotoLocationNotice decision={photoDecision} applied={usePhotoPoint} />
              <div className="mt-4">
                <LocationPicker
                  value={point}
                  onChange={(v) => {
                    if (usePhotoPoint) setPreferMap(true);
                    setDraft((d) => ({ ...d, lat: v?.lat ?? null, lon: v?.lon ?? null }));
                    setErrors((e) => {
                      const n = { ...e };
                      delete n.location;
                      return n;
                    });
                  }}
                  nearby={nearbyPins}
                  invalid={Boolean(errors.location)}
                />
              </div>
              <FieldError id="location-error" message={errors.location} />
              {point && (
                <p className="mt-2 text-sm text-slate-600" data-testid="location-readout">
                  Selected point: {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
                  {place?.ward && <> · {place.ward} ward</>}
                  {place && !place.inSouthampton && <span className="font-medium text-red-700"> · outside Southampton</span>}
                </p>
              )}
            </div>

            <div id="field-locationText">
              <label htmlFor="location-text" className="block font-medium text-slate-900">
                Describe the exact location {draft.noMap ? "" : <span className="font-normal text-slate-500">(optional)</span>}
              </label>
              <p className="text-sm text-slate-500">For example: outside number 12, by the bus stop, or 20 metres from the junction with Park Road.</p>
              <textarea
                id="location-text"
                className={cx(inputStyles, "mt-2", errors.locationText && "border-red-600")}
                rows={2}
                maxLength={300}
                value={draft.locationText}
                onChange={(e) => update("locationText", e.target.value)}
              />
              <FieldError id="location-text-error" message={errors.locationText} />
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" className="h-4 w-4 accent-brand-600" checked={draft.noMap} onChange={(e) => update("noMap", e.target.checked)} />I cannot
                use the map. I will describe the location instead.
              </label>
            </div>

            {point && category && (
              <section aria-live="polite" className="rounded-xl border-2 border-brand-100 bg-slate-50 p-4" data-testid="duplicate-check">
                <h2 className="font-semibold text-slate-900">Is it one of these?</h2>
                {nearby.loading && <p className="mt-2 text-sm text-slate-600">Checking for {category.label.toLowerCase()} reports nearby...</p>}
                {!nearby.loading && nearby.checked && nearby.items.length === 0 && (
                  <p className="mt-2 text-sm text-slate-600" data-testid="no-nearby">
                    No open {category.label.toLowerCase()} reports within 150 metres. Carry on to make a new report.
                  </p>
                )}
                {!nearby.loading && nearby.items.length > 0 && supportState.status !== "done" && (
                  <>
                    <p className="mt-1 text-sm text-slate-600">
                      These open {category.label.toLowerCase()} reports are close to your pin. If one is the same problem, add your support instead: it raises
                      the priority and you get the same updates.
                    </p>
                    <ul className="mt-3 space-y-2" data-testid="nearby-list">
                      {nearby.items.slice(0, 5).map((n) => (
                        <li key={n.report.ref} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 gap-3">
                              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-lg text-scc-navy" aria-hidden>
                                <CategoryIcon category={category.id} />
                              </span>
                              <div className="min-w-0">
                                <p className="font-medium text-slate-900">{n.report.title}</p>
                                <p className="text-xs text-slate-500">
                                  {n.report.approxLocation} · {n.distanceMetres} m from your pin · reported {formatDate(n.report.createdAt)}
                                  {n.report.supporters > 0 && ` · ${n.report.supporters + 1} people`}
                                </p>
                              </div>
                            </div>
                            <StatusBadge status={n.report.status} />
                          </div>
                          {supportRef !== n.report.ref ? (
                            <button
                              type="button"
                              className={cx(buttonStyles.small, "mt-2")}
                              onClick={() => {
                                setSupportRef(n.report.ref);
                                setSupportState({ status: "idle" });
                                if (account) support(n.report.ref);
                              }}
                            >
                              Yes — add my support to this report
                            </button>
                          ) : (
                            !account && (
                              <div className="mt-3 rounded-lg bg-brand-50 p-3">
                                <label htmlFor="support-email" className="block text-sm font-medium text-slate-900">
                                  Your email address, so we can send you updates
                                </label>
                                <div className="mt-2 flex flex-wrap gap-2">
                                  <input
                                    id="support-email"
                                    type="email"
                                    className={cx(inputStyles, "max-w-xs")}
                                    value={draft.email}
                                    onChange={(e) => update("email", e.target.value)}
                                    autoComplete="email"
                                  />
                                  <button type="button" className={buttonStyles.primary} disabled={supportState.status === "sending"} onClick={() => support(n.report.ref)}>
                                    {supportState.status === "sending" ? "Adding..." : "Add my support"}
                                  </button>
                                </div>
                              </div>
                            )
                          )}
                          {supportRef === n.report.ref && supportState.status === "sending" && account && <p className="mt-2 text-sm text-slate-600">Adding your support...</p>}
                          {supportRef === n.report.ref && supportState.status === "error" && <p className="mt-2 text-sm text-red-700">{supportState.message}</p>}
                        </li>
                      ))}
                    </ul>
                    <button type="button" className={cx(buttonStyles.secondary, "mt-3")} onClick={next} data-testid="not-duplicate">
                      No, mine is different — continue
                    </button>
                  </>
                )}
                {supportState.status === "done" && (
                  <div className="mt-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="support-done">
                    <p className="font-semibold">Thank you. Your support has been added to {supportState.ref}.</p>
                    {supportState.message && <p>{supportState.message}</p>}
                    <p className="mt-1">
                      You do not need to make a new report. We will send updates to {draft.email || "your email address"}.{" "}
                      <Link href={`/reports/${supportState.ref}`} className="font-medium underline">
                        Follow this report
                      </Link>
                      .
                    </p>
                    <SupportNote note={supportNote} setNote={setSupportNote} state={noteState} onSend={sendSupportNote} />
                  </div>
                )}
              </section>
            )}
          </div>
        )}

        {step === 3 && category && (
          <div className="space-y-6">
            {category.id === "pothole" && (
              <p className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
                Council policy: potholes deeper than 7.5cm in a road, or 4cm on a pavement, are repaired within 24 hours. Shallower ones are repaired within 6
                months or monitored.
              </p>
            )}
            {visibleQuestions(category.id, draft.answers).map((q) => (
              <QuestionField key={q.id} q={q} value={draft.answers[q.id]} error={errors[`answers.${q.id}`]} onChange={(v) => setAnswer(q.id, v)} />
            ))}

            <QuestionField
              q={{ id: "hazard", label: "How serious is it?", type: "radio", required: true, options: HAZARD_LEVELS.map((h) => ({ value: h.value, label: h.label, hint: h.hint })) }}
              value={draft.hazardLevel}
              error={errors.hazardLevel}
              onChange={(v) => update("hazardLevel", v as string)}
            />

            <div id="field-title">
              <label htmlFor="title" className="block font-medium text-slate-900">
                Give your report a short title
              </label>
              <input
                id="title"
                className={cx(inputStyles, "mt-2", errors.title && "border-red-600")}
                value={draft.title}
                maxLength={120}
                placeholder={category.id === "pothole" ? "Deep pothole outside 12 Portswood Road" : `${category.label} on ...`}
                onChange={(e) => update("title", e.target.value)}
              />
              <FieldError id="title-error" message={errors.title} />
            </div>

            <div id="field-detail">
              <label htmlFor="detail" className="block font-medium text-slate-900">
                Describe the problem
              </label>
              <p className="text-sm text-slate-500">What is wrong, how long it has been there, and who it affects. Do not include personal information.</p>
              <textarea
                id="detail"
                rows={5}
                className={cx(inputStyles, "mt-2", errors.detail && "border-red-600")}
                value={draft.detail}
                maxLength={3000}
                onChange={(e) => update("detail", e.target.value)}
              />
              <p className="mt-1 text-right text-xs text-slate-500">{draft.detail.length}/3000</p>
              <FieldError id="detail-error" message={errors.detail} />
            </div>

            <div id="field-photos">
              <p className="font-medium text-slate-900">
                Photos <span className="font-normal text-slate-500">(optional, up to {MAX_PHOTOS})</span>
              </p>
              <p className="text-sm text-slate-500">A clear photo helps us assess the problem. Large photos are reduced in size before upload.</p>
              <div className="mt-3 flex flex-wrap gap-3">
                {photos.map((p) => (
                  <div key={p.id} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.preview} alt="Selected photo" className="h-28 w-28 rounded-lg border border-slate-200 object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(p.id)}
                      className="absolute -right-2 -top-2 rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white"
                      aria-label="Remove photo"
                    >
                      Remove
                    </button>
                  </div>
                ))}
                {photos.length < MAX_PHOTOS && (
                  <label className="flex h-28 w-28 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-center text-sm font-medium text-brand-700 hover:border-brand-500">
                    Add photo
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      onChange={(e) => {
                        addPhotos(e.target.files);
                        e.target.value = "";
                      }}
                      data-testid="photo-input"
                    />
                  </label>
                )}
              </div>
              <FieldError id="photos-error" message={photoError ?? errors.photos} />
              <PhotoLocationNotice decision={photoDecision} applied={usePhotoPoint} />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-5">
            {account ? (
              <p className="rounded-lg bg-brand-50 p-3 text-sm text-scc-navy">
                You are signed in, so we have filled in your details. Check they are still right.
              </p>
            ) : (
              <p className="text-slate-700">
                We use these details to send you updates and to contact you if we need more information. They are never shown publicly.
              </p>
            )}
            <details className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-semibold text-scc-navy">How we use your information</summary>
              <p className="mt-2">
                We use your report to deal with the problem and may email you about it. Your details are shared with council departments or contractors
                only when needed. Other residents only see the type of problem, its approximate location and its progress: never your description,
                photos, name or contact details. Your report is checked by AI that runs on council computers, not by an outside AI service. If someone is
                in danger right now, call 999.
              </p>
            </details>
            <div className="grid gap-4 sm:grid-cols-2">
              {(
                [
                  ["firstName", "First name", "given-name", "text"],
                  ["lastName", "Surname", "family-name", "text"],
                ] as const
              ).map(([key, label, auto, type]) => (
                <div key={key} id={`field-${key}`}>
                  <label htmlFor={key} className="block font-medium text-slate-900">
                    {label}
                  </label>
                  <input
                    id={key}
                    type={type}
                    autoComplete={auto}
                    className={cx(inputStyles, "mt-2", errors[key] && "border-red-600")}
                    value={draft[key]}
                    onChange={(e) => update(key, e.target.value)}
                  />
                  <FieldError id={`${key}-error`} message={errors[key]} />
                </div>
              ))}
            </div>
            <div id="field-email">
              <label htmlFor="email" className="block font-medium text-slate-900">
                Email address
              </label>
              <p className="text-sm text-slate-500">We will send your reference number and updates to this address.</p>
              <input
                id="email"
                type="email"
                autoComplete="email"
                className={cx(inputStyles, "mt-2 max-w-md", errors.email && "border-red-600")}
                value={draft.email}
                onChange={(e) => update("email", e.target.value)}
              />
              <FieldError id="email-error" message={errors.email} />
            </div>
            <div id="field-privacyAccepted" className={cx("rounded-lg border p-4", errors.privacyAccepted ? "border-red-600 bg-red-50" : "border-slate-200 bg-slate-50")}>
              <label className="flex gap-3 text-sm text-slate-800">
                <input
                  type="checkbox"
                  className="mt-0.5 h-5 w-5 shrink-0 accent-brand-600"
                  checked={draft.privacyAccepted}
                  onChange={(e) => update("privacyAccepted", e.target.checked)}
                />
                <span>I have read how my information will be used, and the details in this report are true to the best of my knowledge.</span>
              </label>
              <FieldError id="privacy-error" message={errors.privacyAccepted} />
            </div>
          </div>
        )}

        {step === 5 && category && (
          <div>
            {(similarLoading || (similar.items.length > 0 && !similar.dismissed) || supportState.status === "done") && (
              <section aria-live="polite" className={cx("mb-6 rounded-xl border-2 p-4", supportState.status === "done" ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50")} data-testid="similar-check">
                {similarLoading && <p className="text-sm text-slate-700">Checking whether this problem has already been reported...</p>}
                {!similarLoading && supportState.status !== "done" && similar.items.length > 0 && (
                  <>
                    <h2 className="font-semibold text-slate-900">This looks like a problem that has already been reported</h2>
                    <p className="mt-1 text-sm text-slate-700">Is it the same as yours? If so, your report is joined to it: it raises its priority, and you get the same updates.</p>
                    <ul className="mt-3 space-y-2" data-testid="similar-list">
                      {similar.items.map((n) => (
                        <li key={n.report.ref} className="rounded-lg border border-slate-200 bg-white p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium text-slate-900">{n.report.title}</p>
                              <p className="text-xs text-slate-500">
                                {n.report.ref} · {n.report.approxLocation} · {n.distanceMetres} m from your pin · reported {formatDate(n.report.createdAt)}
                                {n.report.supporters > 0 && ` · ${n.report.supporters + 1} people`}
                              </p>
                            </div>
                            <StatusBadge status={n.report.status} />
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button type="button" className={buttonStyles.primary} disabled={supportState.status === "sending"} onClick={() => support(n.report.ref, `${draft.title}. ${draft.detail}`.trim())} data-testid="same-add-details">
                              Yes, it&apos;s the same: add my details to it
                            </button>
                            <button type="button" className={buttonStyles.secondary} disabled={supportState.status === "sending"} onClick={() => support(n.report.ref)} data-testid="same-support-only">
                              Yes, just add my support
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {supportState.status === "error" && <p className="mt-2 text-sm text-red-700">{supportState.message}</p>}
                    <button type="button" className={cx(buttonStyles.small, "mt-3")} onClick={() => setSimilar((x) => ({ ...x, dismissed: true }))} data-testid="similar-different">
                      No, mine is different: send it as a new report
                    </button>
                  </>
                )}
                {supportState.status === "done" && (
                  <div className="text-sm text-emerald-900" data-testid="similar-done">
                    <p className="font-semibold">Thank you. Your report has been joined to {supportState.ref}.</p>
                    {supportState.message && <p>{supportState.message}</p>}
                    <p className="mt-1">
                      {noteState === "done" ? "Your details were added for the council officer. " : ""}You do not need to send a new report.{" "}
                      <Link href={`/reports/${supportState.ref}`} className="font-medium underline">
                        Follow this report
                      </Link>
                      .
                    </p>
                    {noteState !== "done" && <SupportNote note={supportNote} setNote={setSupportNote} state={noteState} onSend={sendSupportNote} />}
                  </div>
                )}
              </section>
            )}
            <Section title="The problem" onChange={() => setStep(1)}>
              {category.label}
              {category.services.length > 1 && draft.serviceName && draft.serviceName !== "Other" && ` · ${draft.serviceName}`}
              {draft.customType && ` · ${draft.customType}`}
            </Section>
            <Section title="Location" onChange={() => setStep(2)}>
              {point ? `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}${place?.ward ? ` (${place.ward})` : ""}` : "No map location"}
              {locationSource === "photo" && <span className="ml-1 text-slate-500">· from your photo</span>}
              {draft.locationText && <p className="mt-1">{draft.locationText}</p>}
            </Section>
            <Section title="Details" onChange={() => setStep(3)}>
              <p className="font-medium">{draft.title}</p>
              <p className="mt-1 whitespace-pre-line">{draft.detail}</p>
              <dl className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
                {describeAnswers(category.id, draft.answers).map((a) => (
                  <div key={a.question} className="contents">
                    <dt className="text-slate-500">{a.question}</dt>
                    <dd>{a.answer}</dd>
                  </div>
                ))}
                <dt className="text-slate-500">How serious</dt>
                <dd>{HAZARD_LEVELS.find((h) => h.value === draft.hazardLevel)?.label}</dd>
                <dt className="text-slate-500">Photos</dt>
                <dd>{photos.length ? `${photos.length} attached` : "None"}</dd>
              </dl>
            </Section>
            <Section title="Your details" onChange={() => setStep(4)}>
              {draft.firstName} {draft.lastName} · {draft.email}
              {draft.phone && ` · ${draft.phone}`}
            </Section>
            {submitError && (
              <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-800">
                {submitError}
              </p>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-6">
          {step > 1 ? (
            <button type="button" onClick={back} className={buttonStyles.secondary}>
              Previous
            </button>
          ) : (
            <span />
          )}
          {(step === 2 || step === LAST_STEP) && supportState.status === "done" ? (
            <Link href="/resident" className={buttonStyles.primary}>
              Done
            </Link>
          ) : step < LAST_STEP ? (
            <button type="button" onClick={next} className={buttonStyles.primary}>
              {step === LAST_STEP - 1 ? "Check your report" : "Continue"}
            </button>
          ) : (
            <button type="button" onClick={submit} className={buttonStyles.primary} disabled={submitting}>
              {submitting ? "Sending..." : "Send report"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Optional extra details after confirming a duplicate: the resident does not have to add any. */
function SupportNote({ note, setNote, state, onSend }: { note: string; setNote: (v: string) => void; state: "idle" | "sending" | "done" | "error"; onSend: () => void }) {
  if (state === "done") return <p className="mt-3 font-medium" data-testid="support-note-done">Thanks, your extra details were added for the council officer.</p>;
  return (
    <div className="mt-3">
      <label htmlFor="support-note" className="block font-medium text-slate-900">
        Anything to add? <span className="font-normal text-slate-500">(optional)</span>
      </label>
      <p className="text-xs text-slate-600">For example, it has got worse, or someone was hurt. Only council officers see this.</p>
      <textarea id="support-note" className={cx(inputStyles, "mt-1")} rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} />
      <button type="button" className={cx(buttonStyles.small, "mt-2")} disabled={!note.trim() || state === "sending"} onClick={onSend} data-testid="support-note-send">
        {state === "sending" ? "Adding..." : "Add these details"}
      </button>
      {state === "error" && <p className="mt-1 text-red-700">That did not work. Try again.</p>}
    </div>
  );
}
