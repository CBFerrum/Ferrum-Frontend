import { describe, expect, it } from "vitest";
import { canonicalZone, canonicalZones } from "./zone";

describe("time zone names", () => {
  it("are shown by their current name: a device that says Asia/Calcutta is in Asia/Kolkata", () => {
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(canonicalZone("Europe/Paris")).toBe("Europe/Paris");
  });
  it("are listed once under it", () => {
    expect(canonicalZones(["Asia/Calcutta", "Asia/Kolkata", "UTC"])).toEqual(["Asia/Kolkata", "UTC"]);
  });
});
