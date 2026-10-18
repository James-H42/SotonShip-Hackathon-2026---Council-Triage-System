import { cacheLife } from "next/cache";
import { parseWhat3words, type SearchResponse } from "@/lib/geo-search";
import { insideCity, searchPlaces } from "../_lib/external";

type W3wResponse = {
  coordinates?: { lat: number; lng: number };
  nearestPlace?: string;
  words?: string;
  error?: { code: string; message: string };
};
type Suggestion = { words: string; nearestPlace: string; country: string; distanceToFocusKm?: number };

const API = "https://api.what3words.com/v3";
const CITY_CENTRE = { lat: 50.9097, lon: -1.4044 };

// what3words asks for no more than 5 requests per second: space calls at least 200 ms apart.
let nextSlot = 0;
async function w3wSlot() {
  const now = Date.now();
  const wait = Math.max(0, nextSlot - now);
  nextSlot = Math.max(now, nextSlot) + 200;
  if (wait) await new Promise((r) => setTimeout(r, wait));
}

async function w3w<T>(path: string, params: Record<string, string>, key: string): Promise<T & { status: number }> {
  await w3wSlot();
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key, format: "json" })}`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (res.status >= 500) throw new Error(`what3words returned HTTP ${res.status}`);
  return { status: res.status, ...((await res.json()) as T) };
}

async function convert(words: string, key: string) {
  "use cache";
  cacheLife("days");
  return w3w<W3wResponse>("convert-to-coordinates", { words }, key);
}

async function autosuggest(words: string, key: string) {
  "use cache";
  cacheLife("days");
  return w3w<{ suggestions?: Suggestion[]; error?: { code: string; message: string } }>(
    "autosuggest",
    { input: words, "clip-to-country": "GB", focus: `${CITY_CENTRE.lat},${CITY_CENTRE.lon}`, "n-results": "3" },
    key,
  );
}

/**
 * Resolve a what3words address (///word.word.word) to a point, server-side so
 * W3W_API_KEY never reaches the browser. Plans without coordinate conversion
 * (the free tier) fall back to autosuggest: the words are checked and corrected,
 * and the pin goes to the named place nearby for the resident to fine-tune.
 */
export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("words") ?? "";
  const words = parseWhat3words(raw);
  if (!words) {
    return Response.json({ results: [], error: "A what3words address is three words joined by dots, like ///filled.count.soap." } satisfies SearchResponse, {
      status: 400,
    });
  }
  const key = process.env.W3W_API_KEY;
  if (!key) {
    return Response.json(
      {
        results: [],
        error: "what3words is not configured on this server yet. Search for a postcode or street, or tap the map instead.",
      } satisfies SearchResponse,
      { status: 503 },
    );
  }
  try {
    const data = await convert(words, key);
    if (data.coordinates) {
      const p = { lat: data.coordinates.lat, lon: data.coordinates.lng };
      if (!insideCity(p)) {
        return Response.json({ results: [], message: `///${words} is near ${data.nearestPlace ?? "somewhere else"}, outside Southampton City Council's area.` } satisfies SearchResponse);
      }
      return Response.json({ results: [{ label: `///${data.words ?? words}`, detail: data.nearestPlace ? `Near ${data.nearestPlace}` : undefined, ...p, source: "what3words" }] } satisfies SearchResponse);
    }
    if (data.error?.code === "BadWords") return Response.json({ results: [], message: `///${words} is not a valid what3words address. Check the spelling.` } satisfies SearchResponse);
    if (data.error?.code !== "QuotaExceeded") return Response.json({ results: [], message: data.error?.message ?? "what3words could not find that address." } satisfies SearchResponse);

    // Plan without coordinates: autosuggest checks the words and names the nearest place.
    const s = await autosuggest(words, key);
    const list = s.suggestions ?? [];
    const exact = list.find((x) => x.words === words);
    if (!exact) {
      const near = list.filter((x) => (x.distanceToFocusKm ?? 99) <= 10);
      return Response.json({
        results: [],
        message: near.length
          ? `We couldn't find ///${words}. Did you mean ${near.map((x) => `///${x.words} (${x.nearestPlace})`).join(" or ")}?`
          : `///${words} is not a valid what3words address. Check the spelling.`,
      } satisfies SearchResponse);
    }
    if ((exact.distanceToFocusKm ?? 99) > 10) {
      return Response.json({ results: [], message: `///${words} is near ${exact.nearestPlace}, outside Southampton City Council's area.` } satisfies SearchResponse);
    }
    const area = exact.nearestPlace.split(",")[0].trim();
    const place = area && area !== "Southampton" ? (await searchPlaces(area).catch(() => []))[0] : undefined;
    const p = place ? { lat: place.lat, lon: place.lon } : CITY_CENTRE;
    return Response.json({
      results: [
        {
          label: `///${exact.words}`,
          detail: `Near ${exact.nearestPlace}. Approximate: drag the pin to the exact spot.`,
          ...p,
          source: "what3words",
        },
      ],
    } satisfies SearchResponse);
  } catch (err) {
    console.error("[geo/what3words]", err);
    return Response.json({ results: [], error: "what3words is not available right now. Try a postcode or tap the map." } satisfies SearchResponse, { status: 502 });
  }
}
