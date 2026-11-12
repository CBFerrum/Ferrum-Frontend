// @vitest-environment jsdom
// A kit Dialog opened over a Radix sheet or dialog (a confirmation from inside one): the layer below marks its siblings aria-hidden, which
// must not hide the question, and its document-level Escape must not close the layer below the question.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "./kit";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  // jsdom has no showModal: it only has to set `open`.
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.querySelectorAll("[data-fake-layer]").forEach((e) => e.remove());
});
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));
const open = () => act(() => root.render(<Dialog open onClose={() => {}} title="Discard?"><button>Discard</button></Dialog>));
const layer = () => {
  const el = document.body.appendChild(document.createElement("div"));
  for (const [k, v] of [["role", "dialog"], ["data-state", "open"], ["data-fake-layer", ""]]) el.setAttribute(k, v);
};

describe("Dialog over another layer", () => {
  it("is not aria-hidden while open, even when a layer below marks it so", async () => {
    await open();
    const d = host.querySelector("dialog")!;
    d.setAttribute("aria-hidden", "true");
    await flush();
    expect(d.hasAttribute("aria-hidden")).toBe(false);
  });

  it("keeps Escape from the layer below, only while one is open", async () => {
    await open();
    const seen = vi.fn();
    document.addEventListener("keydown", seen, true);
    const press = () => host.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    press();
    expect(seen).toHaveBeenCalledTimes(1); // nothing below: the key goes on as before
    layer();
    press();
    expect(seen).toHaveBeenCalledTimes(1); // a Radix layer is open: the document never hears it
    document.removeEventListener("keydown", seen, true);
  });
});
