// @vitest-environment jsdom
// Where focus goes when a kit Dialog closes: the opener; the menu's trigger when the opener was a menu item that unmounted; the page's heading
// when nothing else is left; never the body.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Dialog } from "../ui/kit";
import { menuTrigger } from "./focusReturn";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, dialogHost: HTMLDivElement, root: Root, dRoot: Root;
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); }; // jsdom gives focus back to nothing: the code under test must
  host = document.body.appendChild(document.createElement("div"));
  dialogHost = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  dRoot = createRoot(dialogHost);
});
afterEach(() => {
  act(() => { root.unmount(); dRoot.unmount(); });
  host.remove();
  dialogHost.remove();
});
const mountDialog = (open: boolean) => act(() => dRoot.render(<Dialog open={open} onClose={() => {}} title="Share"><button>Inside</button></Dialog>));
const focused = () => document.activeElement;
const page = (menu: boolean) => (
  <main>
    <h1>Files</h1>
    <button id="opener">Open</button>
    <button id="trigger" aria-controls="m1" aria-expanded={menu}>More</button>
    {menu && <div role="menu" id="m1"><button role="menuitem" id="item">Share</button></div>}
  </main>
);

describe("focus after a kit Dialog closes", () => {
  it("returns to the button that opened it", async () => {
    await act(async () => root.render(page(false)));
    const b = host.querySelector<HTMLElement>("#opener")!;
    act(() => b.focus());
    await mountDialog(true);
    act(() => (document.querySelector("dialog button") as HTMLElement).focus());
    await mountDialog(false);
    expect(focused()).toBe(b);
  });

  it("returns to the menu's trigger when the menu item that opened it has unmounted", async () => {
    await act(async () => root.render(page(true)));
    const item = host.querySelector<HTMLElement>("#item")!;
    act(() => item.focus()); // the menu item had focus when the dialog was asked for
    expect(menuTrigger(item)?.id).toBe("trigger");
    await act(async () => { root.render(page(false)); dRoot.render(<Dialog open onClose={() => {}} title="Share"><button>Inside</button></Dialog>); }); // the menu closes as the dialog opens
    act(() => (document.querySelector("dialog button") as HTMLElement).focus());
    await mountDialog(false);
    expect(focused()?.id).toBe("trigger");
  });

  it("returns to the opener when the dialog is unmounted while open (mounted only while wanted)", async () => {
    await act(async () => root.render(page(false)));
    const b = host.querySelector<HTMLElement>("#opener")!;
    act(() => b.focus());
    await mountDialog(true);
    act(() => (document.querySelector("dialog button") as HTMLElement).focus());
    await act(async () => dRoot.render(null));
    expect(focused()).toBe(b);
  });

  it("goes to the page's heading when the opener was removed while the dialog was open", async () => {
    await act(async () => root.render(page(false)));
    const b = host.querySelector<HTMLElement>("#opener")!;
    act(() => b.focus());
    await mountDialog(true);
    b.remove();
    await mountDialog(false);
    expect(focused()?.tagName).toBe("H1");
    expect(focused()).not.toBe(document.body);
  });
});
