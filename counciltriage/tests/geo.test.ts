import { describe, expect, it } from "vitest";
import { KEY_ROAD_LINES, MAJOR_ROAD_THRESHOLD_M, nearestMajorRoad, WARD_NAMES, WARD_SOURCE, wardFor } from "@/lib/geo";

describe("committed geometry", () => {
  it("loads the ONS wards and OpenStreetMap roads from geo/", () => {
    expect(WARD_SOURCE).toBe("geojson");
    expect(KEY_ROAD_LINES).toBeGreaterThan(1000);
    expect(WARD_NAMES).toHaveLength(17);
    expect(WARD_NAMES).toContain("Banister & Polygon");
  });

  it("assigns points to the ward polygon containing them", () => {
    expect(wardFor({ lat: 50.925, lon: -1.392 })).toBe("Portswood");
    expect(wardFor({ lat: 50.937, lon: -1.41 })).toBe("Bassett");
    expect(wardFor({ lat: 50.9195, lon: -1.47 })).toBe("Redbridge");
    expect(wardFor({ lat: 50.9045, lon: -1.4045 })).toBe("Bargate");
  });

  it("gives boundary-line reports the nearest ward and leaves points beyond the city unassigned", () => {
    // West End Road forms the city boundary here.
    expect(wardFor({ lat: 50.923436, lon: -1.341119 })).toBe("Harefield");
    // Totton, across the River Test.
    expect(wardFor({ lat: 50.918, lon: -1.488 })).toBeNull();
  });

  it("finds major roads from the real road network", () => {
    const avenue = nearestMajorRoad({ lat: 50.91853, lon: -1.40335 });
    expect(avenue?.name).toContain("The Avenue");
    expect(avenue!.distanceMetres).toBeLessThanOrEqual(MAJOR_ROAD_THRESHOLD_M);
    expect(nearestMajorRoad({ lat: 50.898477, lon: -1.377102 })?.name).toContain("Itchen Bridge");
    // Residential street in Bassett.
    expect(nearestMajorRoad({ lat: 50.937, lon: -1.41 })?.distanceMetres ?? Infinity).toBeGreaterThan(MAJOR_ROAD_THRESHOLD_M);
  });
});
