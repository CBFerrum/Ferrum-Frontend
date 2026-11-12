// @vitest-environment jsdom
// The rich-text toolbar pieces: roving focus along one tab stop, groups folded into "More" by width, the tool button's pressed state
// and tooltip name, and the swatch palette's keyboard grid and checked custom colour.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeColor, gridStep, rememberColor, SwatchPalette } from "./swatches";
import { rovingStep, shortcutLabel, Toolbar, ToolbarButton, ToolbarGroup } from "./toolbar";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const show = (node: React.ReactNode) => act(() => root.render(node));
const key = (el: Element, k: string) => act(() => void el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })));
const focus = (el: HTMLElement) => act(() => el.focus());
const bar = () => host.querySelector<HTMLElement>("[role=toolbar]")!;
const rowButtons = () => [...bar().querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.closest("[inert]"));

describe("pure helpers", () => {
  it("names shortcuts for the platform", () => {
    expect(shortcutLabel("Mod-Shift-b", false)).toBe("Ctrl+Shift+B");
    expect(shortcutLabel("Mod-Shift-b", true)).toBe("⌘⇧B");
    expect(shortcutLabel("Mod--", false)).toBe("Ctrl+-");
  });
  it("moves along a row, flipped right to left, and stops at the ends", () => {
    expect(rovingStep("ArrowRight", 1, 4, false)).toBe(2);
    expect(rovingStep("ArrowRight", 1, 4, true)).toBe(0);
    expect(rovingStep("ArrowLeft", 0, 4, false)).toBe(0);
    expect(rovingStep("End", 0, 4, false)).toBe(3);
    expect(rovingStep("Home", 3, 4, false)).toBe(0);
    expect(rovingStep("a", 1, 4, false)).toBeNull();
  });
  it("moves over a grid by a row for up and down", () => {
    expect(gridStep("ArrowDown", 2, 30, 10, false)).toBe(12);
    expect(gridStep("ArrowUp", 2, 30, 10, false)).toBe(0);
    expect(gridStep("ArrowRight", 2, 30, 10, true)).toBe(1);
    expect(gridStep("End", 2, 30, 10, false)).toBe(29);
    expect(gridStep("ArrowDown", 25, 30, 10, false)).toBe(29);
    expect(gridStep("Tab", 2, 30, 10, false)).toBeNull();
  });
  it("checks a custom colour", () => {
    expect(normalizeColor("#1F4E79")).toBe("#1f4e79");
    expect(normalizeColor("1f4e79")).toBe("#1f4e79");
    expect(normalizeColor(" #fa0 ")).toBe("#ffaa00");
    expect(normalizeColor("#11223344")).toBe("#112233");
    expect(normalizeColor("#11223300")).toBeNull();
    for (const bad of ["", "#12", "red", "#12345g", "#1234567", "rgb(0,0,0)", "#fff;x"]) expect(normalizeColor(bad)).toBeNull();
  });
  it("remembers a colour once, newest first, up to eight", () => {
    expect(rememberColor(["#111111", "#222222"], "#222222")).toEqual(["#222222", "#111111"]);
    expect(rememberColor(Array.from({ length: 8 }, (_, i) => `#00000${i}`), "#ffffff")).toHaveLength(8);
  });
});

describe("Toolbar", () => {
  const tools = (
    <Toolbar label="Formatting">
      <ToolbarGroup id="a">
        <ToolbarButton label="Bold" shortcut="Mod-b" pressed onPress={() => {}}>B</ToolbarButton>
        <ToolbarButton label="Italic" onPress={() => {}}>I</ToolbarButton>
      </ToolbarGroup>
      <ToolbarGroup id="b">
        <ToolbarButton label="Link" onPress={() => {}}>L</ToolbarButton>
      </ToolbarGroup>
    </Toolbar>
  );

  it("is a named toolbar of one tab stop", async () => {
    await show(tools);
    expect(bar().getAttribute("aria-label")).toBe("Formatting");
    expect(rowButtons().map((b) => b.tabIndex)).toEqual([0, -1, -1]);
  });

  it("moves by arrows, Home and End, and keeps the stop where focus went", async () => {
    await show(tools);
    const [bold, italic, link] = rowButtons();
    focus(bold);
    key(bold, "ArrowRight");
    expect(document.activeElement).toBe(italic);
    key(italic, "End");
    expect(document.activeElement).toBe(link);
    expect(rowButtons().map((b) => b.tabIndex)).toEqual([-1, -1, 0]);
    key(link, "Home");
    expect(document.activeElement).toBe(bold);
  });

  it("calls onEscape and leaves keys that come from a popover alone", async () => {
    const out = vi.fn();
    await show(<Toolbar label="F" onEscape={out}><ToolbarGroup id="a"><ToolbarButton label="Bold" onPress={() => {}}>B</ToolbarButton></ToolbarGroup></Toolbar>);
    key(rowButtons()[0], "Escape");
    expect(out).toHaveBeenCalledTimes(1);
    const inner = bar().appendChild(document.createElement("div"));
    inner.setAttribute("role", "dialog");
    key(inner, "Escape");
    expect(out).toHaveBeenCalledTimes(1);
  });

  it("shows pressed as aria-pressed, names the shortcut, and keeps the caret where it is", async () => {
    await show(tools);
    const [bold, italic] = rowButtons();
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    expect(bold.getAttribute("aria-keyshortcuts")).toMatch(/Ctrl\+B|⌘B/);
    expect(italic.hasAttribute("aria-pressed")).toBe(false);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    bold.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("calls onPress when pressed, not when disabled", async () => {
    const press = vi.fn();
    await show(<Toolbar label="F"><ToolbarGroup id="a"><ToolbarButton label="Go" onPress={press}>G</ToolbarButton><ToolbarButton label="No" disabled onPress={press}>N</ToolbarButton></ToolbarGroup></Toolbar>);
    const [go, no] = [...bar().querySelectorAll<HTMLButtonElement>("button")];
    act(() => go.click());
    act(() => no.click());
    expect(press).toHaveBeenCalledTimes(1);
  });

  it("folds the groups that do not fit into More, last first, by measured width", async () => {
    // jsdom has no layout: give each measured thing the width the real one would have.
    const width = (el: Element) => (el.getAttribute("role") === "toolbar" ? 130 : el.parentElement?.hasAttribute("inert") ? (el === el.parentElement.lastElementChild ? 30 : 60) : 0);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) { return width(this); });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) { return { width: width(this) } as DOMRect; });
    await show(
      <Toolbar label="F">
        <ToolbarGroup id="a"><ToolbarButton label="A" onPress={() => {}}>A</ToolbarButton></ToolbarGroup>
        <ToolbarGroup id="b"><ToolbarButton label="B" onPress={() => {}}>B</ToolbarButton></ToolbarGroup>
        <ToolbarGroup id="c"><ToolbarButton label="C" onPress={() => {}}>C</ToolbarButton></ToolbarGroup>
      </Toolbar>,
    );
    // 130 wide; groups 60 each + More 30: a and b = 122 do not leave room for More (130 - 30 - 2 = 98): only a stays.
    const names = rowButtons().map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["A", "More"]);
    vi.restoreAllMocks();
  });
});

describe("SwatchPalette", () => {
  const swatches = Array.from({ length: 20 }, (_, i) => ({ color: `#${String(i).padStart(2, "0")}0000`, label: `Colour ${i}` }));
  const draw = (over: Partial<Parameters<typeof SwatchPalette>[0]> = {}) => {
    const onChange = vi.fn();
    act(() => root.render(<SwatchPalette label="Text colour" swatches={swatches} value={null} noneLabel="Automatic" onChange={onChange} {...over} />));
    return onChange;
  };
  const cells = () => [...host.querySelectorAll<HTMLButtonElement>("[data-cell]")];

  it("is one tab stop over the grid, on the colour in use", () => {
    draw({ value: "#050000" });
    expect(cells().map((c) => c.tabIndex).filter((t) => t === 0)).toHaveLength(1);
    expect(cells()[5].tabIndex).toBe(0);
    expect(cells()[5].getAttribute("aria-pressed")).toBe("true");
  });

  it("moves over the grid by arrows, a row at a time up and down", () => {
    draw();
    focus(cells()[0]);
    key(cells()[0], "ArrowRight");
    expect(document.activeElement).toBe(cells()[1]);
    key(cells()[1], "ArrowDown");
    expect(document.activeElement).toBe(cells()[11]);
    key(cells()[11], "End");
    expect(document.activeElement).toBe(cells()[19]);
  });

  it("offers Automatic, picks a swatch, and shows the recent colours", () => {
    const onChange = draw({ recent: ["#123456"] });
    const none = [...host.querySelectorAll("button")].find((b) => b.textContent?.includes("Automatic"))!;
    act(() => none.click());
    act(() => cells()[3].click());
    expect(onChange.mock.calls).toEqual([[null], ["#030000"]]);
    expect(cells().at(-1)!.getAttribute("aria-label")).toBe("Recent colour #123456");
  });

  it("refuses a custom colour that is not one, and says why", () => {
    const onChange = draw();
    const input = host.querySelector<HTMLInputElement>("input")!;
    const type = (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = () => act(() => void host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    type("blue");
    submit();
    expect(onChange).not.toHaveBeenCalled();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(host.textContent).toContain("Enter a colour code of three or six hex digits");
    type("1F4E79");
    submit();
    expect(onChange).toHaveBeenCalledWith("#1f4e79");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });
});
