// Where a menu, pop-up, tooltip or hover card is drawn. Radix portals them to the end of <body>, outside every landmark (axe
// `region`) and, from inside the kit's native <dialog>, outside the dialog's top layer, where they are dimmed and cannot be
// pressed. So every primitive draws into `usePortalContainer()`: the open dialog around it (`PortalContainer`), else one
// page-wide root that is a named region while it holds something. A caller may still pass `container` to the primitive.

import { createContext, useContext, type ReactNode } from "react";
import { t } from "./i18n";

const Around = createContext<HTMLElement | null>(null);

/** Makes `container` (a native dialog) the place the overlays of everything inside it are drawn. */
export function PortalContainer({ container, children }: { container: HTMLElement | null; children: ReactNode }) {
  return <Around.Provider value={container}>{children}</Around.Provider>;
}

let root: HTMLElement | null = null;

/** The page's one root for overlays: last in <body>, a region named for its contents only while it has any (an empty landmark is noise). */
export function portalRoot(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  if (root?.isConnected) return root;
  const el = document.createElement("div");
  el.setAttribute("data-portal-root", "");
  const label = () => {
    if (el.childElementCount) {
      // A modal Radix layer (sheet, Radix dialog) marks every sibling of itself aria-hidden when it opens, this root included, though what
      // opens in it afterwards is above that layer: the root is kept in view of assistive technology while it holds something.
      if (el.getAttribute("aria-hidden") === "true") el.removeAttribute("aria-hidden");
      el.setAttribute("role", "region");
      el.setAttribute("aria-label", t("Menus and pop-ups"));
    } else {
      el.removeAttribute("role");
      el.removeAttribute("aria-label");
    }
  };
  new MutationObserver(label).observe(el, { childList: true, attributes: true, attributeFilter: ["aria-hidden"] });
  document.body.appendChild(el);
  return (root = el);
}

/** The container for a Radix portal: the dialog around the caller, else the page's root. */
export function usePortalContainer(): HTMLElement | undefined {
  return useContext(Around) ?? portalRoot();
}
