// Hooks shared by the Space screens, and the ones the shell uses to show Spaces elsewhere.

import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { live } from "@/lib/live";
import { sameObject, studio, studioKeys, useStudioList, type StudioListRow } from "@/lib/studio";
import { PATHS, widgetEntities } from "./model";

/**
 * A space's blocks resolved for the viewer: refetched whenever it is shown again and when the
 * window regains focus (counts on a home page should be current), and live when the records
 * its blocks show change.
 */
export function useSpace(id: string | undefined) {
  const q = useQuery({
    queryKey: studioKeys.space(id ?? ""),
    queryFn: ({ signal }) => studio.spaceData(id ?? "", signal),
    enabled: !!id,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    ...sameObject(id),
  });
  const { refetch } = q;
  useLiveRefresh(useMemo(() => (q.data ? widgetEntities(q.data.blocks) : []), [q.data]), () => void refetch());
  return q;
}

/**
 * The Space a module shows on its home: the first one the viewer may open for that module, by
 * sequence then label (the server's order). `space` is undefined while loading and when there is none.
 */
export function useModuleSpace(module: string | null | undefined): {
  space: StudioListRow<"spaces"> | undefined;
  spaces: StudioListRow<"spaces">[];
  isLoading: boolean;
  error: unknown;
} {
  const filter = { module: module ?? "" };
  const q = useQuery({
    queryKey: studioKeys.list("spaces", filter),
    queryFn: ({ signal }) => studio.list("spaces", filter, signal),
    enabled: !!module,
  });
  return { space: q.data?.[0], spaces: q.data ?? [], isLoading: !!module && q.isLoading, error: q.error };
}

/** Sidebar entries for every Space the viewer may open, in sidebar order. */
export function useSpaceNav(): { label: string; to: string; icon: string }[] {
  const rows = useStudioList("spaces").data;
  return useMemo(() => (rows ?? []).map((r) => ({ label: r.label, to: PATHS.space(r.id), icon: r.icon || "home" })), [rows]);
}

/** Calls `refresh` (debounced) when records of these entities change, or after the live feed reconnects. */
export function useLiveRefresh(entities: string[], refresh: () => void, delay = 800) {
  const cb = useRef(refresh);
  useEffect(() => {
    cb.current = refresh;
  });
  const key = entities.join("|");
  useEffect(() => {
    if (!key) return;
    const names = new Set(key.split("|"));
    const unsubscribe = [...names].map((e) => live.subscribe(e));
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(() => cb.current(), delay);
    };
    const offs = [
      live.onEvent((e) => {
        if (names.has(e.entity)) later();
      }),
      live.onResync(later),
    ];
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
      unsubscribe.forEach((u) => u());
    };
  }, [key, delay]);
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useReducedMotion = () => useMediaQuery("(prefers-reduced-motion: reduce)");
