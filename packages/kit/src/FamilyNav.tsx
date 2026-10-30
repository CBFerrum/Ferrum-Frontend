// A family's navigation (docs/plan/apps-ui.md §11.5): every member of a family (Drive and Docs in
// Workspace) draws the same entries, so they look like one app with sections while each ships on
// its own; moving between them is a page load. Nothing is drawn outside a family.

import { useEffect, useState } from "react";
import { shell, type Family } from "@ferrum/client";

export function FamilyNav({ className }: { className?: string }) {
  const [family, setFamily] = useState<Family | null>(null);
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
  if (!family || family.entries.length < 2) return null;
  // The entry whose address is the longest match is this page's.
  const here = family.entries.filter((e) => location.pathname.startsWith(e.url)).sort((a, b) => b.url.length - a.url.length)[0];
  return (
    <nav className={className ?? "family-nav"} aria-label={family.title}>
      {family.entries.map((e) => (
        <a key={`${e.app}.${e.id}`} href={e.url} aria-current={e === here ? "page" : undefined} onClick={(ev) => {
          if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
          ev.preventDefault();
          shell().navigate(e.url);
        }}>
          {e.title}
        </a>
      ))}
    </nav>
  );
}
