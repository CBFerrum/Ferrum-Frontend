// The kit's map (gapclose/design/S6-maps.md §2.10): places and routes on a map drawn with MapLibre from the style Maps serves at
// Ferrum's own address (its PMTiles base map read by range from the same origin, so no app's security policy changes). The map
// is decoration for sighted mouse and touch users: the same places are always a list beside it, which is the keyboard and
// screen-reader path, and choosing in either chooses in both. MapLibre and the PMTiles reader load in a chunk of their own
// (./engine), only once a page shows a map on a device that can draw one.

import { useEffect, useRef, useState } from "react";
import { bootstrap, t } from "@ferrum/client";
import { cn } from "../../../../src/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "../../../../src/ui/patterns";

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  kind: "job" | "person" | "vehicle" | "stop" | "depot";
  /** Its state in words, shown in the list beside the label. */
  status?: string;
}

export interface MapLine {
  id: string;
  /** An encoded polyline (./polyline). */
  polyline: string;
  precision: 5 | 6;
  kind: string;
}

type Style = Record<string, unknown>;

/** What ./engine gives back for a drawn map: told of each change, and taken down with the view. */
export interface MapHandle {
  update(o: { markers: MapMarker[]; lines: MapLine[]; selected: string | null; fit: boolean }): void;
  destroy(): void;
}

/** What ./engine draws: the style (null: no base map, a plain background), the places and routes, and the choice. */
export interface MapDraw {
  style: Style | null;
  markers: MapMarker[];
  lines: MapLine[];
  selected: string | null;
  fit: boolean;
  onSelect(id: string): void;
}
type Loaded = { state: "loading" } | { state: "absent" } | { state: "failed"; error: unknown } | { state: "ready"; style: Style | null };

/** Whether this device can draw the map at all (WebGL); the list stands alone where it cannot. */
function canDraw(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Maps' style for the page's light or dark appearance. */
function defaultStyleUrl(): string {
  const chosen = bootstrap()?.theme?.appearance;
  const dark = chosen === "dark" || (chosen === "system" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches);
  return `/api/app/maps/style.json?theme=${dark ? "dark" : "light"}`;
}

export function MapView({
  markers,
  lines = [],
  selected,
  onSelect,
  fit = true,
  styleUrl,
  className,
}: {
  markers: MapMarker[];
  lines?: MapLine[];
  /** The chosen marker, when the caller keeps it; else the map keeps its own. */
  selected?: string | null;
  onSelect?: (id: string) => void;
  /** Frame every marker and line when they change. */
  fit?: boolean;
  styleUrl?: string;
  className?: string;
}) {
  const [drawable] = useState(canDraw);
  const [own, setOwn] = useState<string | null>(null);
  const chosen = selected !== undefined ? selected : own;
  const choose = (id: string) => {
    setOwn(id);
    onSelect?.(id);
  };
  const url = styleUrl ?? defaultStyleUrl();
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const handle = useRef<MapHandle | null>(null);
  const latest = useRef({ markers, lines, chosen, fit, choose });
  latest.current = { markers, lines, chosen, fit, choose };

  // The style: 404 means Maps is not installed; `basemap: null` means no base map has been uploaded yet.
  useEffect(() => {
    if (!drawable) return;
    const stop = new AbortController();
    setLoaded({ state: "loading" });
    fetch(url, { credentials: "same-origin", headers: { accept: "application/json" }, signal: stop.signal })
      .then(async (res) => {
        if (res.status === 404) return setLoaded({ state: "absent" });
        if (!res.ok) throw new Error(t("The map's style could not be read ({status}).", { status: res.status }));
        const { basemap, ...style } = (await res.json()) as Style & { basemap?: unknown };
        setLoaded({ state: "ready", style: basemap === null ? null : style });
      })
      .catch((error) => !stop.signal.aborted && setLoaded({ state: "failed", error }));
    return () => stop.abort();
  }, [drawable, url, attempt]);

  // The map, once its style is in: made once per style, told of every later change.
  useEffect(() => {
    if (loaded.state !== "ready" || !box.current) return;
    let live = true;
    const el = box.current;
    void import("./engine")
      .then(({ createMap }) => {
        const now = latest.current;
        return createMap(el, { style: loaded.style, markers: now.markers, lines: now.lines, selected: now.chosen, fit: now.fit, onSelect: (id) => latest.current.choose(id) });
      })
      .then((h) => {
        if (live) handle.current = h;
        else h.destroy();
      })
      .catch((error) => live && setLoaded({ state: "failed", error }));
    return () => {
      live = false;
      handle.current?.destroy();
      handle.current = null;
    };
  }, [loaded]);

  useEffect(() => {
    handle.current?.update({ markers, lines, selected: chosen, fit });
  }, [markers, lines, chosen, fit]);

  return (
    <div className={cn("grid gap-3 md:grid-cols-[minmax(0,1fr)_16rem]", className)}>
      <div className="relative min-h-80 overflow-hidden rounded-md border border-border bg-muted">
        {!drawable ? (
          <p className="p-4 text-sm text-muted-foreground">{t("This device cannot draw the map: the list shows every place.")}</p>
        ) : loaded.state === "absent" ? (
          <StatePanel kind="empty" title={t("Maps is not installed")}>
            {t("Install the Maps app to see these places on a map. The list shows every place.")}
          </StatePanel>
        ) : loaded.state === "failed" ? (
          <StatePanel kind="failed" error={loaded.error} onRetry={() => setAttempt((n) => n + 1)} />
        ) : (
          <>
            {loaded.state === "loading" && <Skeleton className="absolute inset-0" />}
            <div ref={box} data-map aria-hidden="true" className="absolute inset-0" />
            {loaded.state === "ready" && loaded.style === null && (
              <p className="absolute inset-x-2 top-2 rounded-md bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm">{t("No base map yet: an administrator adds one in Maps")}</p>
            )}
          </>
        )}
      </div>
      <ul className="flex max-h-80 flex-col gap-1 overflow-auto" aria-label={t("Places on the map")}>
        {markers.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              className={cn("btn btn-ghost btn-md w-full justify-start text-start", m.id === chosen && "bg-accent")}
              aria-current={m.id === chosen ? "true" : undefined}
              onClick={() => choose(m.id)}
            >
              {m.status ? `${m.label} · ${m.status}` : m.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
