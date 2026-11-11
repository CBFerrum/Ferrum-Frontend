// @vitest-environment jsdom
// Toasts: the old signature is unchanged, an action toast stays 8 seconds and its button fires once, the timer stops while the
// pointer or focus is on the toast, and announce() speaks through the toaster's live region without showing a toast.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { announce, toast, Toaster } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Toaster />));
});
afterEach(() => {
  act(() => host.querySelectorAll<HTMLButtonElement>('.toast [aria-label="Dismiss notification"]').forEach((b) => b.click()));
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});
const count = () => host.querySelectorAll(".toast").length;
const wait = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const undo = () => [...host.querySelectorAll("button")].find((b) => b.textContent === "Undo")!;

describe("toast", () => {
  it("keeps its old calls: 4 seconds, 9 for an error, no button", () => {
    act(() => toast("Saved"));
    act(() => toast("Failed", "error"));
    expect(count()).toBe(2);
    expect(host.querySelectorAll(".toast-message")[0]!.textContent).toBe("Saved");
    expect(undo()).toBeUndefined();
    wait(4000);
    expect(count()).toBe(1);
    wait(5000);
    expect(count()).toBe(0);
  });

  it("stays at least 8 seconds with an action, whatever duration was asked", () => {
    act(() => toast("Moved to Trash", "success", { action: { label: "Undo", onSelect: () => {} }, duration: 1000 }));
    wait(7900);
    expect(count()).toBe(1);
    wait(200);
    expect(count()).toBe(0);
  });

  it("dismisses and calls the action once", () => {
    const onSelect = vi.fn();
    act(() => toast("Moved to Trash", "success", { action: { label: "Undo", onSelect } }));
    const b = undo();
    expect(b.tagName).toBe("BUTTON");
    act(() => (b.click(), b.click()));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(count()).toBe(0);
  });

  it("pauses its timer while hovered or focused, then goes on with what was left", () => {
    act(() => toast("Moved to Trash", "success", { action: { label: "Undo", onSelect: () => {} } }));
    wait(6000);
    const el = host.querySelector(".toast")!;
    act(() => el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })));
    wait(30_000);
    expect(count()).toBe(1);
    act(() => el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })));
    wait(1900);
    expect(count()).toBe(1);
    wait(200);
    expect(count()).toBe(0);
    act(() => toast("Again", "success", { action: { label: "Undo", onSelect: () => {} } }));
    act(() => undo().focus());
    wait(30_000);
    expect(count()).toBe(1);
  });

  it("stacks a second action toast under the first", () => {
    act(() => toast("One", "success", { action: { label: "Undo", onSelect: () => {} } }));
    act(() => toast("Two", "success", { action: { label: "Undo", onSelect: () => {} } }));
    expect(count()).toBe(2);
  });
});

describe("announce", () => {
  it("writes to the polite live region and shows no toast", () => {
    act(() => announce("3 conversations moved to Trash"));
    const live = host.querySelector('[aria-live="polite"]')!;
    expect(live.textContent).toBe("3 conversations moved to Trash");
    expect(live.querySelector(".sr-only")).not.toBeNull();
    expect(count()).toBe(0);
  });
});
