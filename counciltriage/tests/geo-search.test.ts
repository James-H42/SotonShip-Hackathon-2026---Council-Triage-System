import { describe, expect, it } from "vitest";
import { classifyQuery, parseCoords } from "@/lib/geo-search";

describe("location search queries", () => {
  it("recognises postcodes and postcode areas", () => {
    expect(classifyQuery("so147ly")).toEqual({ kind: "postcode", value: "SO14 7LY" });
    expect(classifyQuery("so14")).toEqual({ kind: "outcode", value: "SO14" });
  });

  it("reads latitude and longitude in either order and with compass letters", () => {
    expect(parseCoords("50.9097, -1.4044")).toEqual({ lat: 50.9097, lon: -1.4044 });
    expect(parseCoords("50.9097 -1.4044")).toEqual({ lat: 50.9097, lon: -1.4044 });
    expect(parseCoords("-1.4044, 50.9097")).toEqual({ lat: 50.9097, lon: -1.4044 });
    expect(parseCoords("50.9097N 1.4044W")).toEqual({ lat: 50.9097, lon: -1.4044 });
    expect(classifyQuery("50.9097, -1.4044")?.kind).toBe("coords");
  });

  it("does not mistake other text for coordinates", () => {
    expect(parseCoords("12 Above Bar Street")).toBeNull();
    expect(classifyQuery("///filled.count.soap")?.kind).toBe("what3words");
    expect(classifyQuery("Above Bar Street")?.kind).toBe("place");
  });
});
