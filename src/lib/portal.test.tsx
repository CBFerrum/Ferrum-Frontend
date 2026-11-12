// @vitest-environment jsdom
// Where overlays are drawn: one root at the end of the page (a named region only while it holds something), the dialog around
// the caller when there is one, and a root a modal layer hid stays in view once something opens in it.

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PortalContainer, portalRoot } from "./portal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const show = (node: ReactNode) => act(() => root.render(node));
const popover = (
  <Popover open>
    <PopoverTrigger>Open</PopoverTrigger>
    <PopoverContent aria-label="Pick">Contents</PopoverContent>
  </Popover>
);
const contents = () => [...document.querySelectorAll("[data-slot=popover-content]")].find((e) => e.textContent === "Contents")!;

describe("where overlays are drawn", () => {
  it("is one root at the end of the page, a named region only while it holds something", async () => {
    const r = portalRoot()!;
    expect(r.parentElement).toBe(document.body);
    expect(r.hasAttribute("role")).toBe(false);
    const el = r.appendChild(document.createElement("div"));
    await flush();
    expect(r.getAttribute("role")).toBe("region");
    expect(r.getAttribute("aria-label")).toBe("Menus and pop-ups");
    el.remove();
    await flush();
    expect(r.hasAttribute("role")).toBe(false);
  });

  it("draws a popover in that root, not loose in <body>", async () => {
    await show(popover);
    expect(contents().closest("[data-portal-root]")).toBe(portalRoot());
    expect(contents().closest("[role=region]")).not.toBeNull();
  });

  it("draws it in the dialog around it when there is one", async () => {
    const dialog = document.body.appendChild(document.createElement("div"));
    await show(<PortalContainer container={dialog}>{popover}</PortalContainer>);
    expect(dialog.contains(contents())).toBe(true);
    expect(contents().closest("[data-portal-root]")).toBeNull();
    dialog.remove();
  });

  it("keeps a root a modal layer marked aria-hidden in view once something opens in it", async () => {
    const r = portalRoot()!;
    r.setAttribute("aria-hidden", "true");
    await show(popover);
    await flush();
    expect(r.hasAttribute("aria-hidden")).toBe(false);
  });
});
