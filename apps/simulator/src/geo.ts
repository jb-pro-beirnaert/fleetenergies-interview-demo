const EARTH_RADIUS_KM = 6371;
/** Road distance = straight-line distance × 1.25 (spec 04). */
export const ROAD_FACTOR = 1.25;

export interface Point {
  lat: number;
  lon: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

export const roadKm = (a: Point, b: Point): number =>
  haversineKm(a, b) * ROAD_FACTOR;

export const lerp = (a: Point, b: Point, fraction: number): Point => ({
  lat: a.lat + (b.lat - a.lat) * fraction,
  lon: a.lon + (b.lon - a.lon) * fraction,
});
