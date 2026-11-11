// @vitest-environment jsdom
// A table's frame takes the keyboard, with a name, only when its table is wider than it (there is something to reach).

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { ScrollRegion } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const draw = (scrollWidth: number, label?: string) => {
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = class {
    observe() {}
    disconnect() {}
  };
  const proto = HTMLElement.prototype;
  Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => scrollWidth });
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 300 });
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<ScrollRegion label={label}><table /></ScrollRegion>));
  return host.firstElementChild as HTMLElement;
};

describe("ScrollRegion", () => {
  it("is a named, focusable region when its content is wider", () => {
    const el = draw(600, "Users");
    expect(el.className).toContain("table-wrap");
    expect([el.getAttribute("role"), el.getAttribute("aria-label"), el.tabIndex]).toEqual(["region", "Users", 0]);
  });
  it("is plain when everything fits", () => {
    const el = draw(300);
    expect([el.getAttribute("role"), el.hasAttribute("tabindex")]).toEqual([null, false]);
  });
});
