export type TileProviderResolution =
  | { status: "ready"; styleUrl: string }
  | {
      status: "not_configured";
      reason: "Map tiles are not configured. No public tile server is used as a fallback.";
    };

/**
 * Android route maps use MapLibre and a style URL you provide.
 * An empty or demo-tile URL is rejected so a public endpoint cannot become production by accident.
 */
export function resolveTileProvider(styleUrl: string | undefined | null): TileProviderResolution {
  const trimmed = styleUrl?.trim() ?? "";
  if (!trimmed) {
    return {
      status: "not_configured",
      reason: "Map tiles are not configured. No public tile server is used as a fallback.",
    };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      status: "not_configured",
      reason: "Map tiles are not configured. No public tile server is used as a fallback.",
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      status: "not_configured",
      reason: "Map tiles are not configured. No public tile server is used as a fallback.",
    };
  }
  return { status: "ready", styleUrl: trimmed };
}

// --- Route display -----------------------------------------------------------------
// Pure transformations from stored GPS points to what a map or outline needs. They never
// modify the stored points: everything here builds a separate, display-only copy.

/** GeoJSON order: [longitude, latitude]. */
export type RouteCoordinate = [number, number];

export type RouteBounds = { sw: RouteCoordinate; ne: RouteCoordinate };

function isUsableCoordinate(latitude: unknown, longitude: unknown): boolean {
  if (typeof latitude !== "number" || typeof longitude !== "number") return false;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return false;
  // Exactly 0,0 is what a failed fix commonly reports, and it sits in the open ocean.
  if (latitude === 0 && longitude === 0) return false;
  return true;
}

/**
 * Turns stored points into a drawable route. Malformed coordinates (missing, NaN, out of
 * range, or the 0,0 placeholder) are skipped rather than thrown on, and a point identical to
 * the one before it is dropped so a stationary stretch does not pile up duplicates.
 */
export function toRouteCoordinates(points: ReadonlyArray<{ latitude: unknown; longitude: unknown }>): RouteCoordinate[] {
  const route: RouteCoordinate[] = [];
  for (const point of points) {
    if (!point || !isUsableCoordinate(point.latitude, point.longitude)) continue;
    const coordinate: RouteCoordinate = [point.longitude as number, point.latitude as number];
    const previous = route[route.length - 1];
    if (previous && previous[0] === coordinate[0] && previous[1] === coordinate[1]) continue;
    route.push(coordinate);
  }
  return route;
}

/**
 * Bounding box of a route. A single point (or a route smaller than `minSpanDegrees`) is
 * widened around its center so a map camera never gets a zero-size box to fit.
 * Routes that cross the 180th meridian are not handled specially.
 */
export function routeBounds(route: ReadonlyArray<RouteCoordinate>, minSpanDegrees = 0.002): RouteBounds | null {
  if (route.length === 0) return null;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of route) {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  if (maxLng - minLng < minSpanDegrees) {
    const center = (minLng + maxLng) / 2;
    minLng = center - minSpanDegrees / 2;
    maxLng = center + minSpanDegrees / 2;
  }
  if (maxLat - minLat < minSpanDegrees) {
    const center = (minLat + maxLat) / 2;
    minLat = center - minSpanDegrees / 2;
    maxLat = center + minSpanDegrees / 2;
  }
  return { sw: [minLng, minLat], ne: [maxLng, maxLat] };
}

function segmentDistance(p: RouteCoordinate, a: RouteCoordinate, b: RouteCoordinate, lngScale: number): number {
  const px = p[0] * lngScale;
  const py = p[1];
  const ax = a[0] * lngScale;
  const ay = a[1];
  const bx = b[0] * lngScale;
  const by = b[1];
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function douglasPeucker(route: ReadonlyArray<RouteCoordinate>, epsilon: number, lngScale: number): RouteCoordinate[] {
  const keep = new Array<boolean>(route.length).fill(false);
  keep[0] = true;
  keep[route.length - 1] = true;
  const stack: Array<[number, number]> = [[0, route.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let farthest = -1;
    let farthestDistance = epsilon;
    for (let index = start + 1; index < end; index += 1) {
      const distance = segmentDistance(route[index] as RouteCoordinate, route[start] as RouteCoordinate, route[end] as RouteCoordinate, lngScale);
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }
  return route.filter((_, index) => keep[index]);
}

const SIMPLIFY_PRE_SAMPLE = 4000;

/**
 * Display-only simplification (Douglas-Peucker) so a long route is drawn as one line with a
 * bounded number of vertices. The first and last points are always kept, and the input array
 * is never modified — the recorded points in SQLite stay exactly as recorded.
 */
export function simplifyRoute(route: ReadonlyArray<RouteCoordinate>, maxPoints: number): RouteCoordinate[] {
  const limit = Math.max(2, Math.floor(maxPoints));
  if (route.length <= limit) return route.slice();

  let working: ReadonlyArray<RouteCoordinate> = route;
  if (working.length > SIMPLIFY_PRE_SAMPLE) {
    const stride = working.length / SIMPLIFY_PRE_SAMPLE;
    const sampled: RouteCoordinate[] = [];
    for (let index = 0; index < SIMPLIFY_PRE_SAMPLE; index += 1) sampled.push(working[Math.floor(index * stride)] as RouteCoordinate);
    sampled[sampled.length - 1] = working[working.length - 1] as RouteCoordinate;
    working = sampled;
  }
  if (working.length <= limit) return working.slice();

  const bounds = routeBounds(working, 0) as RouteBounds;
  const meanLat = (bounds.sw[1] + bounds.ne[1]) / 2;
  const lngScale = Math.cos((meanLat * Math.PI) / 180);
  let low = 0;
  let high = Math.hypot((bounds.ne[0] - bounds.sw[0]) * lngScale, bounds.ne[1] - bounds.sw[1]);
  for (let round = 0; round < 14; round += 1) {
    const middle = (low + high) / 2;
    if (douglasPeucker(working, middle, lngScale).length > limit) low = middle;
    else high = middle;
  }
  return douglasPeucker(working, high, lngScale);
}

export type RouteLineFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: { type: "LineString"; coordinates: RouteCoordinate[] };
};

/** A line needs at least two distinct points; fewer returns null so callers show an empty state instead. */
export function routeToLineFeature(route: ReadonlyArray<RouteCoordinate>): RouteLineFeature | null {
  if (route.length < 2) return null;
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: route.slice() } };
}

/**
 * Fits a route into a width x height box (equirectangular, aspect ratio preserved, centered)
 * for the tile-free outline. Returns pixel coordinates with y pointing down.
 */
export function projectRouteToViewport(
  route: ReadonlyArray<RouteCoordinate>,
  width: number,
  height: number,
  padding = 12,
): Array<[number, number]> {
  if (route.length === 0 || width <= 0 || height <= 0) return [];
  const bounds = routeBounds(route) as RouteBounds;
  const meanLat = (bounds.sw[1] + bounds.ne[1]) / 2;
  const lngScale = Math.cos((meanLat * Math.PI) / 180);
  const spanX = (bounds.ne[0] - bounds.sw[0]) * lngScale;
  const spanY = bounds.ne[1] - bounds.sw[1];
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  const scale = Math.min(innerWidth / spanX, innerHeight / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  return route.map(([lng, lat]) => [offsetX + (lng - bounds.sw[0]) * lngScale * scale, offsetY + (bounds.ne[1] - lat) * scale]);
}

export type RouteMapAvailability =
  | { status: "tiles"; styleUrl: string }
  | { status: "outline_only"; reason: "web_preview" | "tiles_not_configured" | "map_library_missing"; message: string };

/**
 * Decides whether a real tile map can be shown. When it cannot, the route is still drawn as
 * an outline from the stored points, and the reason is stated instead of hidden.
 */
export function routeMapAvailability(input: {
  surface: "ios" | "android" | "web-preview";
  styleUrl: string | undefined | null;
  nativeMapLibraryAvailable: boolean;
}): RouteMapAvailability {
  if (input.surface === "web-preview") {
    return {
      status: "outline_only",
      reason: "web_preview",
      message: "The browser preview does not draw tile maps. This is the saved route outline without a base map.",
    };
  }
  const tiles = resolveTileProvider(input.styleUrl);
  if (tiles.status !== "ready") {
    return {
      status: "outline_only",
      reason: "tiles_not_configured",
      message: "No map tile style is configured, so only the route outline is shown. No public tile server is used as a fallback.",
    };
  }
  if (!input.nativeMapLibraryAvailable) {
    return {
      status: "outline_only",
      reason: "map_library_missing",
      message: "The map library is not part of this build, so only the route outline is shown.",
    };
  }
  return { status: "tiles", styleUrl: tiles.styleUrl };
}
