// Where focus goes when a dialog, sheet or confirm closes: the control that had it when the dialog opened, if it is still in the page and can take it; else
// the trigger of the menu that control was in (a menu item unmounts with its menu, so a dialog opened from one has no opener left: the menu's button, which
// the menu declares with `aria-labelledby` (Radix) or `aria-controls` (the kit's Menu), is the place); else the page's main heading or main landmark.
// Never <body>. `trackFocus()` starts remembering the last focused control and its menu's trigger, because by the time a dialog opens from a menu item
// the menu may already be gone and `document.activeElement` is the body.

import { useEffect } from "react";

let started = false;
let last: { el: HTMLElement; trigger: HTMLElement | null } | null = null;

/** The button a menu was opened with, read from the menu element the control is in. */
export function menuTrigger(el: Element | null): HTMLElement | null {
  const menu = el?.closest("[role=menu]");
  if (!menu) return null;
  const by = menu.getAttribute("aria-labelledby");
  return (by && document.getElementById(by)) || (menu.id ? [...document.querySelectorAll<HTMLElement>("[aria-controls]")].find((e) => e.getAttribute("aria-controls") === menu.id) ?? null : null);
}

/** Starts remembering focus; once per page, from the first dialog that mounts. */
export function trackFocus() {
  if (started || typeof document === "undefined") return;
  started = true;
  document.addEventListener("focusin", (e) => {
    if (!(e.target instanceof HTMLElement) || e.target.closest("dialog, [role=dialog]")) return; // what is outside any dialog: where a dialog should give focus back to
    last = { el: e.target, trigger: menuTrigger(e.target) };
  }, true);
}

export function usable(el: HTMLElement | null | undefined): el is HTMLElement {
  if (!el || !el.isConnected || (el as HTMLButtonElement).disabled || el.closest("[inert], [hidden]")) return false;
  const cs = getComputedStyle(el);
  return cs.display !== "none" && cs.visibility !== "hidden";
}

function main(): HTMLElement | null {
  const h = document.querySelector<HTMLElement>("main h1, [role=main] h1, main [role=heading][aria-level='1']");
  const m = h ?? document.querySelector<HTMLElement>("main, [role=main]");
  if (m && !m.hasAttribute("tabindex")) m.setAttribute("tabindex", "-1");
  return m;
}

/** Call as a dialog opens; the function it returns gives focus back when it closes. */
export function rememberFocus(): () => void {
  const now = document.activeElement instanceof HTMLElement && document.activeElement !== document.body && !document.activeElement.closest("dialog, [role=dialog]") ? document.activeElement : null;
  const el = now ?? last?.el ?? null;
  const trigger = (now ? menuTrigger(now) : null) ?? (el === last?.el ? last?.trigger : null) ?? null;
  return () => {
    const target = [el, trigger].find(usable) ?? main();
    if (target && document.activeElement !== target) target.focus({ preventScroll: true });
  };
}

/** Gives focus to the last control used outside any dialog (or its menu's trigger), else the heading. */
function restoreTracked() {
  const target = [last?.el, last?.trigger].find(usable) ?? main();
  if (target && document.activeElement !== target) target.focus({ preventScroll: true });
}

/** For a Radix sheet or dialog's content (rendered whether or not it is open, so it cannot remember at open): the `onCloseAutoFocus` that gives focus back by the same rules, from what `trackFocus` last saw. */
export function useRestoreFocus(then?: (e: Event) => void) {
  useEffect(() => trackFocus(), []);
  return (e: Event) => {
    then?.(e);
    if (e.defaultPrevented) return;
    e.preventDefault();
    restoreTracked();
  };
}
