/**
 * Map component contract.
 *
 * Leaflet maps (see MapPanel.tsx and LocationPicker.tsx). `MapPanel` serves the
 * officer dashboard, route planner and report detail; `LocationPicker` the
 * resident form. Both keep these props stable for callers. All
 * coordinates are WGS84 latitude/longitude.
 */
import type { PriorityBand } from "@/lib/triage/types";

export type LatLon = { lat: number; lon: number };

export type MapPin = LatLon & {
  id: number;
  ref: string;
  category: string;
  priorityBand: PriorityBand;
  priorityScore?: number;
  status?: string;
  title?: string;
  /** Where clicking the pin should go (report detail page). */
  href?: string;
};

export type MapRoute = {
  id: string;
  label: string;
  colour: string;
  /** Stops in visiting order (the day starts at the first job). Legacy plans with `depot` include it at both ends. */
  path: LatLon[];
  /** The same route along the roads; drawn solid, with `path` dashed underneath. */
  roadPath?: LatLon[];
};

export type MapPanelProps = {
  pins: MapPin[];
  /**
   * Optional: load pins from this URL after the page renders (the compact format of
   * GET /api/council/map/pins?format=compact). Keeps large pin sets out of the page payload.
   */
  pinsUrl?: string;
  routes?: MapRoute[];
  depot?: LatLon & { name: string };
  selectedId?: number | null;
  /** Total matching reports when `pins` is a capped subset. */
  totalCount?: number;
  height?: number;
  caption?: string;
};

export type LocationPickerProps = {
  value: LatLon | null;
  onChange: (value: LatLon | null) => void;
  /** Existing open reports to show for context while choosing a point. */
  nearby?: MapPin[];
  invalid?: boolean;
};
