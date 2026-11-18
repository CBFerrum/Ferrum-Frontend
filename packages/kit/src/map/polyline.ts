// An encoded polyline (the format routers give a route's shape in: Google's, precision 5; Valhalla's and OSRM's polyline6,
// precision 6) as [lat, lng] points. A string cut short ends at the last whole point.

export function decodePolyline(text: string, precision: 5 | 6 = 6): [number, number][] {
  const factor = 10 ** precision;
  const out: [number, number][] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let shift = 0;
    let result = 0;
    for (;;) {
      if (i >= text.length) return null;
      const b = text.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
      if (b < 0x20) return result & 1 ? ~(result >> 1) : result >> 1;
    }
  };
  while (i < text.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    out.push([lat / factor, lng / factor]);
  }
  return out;
}
