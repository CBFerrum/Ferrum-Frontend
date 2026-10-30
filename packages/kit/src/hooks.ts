// The shell, from React: what an app's screens ask of it most.

import { useEffect, useState } from "react";
import { shell } from "@ferrum/client";

/** Whether an installed app the person may use handles an intent; a button for it shows only
 *  then (docs/plan/apps-ui.md §11.3: hidden, never broken). */
export function useCanIntent(action: string, type: string): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    let live = true;
    shell()
      .canIntent(action, type)
      .then((ok) => live && setCan(ok))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [action, type]);
  return can;
}

/** Sets the bar's title (and the document's) while the screen shows. */
export function useShellTitle(title: string | null | undefined) {
  useEffect(() => {
    if (title) shell().title(title);
  }, [title]);
}
