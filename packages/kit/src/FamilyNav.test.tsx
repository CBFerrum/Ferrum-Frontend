// @vitest-environment jsdom
// The family strip brings the current entry into view by moving the strip alone, at once, only when it is cut off.

import { describe, expect, it } from "vitest";
import { revealCurrent } from "./FamilyNav";

const strip = (left: number, right: number, item: [number, number] | null) => {
  const nav = document.createElement("nav");
  nav.getBoundingClientRect = () => ({ left, right }) as DOMRect;
  if (item) {
    const a = document.createElement("a");
    a.setAttribute("aria-current", "page");
    a.getBoundingClientRect = () => ({ left: item[0], right: item[1] }) as DOMRect;
    nav.append(a);
  }
  return nav;
};

describe("revealCurrent", () => {
  it("scrolls the strip forward when the current entry is cut off on the right", () => {
    const nav = strip(0, 390, [330, 440]);
    revealCurrent(nav);
    expect(nav.scrollLeft).toBe(58);
  });
  it("scrolls back when it is cut off on the left", () => {
    const nav = strip(0, 390, [-60, 30]);
    nav.scrollLeft = 100;
    revealCurrent(nav);
    expect(nav.scrollLeft).toBe(32);
  });
  it("leaves the strip alone when the entry is in view or there is none", () => {
    const a = strip(0, 390, [20, 120]);
    revealCurrent(a);
    const b = strip(0, 390, null);
    revealCurrent(b);
    expect([a.scrollLeft, b.scrollLeft]).toEqual([0, 0]);
  });
});
