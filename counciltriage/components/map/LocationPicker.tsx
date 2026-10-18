"use client";

/**
 * Resident location picker: Leaflet + OpenStreetMap, locked to the
 * Southampton boundary. Residents can tap the map (and drag the pin), use
 * their current location, or search for a postcode, street/place name or
 * what3words address. Points outside the city are rejected.
 *
 * Client-only: Leaflet is loaded inside an effect (see ./leaflet.ts).
 */
import { SOUTHAMPTON_BOUNDS } from "@/lib/bounds";
import "leaflet/dist/leaflet.css";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import type * as Leaflet from "leaflet";
import { BAND_HEX, buttonStyles, cx, inputStyles } from "@/components/ui";
import { classifyQuery, type GeoResult, type ReverseResponse, type SearchResponse } from "@/lib/geo-search";
import { createBaseMap, inCity, loadBoundary, loadLeaflet, OUTSIDE_CITY_MESSAGE, ROAD_RED, type CityGeo, type L } from "./leaflet";
import type { LatLon, LocationPickerProps } from "./types";

const PIN_COLOUR = "#0e7490";
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

type Notice = { tone: "info" | "error"; text: string; onMap?: boolean } | null;

function pinIcon(L: L) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:30px;height:30px;transform:rotate(-45deg);background:${PIN_COLOUR};border-radius:50% 50% 50% 0;border:3px solid #fff;box-shadow:0 3px 8px rgba(0,0,0,.35)"><span style="display:block;width:10px;height:10px;margin:7px;border-radius:50%;background:#fff"></span></span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 36],
  });
}

export function LocationPicker({ value, onChange, nearby = [], invalid }: LocationPickerProps) {
  const elRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ L: L; map: Leaflet.Map } | null>(null);
  const [mapError, setMapError] = useState(false);
  const [locating, setLocating] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<GeoResult[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [chosen, setChosen] = useState<{ at: LatLon; label: string; detail?: string } | null>(null);
  const [info, setInfo] = useState<{ at: LatLon; data: ReverseResponse | null } | null>(null);
  const flyNext = useRef(false);

  /** Accepts a point only if it is inside the city boundary. */
  const trySet = useCallback(
    async (p: LatLon, label?: { label: string; detail?: string }, fly = false, fromMap = false): Promise<boolean> => {
      const point = { lat: round6(p.lat), lon: round6(p.lon) };
      let city: CityGeo | null = null;
      try {
        city = await loadBoundary();
      } catch {
        // Boundary file unavailable: fall back to the council bounding box.
      }
      const b = SOUTHAMPTON_BOUNDS;
      const inside = city ? inCity(city, point) : point.lat >= b.minLat && point.lat <= b.maxLat && point.lon >= b.minLon && point.lon <= b.maxLon;
      if (!inside) {
        // Taps on the map get an overlay, so the map does not jump under the finger.
        setNotice({ tone: "error", text: OUTSIDE_CITY_MESSAGE, onMap: fromMap });
        return false;
      }
      setNotice(null);
      setChosen(label ? { at: point, ...label } : null);
      flyNext.current = fly;
      onChange(point);
      return true;
    },
    [onChange],
  );
  const trySetRef = useRef(trySet);
  useEffect(() => {
    trySetRef.current = trySet;
  }, [trySet]);

  // Create the map once.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    Promise.all([loadLeaflet(), loadBoundary()])
      .then(([L, city]) => {
        if (cancelled) return;
        map = createBaseMap(L, el, city, { scrollWheelZoom: false }).map;
        map.on("focus", () => map?.scrollWheelZoom.enable());
        map.on("mouseout blur", () => map?.scrollWheelZoom.disable());
        map.on("click", (e: Leaflet.LeafletMouseEvent) => {
          map?.scrollWheelZoom.enable();
          void trySetRef.current({ lat: e.latlng.lat, lon: e.latlng.lng }, undefined, false, true);
        });
        setCtx({ L, map });
      })
      .catch((err) => {
        console.error("Map failed to load", err);
        if (!cancelled) setMapError(true);
      });
    return () => {
      cancelled = true;
      map?.remove();
      setCtx(null);
    };
  }, []);

  // The chosen point's marker (draggable to fine-tune).
  const markerRef = useRef<Leaflet.Marker | null>(null);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);
  useEffect(() => {
    if (!ctx) return;
    const { L, map } = ctx;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    const ll = L.latLng(value.lat, value.lon);
    if (!markerRef.current) {
      const marker = L.marker(ll, { icon: pinIcon(L), draggable: true, autoPan: true, title: "Problem location (drag to adjust)", zIndexOffset: 1000 });
      marker.on("dragend", async () => {
        const p = marker.getLatLng();
        const ok = await trySetRef.current({ lat: p.lat, lon: p.lng }, undefined, false, true);
        if (!ok && valueRef.current) marker.setLatLng([valueRef.current.lat, valueRef.current.lon]);
      });
      markerRef.current = marker.addTo(map);
    }
    const marker = markerRef.current;
    marker.setLatLng(ll);
    if (flyNext.current) {
      flyNext.current = false;
      map.flyTo(ll, Math.max(map.getZoom(), 17), { duration: 0.6 });
    } else if (!map.getBounds().contains(ll)) {
      map.panTo(ll);
    }
  }, [ctx, value]);
  useEffect(() => () => void (markerRef.current = null), [ctx]);

  // Existing reports near the point, for context.
  useEffect(() => {
    if (!ctx || !nearby.length) return;
    const { L, map } = ctx;
    const group = L.layerGroup();
    for (const p of nearby) {
      L.circleMarker([p.lat, p.lon], { radius: 6, color: "#fff", weight: 1.5, fillColor: BAND_HEX[p.priorityBand], fillOpacity: 0.85 })
        .bindTooltip(p.title ? `Already reported: ${p.title}` : "Already reported", { direction: "top" })
        .addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [ctx, nearby]);

  // Address, nearest postcode and key-road check for the chosen point.
  useEffect(() => {
    if (!value) return;
    const controller = new AbortController();
    const at = value;
    const timer = setTimeout(() => {
      fetch(`/api/geo/reverse?lat=${at.lat}&lon=${at.lon}`, { signal: controller.signal })
        .then((r) => (r.ok ? (r.json() as Promise<ReverseResponse>) : null))
        .then((data) => setInfo({ at, data }))
        .catch((err: Error) => {
          if (err.name !== "AbortError") setInfo({ at, data: null });
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  async function search() {
    const q = classifyQuery(query);
    if (!q) {
      setNotice({ tone: "error", text: "Type a postcode or postcode area, street or place name, latitude and longitude, or a what3words address." });
      return;
    }
    setSearching(true);
    setNotice(null);
    setResults([]);
    try {
      const url = q.kind === "what3words" ? `/api/geo/what3words?words=${encodeURIComponent(q.value)}` : `/api/geo/search?q=${encodeURIComponent(query.trim())}`;
      const res = await fetch(url);
      const data = (await res.json()) as SearchResponse;
      if (data.error) setNotice({ tone: "error", text: data.error });
      else if (!data.results.length) setNotice({ tone: "error", text: data.message ?? "No match in Southampton." });
      else if (data.results.length === 1) {
        const r = data.results[0];
        await trySet(r, { label: r.label, detail: r.detail }, true);
        if (r.source === "outcode" && r.detail) setNotice({ tone: "info", text: r.detail });
      } else {
        setResults(data.results);
        setNotice({ tone: "info", text: "Choose the matching place:" });
      }
    } catch {
      setNotice({ tone: "error", text: "Search is not available right now. Tap the map or use your current location instead." });
    } finally {
      setSearching(false);
    }
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      void search();
    }
  }

  function locate() {
    if (!navigator.geolocation) {
      setNotice({ tone: "error", text: "Your browser cannot share your location. Search or tap the map instead." });
      return;
    }
    setLocating(true);
    setNotice(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setLocating(false);
        const ok = await trySet({ lat: pos.coords.latitude, lon: pos.coords.longitude }, { label: "Your current location" }, true);
        if (!ok) setNotice({ tone: "error", text: `Your current location is outside Southampton City Council's area. Search for the place or tap the map instead.` });
      },
      (err) => {
        setLocating(false);
        setNotice({
          tone: "error",
          text: err.code === err.PERMISSION_DENIED ? "Location permission was refused. Search or tap the map instead." : "We could not find your location. Search or tap the map instead.",
        });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  const same = (a: LatLon | null | undefined, b: LatLon | null | undefined) => Boolean(a && b && a.lat === b.lat && a.lon === b.lon);
  const label = chosen && same(chosen.at, value) ? chosen : null;
  const details = info && same(info.at, value) ? info.data : undefined;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="location-search" className="mb-1 block text-sm font-medium text-slate-700">
          Search for a postcode, street or place
        </label>
        <div className="flex gap-2">
          <input
            id="location-search"
            type="search"
            className={cx(inputStyles, "min-w-0 flex-1")}
            placeholder="e.g. SO14 7LY, SO14, Above Bar Street, 50.9097, -1.4044 or ///word.word.word"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
            autoComplete="off"
            enterKeyHint="search"
            aria-describedby="location-search-hint"
          />
          <button type="button" onClick={() => void search()} className={buttonStyles.secondary} disabled={searching}>
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
        <p id="location-search-hint" className="mt-1 text-xs text-slate-500">
          Southampton postcodes (SO14 7LY) or postcode areas (SO14), street or place names, latitude and longitude (50.9097, -1.4044), and what3words addresses (starting ///) work.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={locate} className={buttonStyles.secondary} disabled={locating}>
          {locating ? "Finding you..." : "Use my current location"}
        </button>
      </div>

      <div role="status" aria-live="polite">
        {notice && !notice.onMap && (
          <p className={cx("rounded-md px-3 py-2 text-sm", notice.tone === "error" ? "bg-amber-50 text-amber-900 ring-1 ring-amber-200" : "text-slate-700")} data-testid="location-notice">
            {notice.text}
          </p>
        )}
      </div>
      {results.length > 1 && (
        <ul className="space-y-1.5" data-testid="location-results">
          {results.map((r) => (
            <li key={`${r.lat},${r.lon}`}>
              <button
                type="button"
                className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-sm hover:bg-slate-50"
                onClick={async () => {
                  if (await trySet(r, { label: r.label, detail: r.detail }, true)) setResults([]);
                }}
              >
                <span className="block font-medium text-slate-900">{r.label}</span>
                {r.detail && <span className="block truncate text-xs text-slate-500">{r.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className={cx("overflow-hidden rounded-xl border bg-white", invalid ? "border-red-500 ring-2 ring-red-200" : "border-slate-300")}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-1.5 text-xs text-slate-600">
          <span>Tap the map to mark the problem. Drag the pin to adjust.</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-1 w-4 rounded" style={{ background: ROAD_RED, opacity: 0.7 }} />
            Main roads
          </span>
        </div>
        <div className="relative isolate">
          <div
            ref={elRef}
            className="h-[320px] w-full cursor-crosshair bg-[#e8ece6] sm:h-[400px]"
            role="application"
            aria-label="Map of Southampton. Tap to set the problem location, or use the search box or current location button above."
            data-testid="location-map"
          />
          {notice?.onMap && (
            <div className="absolute inset-x-2 top-2 z-[1000] flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow ring-1 ring-amber-200" role="alert" data-testid="location-notice">
              <span className="flex-1">{notice.text}</span>
              <button type="button" className="-my-1 shrink-0 px-1 text-lg leading-none" aria-label="Dismiss" onClick={() => setNotice(null)}>
                ×
              </button>
            </div>
          )}
          {!ctx && (
            <div className="pointer-events-none absolute inset-0 z-[1000] grid place-items-center p-4 text-center text-sm text-slate-600">
              {mapError ? "The map could not load. Search for the place above, or describe the location below." : "Loading map..."}
            </div>
          )}
        </div>
      </div>

      {value && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700" data-testid="location-details">
          <p className="font-medium text-slate-900">{label?.label ?? details?.address ?? (details === undefined ? "Finding the address..." : "Pin placed")}</p>
          {label && (details?.address || label.detail) && label.label !== details?.address && (
            <p className="text-xs text-slate-500">{details?.address ?? label.detail}</p>
          )}
          {details && (
            <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
              {details.postcode && (
                <li>
                  Nearest postcode: <strong className="text-slate-800">{details.postcode.postcode}</strong>
                  {details.postcode.distanceMetres > 30 && ` (${details.postcode.distanceMetres} m away)`}
                </li>
              )}
              {details.ward && <li>Ward: {details.ward}</li>}
              {details.majorRoad && (
                <li>
                  {details.majorRoad.near ? (
                    <span className="font-medium text-red-700">
                      On or next to a main road: {details.majorRoad.name} ({details.majorRoad.distanceMetres} m)
                    </span>
                  ) : (
                    <>Not on a main road (nearest: {details.majorRoad.name}, {details.majorRoad.distanceMetres} m)</>
                  )}
                </li>
              )}
            </ul>
          )}
          {details === null && <p className="text-xs text-slate-500">Address details are not available right now. The pin is still saved.</p>}
        </div>
      )}
    </div>
  );
}
