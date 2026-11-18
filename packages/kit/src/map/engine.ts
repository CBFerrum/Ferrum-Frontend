// The drawing half of the kit's map (MapView.tsx), a chunk of its own: MapLibre (BSD-3-Clause) and the PMTiles reader
// (BSD-3-Clause), loaded only by `import("./engine")`. Nothing else may import either (MapView.test.tsx checks it).
// Colours come from the page's tokens, read off the page, never written here.

import maplibregl, { type GeoJSONSource, type StyleSpecification } from "maplibre-gl";
import { Protocol } from "pmtiles";
import "maplibre-gl/dist/maplibre-gl.css";
import type { MapDraw, MapHandle, MapLine, MapMarker } from "./MapView";
import { decodePolyline } from "./polyline";

let protocol = false;

/** A token of the page as a colour MapLibre reads (`rgb(…)`): set on a probe and read back, so light-dark() resolves too. */
function token(el: HTMLElement, name: string): string {
  const probe = el.ownerDocument.createElement("span");
  probe.style.color = `var(${name})`;
  el.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || "gray";
}

/** No base map yet: a plain background in the page's colour, and the places on it. */
const plain = (el: HTMLElement): StyleSpecification => ({ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": token(el, "--muted") } }] });

const shapes = (lines: MapLine[]) => ({
  type: "FeatureCollection" as const,
  features: lines.map((l) => ({
    type: "Feature" as const,
    id: l.id,
    properties: { kind: l.kind },
    geometry: { type: "LineString" as const, coordinates: decodePolyline(l.polyline, l.precision).map(([lat, lng]) => [lng, lat]) },
  })),
});

export async function createMap(el: HTMLElement, o: MapDraw): Promise<MapHandle> {
  if (!protocol) {
    // Base maps are one PMTiles file Maps serves by range from this origin (`pmtiles:///api/app/maps/basemap.pmtiles`).
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    protocol = true;
  }
  const map = new maplibregl.Map({
    container: el,
    style: (o.style as unknown as StyleSpecification | null) ?? plain(el),
    attributionControl: { compact: false }, // always shown: the base map is OpenStreetMap's (ODbL)
    center: o.markers[0] ? [o.markers[0].lng, o.markers[0].lat] : [0, 20],
    zoom: o.markers.length ? 11 : 1,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  // Routes need the style in; markers do not, so they show even while a base map's tiles are slow or failing.
  map.once("load", () => {
    map.addSource("ferrum-lines", { type: "geojson", data: shapes(state.lines) });
    map.addLayer({ id: "ferrum-lines", type: "line", source: "ferrum-lines", paint: { "line-color": token(el, "--primary"), "line-width": 4, "line-opacity": 0.8 } });
    if (state.fit) frame(state.markers, state.lines);
  });

  const pins = new Map<string, maplibregl.Marker>();
  let state = { markers: o.markers, lines: o.lines, selected: o.selected, fit: o.fit };

  function draw(next: typeof state, refit: boolean) {
    for (const [id, pin] of pins) {
      if (!next.markers.some((m) => m.id === id)) {
        pin.remove();
        pins.delete(id);
      }
    }
    for (const m of next.markers) {
      let pin = pins.get(m.id);
      if (!pin) {
        const dot = el.ownerDocument.createElement("div");
        dot.addEventListener("click", (e) => {
          e.stopPropagation();
          o.onSelect(m.id);
        });
        pin = new maplibregl.Marker({ element: dot }).setLngLat([m.lng, m.lat]).addTo(map);
        pins.set(m.id, pin);
      }
      pin.setLngLat([m.lng, m.lat]);
      const dot = pin.getElement();
      dot.className = `map-marker map-marker-${m.kind}${m.id === next.selected ? " map-marker-selected" : ""}`;
      dot.title = m.label;
    }
    // Before the style is in, the routes wait for "load", which reads `state`.
    (map.getSource("ferrum-lines") as GeoJSONSource | undefined)?.setData(shapes(next.lines));
    const chosen = next.markers.find((m) => m.id === next.selected);
    if (chosen && next.selected !== state.selected) map.easeTo({ center: [chosen.lng, chosen.lat] });
    if (refit && next.fit) frame(next.markers, next.lines);
    state = next;
  }

  function frame(markers: MapMarker[], lines: MapLine[]) {
    const points = [...markers.map((m) => [m.lng, m.lat] as [number, number]), ...lines.flatMap((l) => decodePolyline(l.polyline, l.precision).map(([lat, lng]) => [lng, lat] as [number, number]))];
    if (points.length < 2) return;
    const bounds = points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0], points[0]));
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
  }

  draw(state, true);
  return {
    update: (u) => draw(u, u.markers !== state.markers || u.lines !== state.lines),
    destroy: () => map.remove(),
  };
}
