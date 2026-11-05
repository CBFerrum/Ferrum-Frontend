// Roles held until a day on the Users page: what is sent for the days chosen, and the day shown.

import { describe, expect, it } from "vitest";
import { roleEnds, throughDay } from "./Admin";

describe("role ends", () => {
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
