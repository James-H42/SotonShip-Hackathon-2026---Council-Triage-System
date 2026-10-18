"use client";

/**
 * Officer city map (dashboard, report detail, route planner, work orders).
 *
 * Leaflet + OpenStreetMap tiles, locked to the Southampton boundary, with the
 * red key-roads overlay. Pins are canvas circle markers coloured on a green-to-red
 * scale by priority score (band colour when there is no score), so thousands stay fast. Leaflet loads client-only (see ./leaflet.ts).
 */
import "leaflet/dist/leaflet.css";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import { BAND_HEX } from "@/components/ui";
import { categoryLabel } from "@/lib/taxonomy";
import type { PriorityBand } from "@/lib/triage/types";
import { BRAND_NAVY, createBaseMap, loadBoundary, loadLeaflet, ROAD_RED, type L } from "./leaflet";
import type { LatLon, MapPanelProps, MapPin } from "./types";

const RADIUS: Record<PriorityBand, number> = { critical: 7, high: 6, medium: 5, low: 4.5, monitor: 4 };
const pinScale = (zoom: number) => (zoom < 12.5 ? 0.55 : zoom < 13.5 ? 0.75 : zoom < 15 ? 0.9 : 1);
const DRAW_ORDER: PriorityBand[] = ["monitor", "low", "medium", "high", "critical"];

/** Priority score 0-100 to a colour from green (low) through amber to red (critical). */
export function severityHex(score: number) {
  const t = Math.min(1, Math.max(0, score / 85));
  return `hsl(${Math.round(125 * (1 - t))} ${Math.round(70 + 15 * t)}% ${Math.round(40 + 6 * Math.sin(Math.PI * t))}%)`;
}
const pinColour = (pin: MapPin) => (pin.priorityScore !== undefined && pin.priorityScore !== null ? severityHex(pin.priorityScore) : BAND_HEX[pin.priorityBand]);

type CompactPins = { total: number; bands: PriorityBand[]; categories: string[]; pins: [number, number, number, number, number, number][] };

type MapCtx = { L: L; map: Leaflet.Map; roadsLayer: Leaflet.LayerGroup; pinRenderer: Leaflet.Canvas; cityBounds: Leaflet.LatLngBounds };

function pinSummary(pin: MapPin) {
  const band = pin.priorityBand[0].toUpperCase() + pin.priorityBand.slice(1);
  return `${pin.ref || `#${pin.id}`} · ${categoryLabel(pin.category)} · ${band}${pin.priorityScore !== undefined ? ` (${pin.priorityScore})` : ""}`;
}

/** Popup body built with textContent: titles are resident-written text. */
function popupContent(pin: MapPin, open: (href: string) => void) {
  const el = document.createElement("div");
  el.className = "space-y-1 text-xs";
  if (pin.title) {
    const title = document.createElement("strong");
    title.className = "block text-sm text-scc-navy";
    title.textContent = pin.title;
    el.append(title);
  }
  const meta = document.createElement("div");
  meta.className = "flex items-center gap-1.5 text-slate-700";
  const dot = document.createElement("span");
  dot.className = "inline-block h-2.5 w-2.5 shrink-0 rounded-full";
  dot.style.background = pinColour(pin);
  meta.append(dot, document.createTextNode(pinSummary(pin)));
  el.append(meta);
  if (pin.status) {
    const status = document.createElement("div");
    status.className = "text-slate-500 capitalize";
    status.textContent = pin.status.replaceAll("_", " ");
    el.append(status);
  }
  if (pin.href) {
    const link = document.createElement("a");
    link.href = pin.href;
    link.className = "inline-block font-semibold text-scc-blue underline";
    link.textContent = "Open report →";
    link.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return;
      e.preventDefault();
      open(pin.href!);
    });
    el.append(link);
  }
  return el;
}

function numberIcon(L: L, text: string, colour: string) {
  return L.divIcon({
    className: "",
    html: `<span style="display:grid;place-items:center;width:22px;height:22px;border-radius:9999px;background:${colour};color:#fff;font:700 12px/1 system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">${text}</span>`,
    iconSize: [22, 22],
    iconAnchor: [-2, 26],
  });
}

export function MapPanel({ pins, pinsUrl, routes = [], depot, selectedId, totalCount, caption, height }: MapPanelProps) {
  const router = useRouter();
  const openRef = useRef<(href: string) => void>(() => {});
  const elRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<MapCtx | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [showRoads, setShowRoads] = useState(true);
  const [remote, setRemote] = useState<{ url: string; pins: MapPin[]; total: number; failed?: boolean } | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    openRef.current = (href) => router.push(href);
  }, [router]);

  // Load large pin sets after render.
  useEffect(() => {
    if (!pinsUrl) return;
    const controller = new AbortController();
    fetch(pinsUrl, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`Pins request returned HTTP ${r.status}`);
        return r.json() as Promise<CompactPins>;
      })
      .then((data) =>
        setRemote({
          url: pinsUrl,
          total: data.total,
          pins: data.pins.map(([id, lat, lon, band, cat, score]) => ({
            id,
            ref: "",
            lat: lat / 1e5,
            lon: lon / 1e5,
            priorityBand: data.bands[band],
            category: data.categories[cat],
            priorityScore: score,
            href: `/council/reports/${id}`,
          })),
        }),
      )
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        console.warn("Map pins could not load", err);
        setRemote({ url: pinsUrl, pins: [], total: 0, failed: true });
      });
    return () => controller.abort();
  }, [pinsUrl]);

  const loading = Boolean(pinsUrl) && remote?.url !== pinsUrl;
  const allPins = useMemo(() => {
    const list = pinsUrl && remote?.url === pinsUrl ? [...pins, ...remote.pins] : pins;
    return [...list].sort((a, b) => DRAW_ORDER.indexOf(a.priorityBand) - DRAW_ORDER.indexOf(b.priorityBand) || (a.priorityScore ?? 0) - (b.priorityScore ?? 0));
  }, [pins, pinsUrl, remote]);
  // Issue-type chips on the map: counts per category, and the pins left after hiding some.
  const categoryCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of allPins) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [allPins]);
  const shownPins = useMemo(() => (hidden.size ? allPins.filter((p) => !hidden.has(p.category)) : allPins), [allPins, hidden]);
  const chips = routes.length === 0 && categoryCounts.length > 1;

  // Create the map once.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    Promise.all([loadLeaflet(), loadBoundary()])
      .then(([L, city]) => {
        if (cancelled) return;
        const created = createBaseMap(L, el, city, { scrollWheelZoom: false });
        map = created.map;
        // Wheel zoom only after the officer clicks into the map, so the page still scrolls.
        map.on("click focus", () => map?.scrollWheelZoom.enable());
        map.on("mouseout blur", () => map?.scrollWheelZoom.disable());
        setCtx({ L, map: created.map, roadsLayer: created.roadsLayer, cityBounds: created.cityBounds, pinRenderer: L.canvas({ padding: 0.3, tolerance: 4 }) });
      })
      .catch((err) => {
        console.error("Map failed to load", err);
        if (!cancelled) setMapError("The map could not load. The list on this page has the same reports.");
      });
    return () => {
      cancelled = true;
      map?.remove();
      setCtx(null);
    };
  }, []);

  useEffect(() => {
    if (!ctx) return;
    if (showRoads) ctx.roadsLayer.addTo(ctx.map);
    else ctx.roadsLayer.remove();
  }, [ctx, showRoads]);

  // Pins.
  useEffect(() => {
    if (!ctx) return;
    const { L, map, pinRenderer } = ctx;
    const group = L.layerGroup();
    const markers: [Leaflet.CircleMarker, PriorityBand][] = [];
    for (const pin of shownPins) {
      const marker = L.circleMarker([pin.lat, pin.lon], {
        renderer: pinRenderer,
        radius: RADIUS[pin.priorityBand] * pinScale(map.getZoom()),
        fillColor: pinColour(pin),
        fillOpacity: 0.9,
        color: "#ffffff",
        weight: 1,
      })
        .bindTooltip(() => pinSummary(pin), { direction: "top", offset: [0, -6] })
        .bindPopup(() => popupContent(pin, (href) => openRef.current(href)), { maxWidth: 260 })
        .addTo(group);
      markers.push([marker, pin.priorityBand]);
    }
    group.addTo(map);
    // Smaller pins when zoomed out, so the city view is not one solid blob.
    const resize = () => {
      const k = pinScale(map.getZoom());
      for (const [m, band] of markers) m.setRadius(RADIUS[band] * k);
    };
    map.on("zoomend", resize);
    return () => {
      map.off("zoomend", resize);
      group.remove();
    };
  }, [ctx, shownPins]);

  // Selected pin highlight.
  const selected = useMemo(() => allPins.find((p) => p.id === selectedId) ?? null, [allPins, selectedId]);
  useEffect(() => {
    if (!ctx || !selected) return;
    const ring = ctx.L.circleMarker([selected.lat, selected.lon], {
      radius: 13,
      color: BRAND_NAVY,
      weight: 3,
      fill: false,
      interactive: false,
      pane: "markerPane",
    }).addTo(ctx.map);
    return () => {
      ring.remove();
    };
  }, [ctx, selected]);

  // Crew routes, numbered stops and the depot.
  useEffect(() => {
    if (!ctx || (!routes.length && !depot)) return;
    const { L, map } = ctx;
    const group = L.layerGroup();
    for (const r of routes) {
      const path = r.path.map((p) => [p.lat, p.lon] as [number, number]);
      if (r.roadPath && r.roadPath.length > 1) {
        // Road route solid; the straight-line legs stay visible as a thin dashed line.
        const road = r.roadPath.map((p) => [p.lat, p.lon] as [number, number]);
        L.polyline(road, { color: "#ffffff", weight: 8, opacity: 0.85, interactive: false, lineJoin: "round" }).addTo(group);
        L.polyline(road, { color: r.colour, weight: 5, opacity: 0.95, lineJoin: "round" }).bindTooltip(`${r.label} (by road)`, { sticky: true }).addTo(group);
        L.polyline(path, { color: "#111827", weight: 2.5, opacity: 0.75, dashArray: "6 7", interactive: false }).addTo(group);
      } else {
        L.polyline(path, { color: "#ffffff", weight: 7, opacity: 0.8, interactive: false }).addTo(group);
        L.polyline(path, { color: r.colour, weight: 4, dashArray: "10 6", lineJoin: "round" }).bindTooltip(`${r.label} (straight line)`, { sticky: true }).addTo(group);
      }
      // Routes start at the first job; older plans carried a depot at both ends.
      (depot ? r.path.slice(1, -1) : r.path).forEach((p, i) => {
        L.marker([p.lat, p.lon], { icon: numberIcon(L, String(i + 1), r.colour), interactive: false, keyboard: false }).addTo(group);
      });
    }
    if (depot) {
      L.marker([depot.lat, depot.lon], {
        icon: L.divIcon({
          className: "",
          html: `<span style="display:inline-flex;align-items:center;gap:4px;white-space:nowrap;font:700 12px/1 system-ui,sans-serif;color:${BRAND_NAVY}"><span style="width:16px;height:16px;border-radius:4px;background:${BRAND_NAVY};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></span><span style="background:rgba(255,255,255,.9);padding:2px 4px;border-radius:4px">Depot</span></span>`,
          iconSize: [70, 20],
          iconAnchor: [8, 10],
        }),
        title: depot.name,
        keyboard: false,
      }).addTo(group);
    }
    group.addTo(map);
    return () => {
      group.remove();
    };
  }, [ctx, routes, depot]);

  // Frame the content: small pin sets and routes zoom to fit; the dashboard shows the whole city.
  const focusPoints = useMemo<LatLon[]>(
    () => (pinsUrl ? [] : [...pins, ...routes.flatMap((r) => r.path), ...(depot ? [depot] : [])]),
    [pins, pinsUrl, routes, depot],
  );
  const focusKey = focusPoints.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join(";");
  useEffect(() => {
    if (!ctx || !focusKey) return;
    const pts = focusKey.split(";").map((s) => s.split(",").map(Number) as [number, number]);
    ctx.map.fitBounds(ctx.L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
  }, [ctx, focusKey]);

  const shownTotal = pinsUrl && remote?.url === pinsUrl ? remote.total : totalCount;

  return (
    <figure className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(0,25,60,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2 text-xs">
        <span className="font-semibold text-scc-navy">City map</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-600">
          <span className="inline-flex items-center gap-1.5" data-testid="severity-legend">
            Low
            <span
              className="inline-block h-2.5 w-24 rounded-full"
              style={{ background: `linear-gradient(90deg, ${[0, 20, 40, 60, 85].map((v) => severityHex(v)).join(", ")})` }}
              aria-hidden
            />
            Critical priority
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded border border-slate-200 px-1.5 py-0.5 hover:bg-slate-50">
            <input type="checkbox" checked={showRoads} onChange={(e) => setShowRoads(e.target.checked)} className="accent-red-600" />
            <span className="inline-block h-1 w-4 rounded" style={{ background: ROAD_RED, opacity: 0.7 }} />
            Key roads
          </label>
        </span>
      </div>
      {chips && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2 text-xs" data-testid="map-category-chips">
          <span className="font-medium text-slate-600">Show:</span>
          <button
            type="button"
            onClick={() => setHidden(new Set())}
            className={`rounded-full px-2.5 py-1 font-medium ${hidden.size === 0 ? "bg-scc-navy text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
          >
            All issues
          </button>
          {categoryCounts.map(([c, n]) => {
            const on = !hidden.has(c);
            return (
              <button
                key={c}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setHidden((h) => {
                    // First click on a chip while all are shown: show only that issue type.
                    if (h.size === 0) return new Set(categoryCounts.map(([x]) => x).filter((x) => x !== c));
                    const next = new Set(h);
                    if (next.has(c)) next.delete(c);
                    else next.add(c);
                    return next.size === categoryCounts.length ? new Set() : next;
                  })
                }
                className={`rounded-full px-2.5 py-1 font-medium ${on && hidden.size > 0 ? "bg-scc-blue text-white" : on ? "bg-slate-100 text-slate-700 hover:bg-slate-200" : "bg-white text-slate-400 line-through ring-1 ring-slate-200"}`}
              >
                {categoryLabel(c)} <span className="opacity-70">{n.toLocaleString()}</span>
              </button>
            );
          })}
        </div>
      )}
      <div className="relative isolate">
        <div
          ref={elRef}
          className={height ? "w-full bg-[#e8ece6]" : "h-[380px] w-full bg-[#e8ece6] sm:h-[480px] lg:h-[540px]"}
          style={height ? { height } : undefined}
          role="region"
          aria-label={`Map of Southampton showing ${shownPins.length} reports, coloured green to red by priority. The list on this page has the same reports.`}
          data-testid="city-map"
        />
        {(loading || (!ctx && !mapError)) && (
          <div className="pointer-events-none absolute right-3 top-3 z-[1000] rounded bg-white/90 px-2 py-1 text-xs text-slate-600 shadow">
            {ctx ? "Loading pins..." : "Loading map..."}
          </div>
        )}
        {mapError && (
          <div className="absolute inset-0 z-[1000] grid place-items-center bg-white/80 p-4 text-center text-sm text-slate-700">{mapError}</div>
        )}
      </div>
      <figcaption className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
        {remote?.failed && remote.url === pinsUrl && <span className="font-medium text-amber-800">Report pins could not load (try refreshing). </span>}
        {caption ??
          (loading
            ? "Loading report pins..."
            : `Showing ${shownPins.length.toLocaleString()}${hidden.size ? ` of ${allPins.length.toLocaleString()} loaded` : ""}${shownTotal && shownTotal > allPins.length ? ` highest-priority of ${shownTotal.toLocaleString()}` : ""} reports. Select a pin to see details.`)}{" "}
        Shaded area is outside the city boundary.
      </figcaption>
    </figure>
  );
}
