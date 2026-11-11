// A family's navigation (docs/plan/apps-ui.md §11.5): every member of a family (Drive and Docs in
// Workspace) draws the same entries, so they look like one app with sections while each ships on
// its own; moving between them is a page load. Nothing is drawn outside a family.

import { useEffect, useRef, useState } from "react";
import { shell, type Family, isolate } from "@ferrum/client";
import { cn } from "../../../src/lib/utils";
import { AppIcon } from "./AppIcon";

/** Brings the current entry into the visible part of the strip: the strip alone moves (never the page), at once (never
 *  animated, so reduced motion is honoured). `inline: nearest`: an entry already in view does not move it. */
export function revealCurrent(strip: HTMLElement) {
  const a = strip.querySelector<HTMLElement>('[aria-current="page"]');
  if (!a) return;
  const [s, r] = [strip.getBoundingClientRect(), a.getBoundingClientRect()];
  if (r.left < s.left) strip.scrollLeft += r.left - s.left - 8;
  else if (r.right > s.right) strip.scrollLeft += r.right - s.right + 8;
}

/** Whether this page is at or under an entry's address (`/sheets` and `/sheets/…` for `/sheets/`). */
const under = (url: string) => {
  const base = url.replace(/\/+$/, "");
  return base !== "" && (location.pathname === base || location.pathname.startsWith(`${base}/`));
};

export function FamilyNav({ className }: { className?: string }) {
  const [family, setFamily] = useState<Family | null>(null);
  const strip = useRef<HTMLElement>(null);
  useEffect(() => {
    let live = true;
    shell()
      .family()
      .then((f) => live && setFamily(f))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  // The entry whose address is the longest match is this page's.
  const here = family?.entries.filter((e) => under(e.url)).sort((a, b) => b.url.length - a.url.length)[0];
  useEffect(() => {
    if (strip.current) revealCurrent(strip.current);
  }, [family, here?.url]);
  if (!family || family.entries.length < 2) return null;
  return (
    <nav ref={strip} aria-label={isolate(family.title)} className={cn("scroll-cue -mx-1 flex items-center gap-0.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
      {family.entries.map((e) => (
        <a
          key={`${e.app}.${e.id}`}
          href={e.url}
          aria-current={e === here ? "page" : undefined}
          className={cn(
            "inline-flex h-8 shrink-0 items-center gap-2 rounded-md ps-1.5 pe-3 text-sm font-medium whitespace-nowrap text-muted-foreground no-underline transition-colors duration-(--duration-state)",
            "hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring",
            e === here && "bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary",
          )}
          onClick={(ev) => {
            if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
            ev.preventDefault();
            shell().navigate(e.url);
          }}
        >
          <AppIcon name={e.icon} color={e.color} title={isolate(e.title)} tile size={12} />
          {isolate(e.title)}
        </a>
      ))}
    </nav>
  );
}
