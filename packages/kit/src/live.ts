// Live updates for an app's own interface: the shell's one channel per browser (§12.4), as hooks
// with the shapes of today's web app (ids only; data always comes through the API).

import { useEffect } from "react";
import { shell } from "@ferrum/client";

export interface LiveEvent {
  event: string;
  entity: string;
  id: string;
  actor?: string | null;
}

/** Calls `handler` for changes to `entity` while the component is mounted. */
export function useLiveEntity(entity: string | undefined, handler: (e: LiveEvent) => void) {
  useEffect(() => {
    if (!entity) return;
    return shell().live.subscribe(entity, (d) => {
      if (d.entity === entity && typeof d.id === "string") handler(d as unknown as LiveEvent);
    });
  }, [entity, handler]);
}

/** Calls `handler` for an app's pushes of `kind`, and with null after the channel comes back
 *  from a break (refetch). */
export function useLivePush(kind: string, handler: (data: Record<string, unknown> | null) => void) {
  useEffect(
    () =>
      shell().live.subscribe(
        `push:${kind}`,
        (d) => {
          const p = d.push as { kind?: string; data?: Record<string, unknown> } | undefined;
          if (p?.kind === kind) handler(p.data ?? {});
        },
        { resync: () => handler(null) },
      ),
    [kind, handler],
  );
}
