// Encoded polylines as routers give a route's shape (Google's format: precision 5; Valhalla and OSRM's polyline6: precision 6).
import { describe, expect, it } from "vitest";
import { decodePolyline } from "./polyline";

describe("decodePolyline", () => {
  it("decodes_polyline5_and_polyline6", () => {
    const points = [[38.5, -120.2], [40.7, -120.95], [43.252, -126.453]];
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", 5)).toEqual(points); // Google's documented example
    expect(decodePolyline("_izlhA~rlgdF_{geC~ywl@_kwzCn`{nI", 6)).toEqual(points);
    expect(decodePolyline("", 6)).toEqual([]);
  });
  it("stops at a broken string instead of reading past it", () => {
    expect(decodePolyline("_p~iF~ps|U_ulL", 5)).toEqual([[38.5, -120.2]]);
  });
});
