// Roles held until a day on the Users page: what is sent for the days chosen, and the day shown.

import { describe, expect, it } from "vitest";
import { setTimeZone } from "../lib/format";
import { roleEnds, throughDay } from "./Admin";

describe("role ends", () => {
  it("show and take the day on the workspace's clock, not the browser's", () => {
    // 11:00 UTC on 5 Nov is already 6 Nov in Kiritimati (UTC+14), and still 5 Nov in any browser west of UTC+13.
    setTimeZone("Pacific/Kiritimati");
    try {
      expect(throughDay("2026-11-05T11:00:00Z")).toBe("2026-11-06");
      const held = { Viewer: "2026-11-05T11:00:00Z" };
      expect(roleEnds(["Viewer"], { Viewer: "2026-11-06" }, held)).toEqual(held);
      expect(roleEnds(["Viewer"], { Viewer: "2026-11-07" }).Viewer).toBe("2026-11-07T09:59:59.000Z");
    } finally {
      setTimeZone(undefined);
    }
  });

  it("send each chosen day's close, for the roles kept only", () => {
    const sent = roleEnds(["Clerk", "Viewer"], { Viewer: "2026-12-31", Gone: "2026-12-01" });
    expect(Object.keys(sent)).toEqual(["Viewer"]);
    expect(sent.Viewer).toBe(new Date("2026-12-31T23:59:59").toISOString());
    expect(throughDay(sent.Viewer)).toBe("2026-12-31");
  });

  it("keep a role's own moment when its day was left as it was", () => {
    const held = { Viewer: new Date("2026-12-31T09:30:00").toISOString() };
    expect(roleEnds(["Viewer"], { Viewer: "2026-12-31" }, held)).toEqual(held);
    expect(roleEnds(["Viewer"], { Viewer: "2027-01-15" }, held).Viewer).toBe(new Date("2027-01-15T23:59:59").toISOString());
    expect(roleEnds(["Viewer"], { Viewer: "" }, held)).toEqual({});
  });
});
