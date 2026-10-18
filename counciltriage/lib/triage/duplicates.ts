/** Duplicate detection: nearby, same kind of problem, similar wording. */
import { haversineMetres, type LatLon } from "../geo";
import { areRelated } from "./text";

export type DuplicateSubject = LatLon & {
  id: number;
  category: string;
  title: string;
  detail: string;
  createdAt: string;
};

/** Search radius used for nearby lookups and "similar reports" on the resident form. */
export const DUPLICATE_RADIUS_M = 60;
export const DUPLICATE_THRESHOLD = 0.6;

const STOPWORDS = new Set(
  "a an the and or of to in on at for is are was were be been it its this that there here with by from as near outside opposite my our your we i you they has have had not no very just also please road street".split(
    " ",
  ),
);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOPWORDS.has(w))
      .map((w) => w.replace(/(ing|ed|es|s)$/, "")),
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 0-1 likelihood that two reports describe the same problem. */
export function duplicateScore(a: DuplicateSubject, b: DuplicateSubject): { score: number; distanceMetres: number } {
  const distanceMetres = haversineMetres(a, b);
  if (distanceMetres > DUPLICATE_RADIUS_M) return { score: 0, distanceMetres };
  const sameKind = a.category === b.category;
  if (!sameKind && !areRelated(a.category, b.category) && a.category !== "tbc" && b.category !== "tbc") {
    return { score: 0, distanceMetres };
  }
  // Proximity and category alone are not enough: busy streets collect many unrelated reports,
  // so a match also needs similar wording or a close submission date.
  let score = distanceMetres <= 15 ? 0.35 : distanceMetres <= 30 ? 0.25 : 0.15;
  score += sameKind ? 0.2 : 0.05;
  score += 0.5 * jaccard(tokens(`${a.title} ${a.detail}`), tokens(`${b.title} ${b.detail}`));
  const gapDays = Math.abs(new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) / 86_400_000;
  if (gapDays <= 14) score += 0.15;
  else if (gapDays <= 60) score += 0.08;
  else if (gapDays > 365) score *= 0.6;
  return { score: Math.min(1, Math.round(score * 100) / 100), distanceMetres: Math.round(distanceMetres) };
}

