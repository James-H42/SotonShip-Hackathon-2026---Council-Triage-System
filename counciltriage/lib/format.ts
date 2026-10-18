/** Display formatting shared by server and client components. */

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });
const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "-";
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "-";
}

/** Current time for request-time rendering (call only after a runtime API such as cookies()). */
export function requestTime(): number {
  return Date.now();
}

export function ageLabel(iso: string, now = Date.now()): string {
  const days = Math.floor((now - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day";
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30)} months`;
  return `${Math.round(days / 365)} years`;
}

export function minutesToHm(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function clockTime(startHour: number, minutesAfter: number): string {
  const total = startHour * 60 + minutesAfter;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(Math.round(total % 60)).padStart(2, "0")}`;
}

const PROFANITY = /\b(f+u+c+k+\w*|shit\w*|bastards?|wankers?|twats?|c+u+n+t+s?)\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PHONE = /(\+44\s?7\d{3}|\b07\d{3})\s?\d{3}\s?\d{3}\b/g;

/** Text shown on public pages: hides contact details and offensive words. */
export function publicText(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(PHONE, "[phone removed]")
    .replace(PROFANITY, (w) => w[0] + "*".repeat(Math.max(1, w.length - 1)));
}
