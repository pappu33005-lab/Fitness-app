import type { RouteBounds, RouteCoordinate, RouteLineFeature } from "@vitacore/domain";

export type TileMapProps = {
  styleUrl: string;
  line: RouteLineFeature | null;
  bounds: RouteBounds | null;
  /** Most recent route point. Drawn as the "you are here" dot while recording; no second location source is used. */
  current: RouteCoordinate | null;
  follow: boolean;
  height: number;
  onLoaded: () => void;
  onFailed: () => void;
};
