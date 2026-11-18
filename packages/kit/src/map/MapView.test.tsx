// @vitest-environment jsdom
// The kit's map (gapclose/design/S6-maps.md §2.10, slice K1): the places it shows are always a list beside the map (the keyboard
// and screen-reader path); the map itself draws only where the device has WebGL, from the style Maps serves at Ferrum's own
// address, and says plainly when Maps is not installed, when there is no base map yet, or when the style could not be read.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapMarker } from "./MapView";

const engine = vi.hoisted(() => ({
  created: [] as { style: unknown; markers: unknown; selected: unknown; onSelect: (id: string) => void }[],
  updates: [] as { selected?: string | null }[],
}));
vi.mock("./engine", () => ({
  createMap: async (_el: HTMLElement, o: { style: unknown; markers: unknown; selected: unknown; onSelect: (id: string) => void }) => {
    engine.created.push(o);
    return { update: (u: { selected?: string | null }) => void engine.updates.push(u), destroy: () => {} };
  },
}));
import { MapView } from "./MapView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: Root[] = [];
let webgl = true;
beforeEach(() => {
  engine.created.length = 0;
  engine.updates.length = 0;
  webgl = true;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation((() => (webgl ? {} : null)) as never);
});
afterEach(() => {
  act(() => roots.splice(0).forEach((r) => r.unmount()));
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MARKERS: MapMarker[] = [
  { id: "m1", lat: 51.5, lng: -0.12, label: "Repair at Asha's", kind: "job", status: "Scheduled" },
  { id: "m2", lat: 51.51, lng: -0.1, label: "Van 3", kind: "vehicle" },
];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 20))));

async function draw(style: (url: string) => Response, props: Partial<Parameters<typeof MapView>[0]> = {}) {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (fetched.push(String(url)), style(String(url)))));
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<MapView markers={MARKERS} {...props} />));
  await settle();
  await settle();
  return { host, fetched };
}
const listItems = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("li button")];

describe("MapView", () => {
  it("renders_the_marker_list_without_webgl", async () => {
    webgl = false;
    const { host, fetched } = await draw(() => json(200, { version: 8, sources: {}, layers: [] }));
    expect(listItems(host).map((b) => b.textContent)).toEqual(["Repair at Asha's · Scheduled", "Van 3"]);
    expect(host.textContent).toContain("This device cannot draw the map: the list shows every place.");
    expect(engine.created).toEqual([]);
    expect(fetched).toEqual([]);
  });

  it("shows_not_installed_on_404_style", async () => {
    const { host, fetched } = await draw(() => json(404, { error: "not_found", message: "no such app" }));
    expect(fetched).toEqual(["/api/app/maps/style.json?theme=light"]);
    expect(host.querySelector('[data-state-kind="empty"]')?.textContent).toContain("Maps is not installed");
    expect(engine.created).toEqual([]);
    expect(listItems(host)).toHaveLength(2);
  });

  it("shows_no_base_map_note", async () => {
    const { host } = await draw(() => json(200, { version: 8, basemap: null, sources: {}, layers: [] }));
    expect(host.textContent).toContain("No base map yet: an administrator adds one in Maps");
    // The markers still draw, on a plain background.
    expect(engine.created).toHaveLength(1);
    expect(engine.created[0].style).toBeNull();
    expect(engine.created[0].markers).toEqual(MARKERS);
  });

  it("draws the style Maps serves, without its own note", async () => {
    const style = { version: 8, basemap: { name: "Europe" }, sources: { protomaps: { type: "vector", url: "pmtiles:///api/app/maps/basemap.pmtiles" } }, layers: [] };
    const { host } = await draw(() => json(200, style), { styleUrl: "/x/style.json" });
    expect(engine.created[0].style).toEqual({ version: 8, sources: style.sources, layers: [] });
    expect(host.textContent).not.toContain("No base map yet");
  });

  it("says when the style could not be read, and tries again", async () => {
    let n = 0;
    const { host } = await draw(() => (n++ ? json(200, { version: 8, sources: {}, layers: [] }) : json(500, { error: "server_error", message: "boom" })));
    expect(host.querySelector('[data-state-kind="failed"]')).not.toBeNull();
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    await act(async () => retry.click());
    await settle();
    expect(host.querySelector('[data-state-kind="failed"]')).toBeNull();
    expect(engine.created).toHaveLength(1);
  });

  it("selecting_in_the_list_selects_on_the_map", async () => {
    const picked: string[] = [];
    const { host } = await draw(() => json(200, { version: 8, sources: {}, layers: [] }), { onSelect: (id) => picked.push(id) });
    const map = host.querySelector("[data-map]")!;
    expect(map.getAttribute("aria-hidden")).toBe("true");
    await act(async () => listItems(host)[1].click());
    expect(picked).toEqual(["m2"]);
    expect(engine.updates.at(-1)?.selected).toBe("m2");
    expect(listItems(host).map((b) => b.getAttribute("aria-current"))).toEqual([null, "true"]);
    // And a marker chosen on the map is the one chosen in the list.
    await act(async () => engine.created[0].onSelect("m1"));
    expect(picked).toEqual(["m2", "m1"]);
    expect(listItems(host).map((b) => b.getAttribute("aria-current"))).toEqual(["true", null]);
  });
});

// The map's library and the PMTiles reader are a chunk of their own (§2.10): only engine.ts imports them, and it is imported only
// by `import()`, so neither is in any page's entry script (scripts/budgets.mjs measures what the build put there).
it("maplibre_is_not_in_the_entry_chunk", () => {
  const root = join(__dirname, "..", "..", "..", "..");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return n === "node_modules" || n.startsWith("dist") ? [] : statSync(p).isDirectory() ? files(p) : /\.(tsx?|mjs)$/.test(n) && !/\.test\./.test(n) ? [p] : [];
    });
  const all = ["src", "apps", "packages"].flatMap((d) => files(join(root, d)));
  const heavy = all.filter((f) => /from\s+["'](maplibre-gl|pmtiles)["']|import\s+["']maplibre-gl/.test(readFileSync(f, "utf8")));
  expect(heavy.map((f) => f.slice(root.length + 1))).toEqual(["packages/kit/src/map/engine.ts"]);
  const engineStatic = all.filter((f) => /from\s+["']\.\/engine["']|from\s+["'][^"']*map\/engine["']/.test(readFileSync(f, "utf8")));
  expect(engineStatic).toEqual([]);
});
