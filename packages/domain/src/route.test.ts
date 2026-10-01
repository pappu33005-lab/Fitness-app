import { describe, expect, it } from "vitest";
import {
  projectRouteToViewport,
  routeBounds,
  routeMapAvailability,
  routeToLineFeature,
  simplifyRoute,
  toRouteCoordinates,
  type RouteCoordinate,
} from "./maps";

describe("toRouteCoordinates", () => {
  it("turns valid GPS points into [lng, lat] coordinates in order", () => {
    const route = toRouteCoordinates([
      { latitude: 47.6, longitude: -122.3 },
      { latitude: 47.61, longitude: -122.31 },
    ]);
    expect(route).toEqual([[-122.3, 47.6], [-122.31, 47.61]]);
  });

  it("safely ignores malformed coordinates", () => {
    const route = toRouteCoordinates([
      { latitude: NaN, longitude: 10 },
      { latitude: null, longitude: 10 },
      { latitude: "47.6", longitude: 10 },
      { latitude: 91, longitude: 10 },
      { latitude: 10, longitude: 181 },
      { latitude: undefined, longitude: undefined },
      { latitude: 0, longitude: 0 },
      { latitude: 10, longitude: 20 },
    ]);
    expect(route).toEqual([[20, 10]]);
  });

  it("returns an empty route for no points", () => {
    expect(toRouteCoordinates([])).toEqual([]);
  });

  it("drops consecutive duplicates but keeps a returning revisit", () => {
    const route = toRouteCoordinates([
      { latitude: 1, longitude: 1 },
      { latitude: 1, longitude: 1 },
      { latitude: 2, longitude: 2 },
      { latitude: 1, longitude: 1 },
    ]);
    expect(route).toEqual([[1, 1], [2, 2], [1, 1]]);
  });

  it("does not modify its input", () => {
    const input = [{ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 }];
    toRouteCoordinates(input);
    expect(input).toHaveLength(2);
  });
});

describe("routeBounds", () => {
  it("covers every coordinate", () => {
    const bounds = routeBounds([[-122.3, 47.6], [-122.1, 47.9], [-122.2, 47.7]]);
    expect(bounds).toEqual({ sw: [-122.3, 47.6], ne: [-122.1, 47.9] });
  });

  it("returns null for an empty route", () => {
    expect(routeBounds([])).toBeNull();
  });

  it("widens a single point so a camera never gets a zero-size box", () => {
    const bounds = routeBounds([[10, 20]]);
    expect(bounds).not.toBeNull();
    expect(bounds!.ne[0]).toBeGreaterThan(bounds!.sw[0]);
    expect(bounds!.ne[1]).toBeGreaterThan(bounds!.sw[1]);
  });
});

describe("routeToLineFeature", () => {
  it("needs at least two points", () => {
    expect(routeToLineFeature([])).toBeNull();
    expect(routeToLineFeature([[1, 1]])).toBeNull();
    expect(routeToLineFeature([[1, 1], [2, 2]])?.geometry.type).toBe("LineString");
  });
});

describe("simplifyRoute", () => {
  const line: RouteCoordinate[] = Array.from({ length: 2000 }, (_, index) => [index * 0.0001, Math.sin(index / 40) * 0.002]);

  it("bounds the number of vertices, keeps both ends, and leaves the input unchanged", () => {
    const copy = line.map((c) => [...c]);
    const simplified = simplifyRoute(line, 150);
    expect(simplified.length).toBeLessThanOrEqual(150);
    expect(simplified.length).toBeGreaterThan(2);
    expect(simplified[0]).toEqual(line[0]);
    expect(simplified[simplified.length - 1]).toEqual(line[line.length - 1]);
    expect(line).toEqual(copy);
  });

  it("returns a route already under the limit as-is", () => {
    const short: RouteCoordinate[] = [[0, 0.001], [0.001, 0.002], [0.002, 0.001]];
    expect(simplifyRoute(short, 100)).toEqual(short);
  });

  it("handles a very long route within the limit", () => {
    const huge: RouteCoordinate[] = Array.from({ length: 12000 }, (_, index) => [index * 0.00001, Math.cos(index / 100) * 0.001]);
    const simplified = simplifyRoute(huge, 300);
    expect(simplified.length).toBeLessThanOrEqual(300);
    expect(simplified[simplified.length - 1]).toEqual(huge[huge.length - 1]);
  });
});

describe("projectRouteToViewport", () => {
  it("keeps every point inside the box", () => {
    const projected = projectRouteToViewport([[-122.3, 47.6], [-122.1, 47.9], [-122.2, 47.7]], 300, 200, 10);
    for (const [x, y] of projected) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(300);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(200);
    }
  });

  it("puts north above south (y grows downward)", () => {
    const [south, north] = projectRouteToViewport([[10, 10], [10, 10.01]], 100, 100);
    expect(north![1]).toBeLessThan(south![1]);
  });

  it("returns nothing for an empty route or an unmeasured box", () => {
    expect(projectRouteToViewport([], 100, 100)).toEqual([]);
    expect(projectRouteToViewport([[1, 1], [2, 2]], 0, 100)).toEqual([]);
  });
});

describe("routeMapAvailability", () => {
  const https = "https://tiles.example.test/style.json";

  it("offers tiles only when native, configured with https, and the library is present", () => {
    expect(routeMapAvailability({ surface: "ios", styleUrl: https, nativeMapLibraryAvailable: true })).toEqual({ status: "tiles", styleUrl: https });
    expect(routeMapAvailability({ surface: "android", styleUrl: https, nativeMapLibraryAvailable: true }).status).toBe("tiles");
  });

  it("falls back to the outline with a stated reason otherwise", () => {
    const web = routeMapAvailability({ surface: "web-preview", styleUrl: https, nativeMapLibraryAvailable: true });
    expect(web.status === "outline_only" && web.reason).toBe("web_preview");
    const unset = routeMapAvailability({ surface: "ios", styleUrl: "", nativeMapLibraryAvailable: true });
    expect(unset.status === "outline_only" && unset.reason).toBe("tiles_not_configured");
    const insecure = routeMapAvailability({ surface: "ios", styleUrl: "http://tiles.example.test/style.json", nativeMapLibraryAvailable: true });
    expect(insecure.status === "outline_only" && insecure.reason).toBe("tiles_not_configured");
    const missing = routeMapAvailability({ surface: "android", styleUrl: https, nativeMapLibraryAvailable: false });
    expect(missing.status === "outline_only" && missing.reason).toBe("map_library_missing");
  });
});
