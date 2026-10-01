import type { TileMapProps } from "./types";

/** The browser preview does not draw tile maps. RouteMap shows the tile-free outline instead. */
export const nativeTileMapAvailable = false;

export function TileMap(_props: TileMapProps) {
  return null;
}
