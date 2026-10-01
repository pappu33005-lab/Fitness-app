/**
 * Native tile map (iOS and Android) using MapLibre.
 *
 * STATUS: written against the @maplibre/maplibre-react-native v10 component API
 * (MapView, Camera, ShapeSource, LineLayer, CircleLayer) from memory. The package is NOT
 * installed in this project yet and this file has never been run. Install it with
 * `npx expo install @maplibre/maplibre-react-native` (or the package's documented command),
 * rebuild the development build, and re-check these props against the installed version;
 * a newer major version renamed several components.
 *
 * The library is loaded optionally: if it is missing from the build, `nativeTileMapAvailable`
 * is false and RouteMap draws the tile-free outline instead of failing.
 *
 * Privacy: the only thing sent to the tile host is what any map view sends to fetch tiles for
 * the visible area. The route itself is drawn on the device and is never uploaded here.
 */
import { View } from "react-native";
import type { TileMapProps } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */
let library: any = null;
try {
  library = require("@maplibre/maplibre-react-native");
} catch {
  library = null;
}
const MapView = library?.MapView ?? library?.default?.MapView;
const Camera = library?.Camera ?? library?.default?.Camera;
const ShapeSource = library?.ShapeSource ?? library?.default?.ShapeSource;
const LineLayer = library?.LineLayer ?? library?.default?.LineLayer;
const CircleLayer = library?.CircleLayer ?? library?.default?.CircleLayer;
/* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/no-require-imports */

export const nativeTileMapAvailable = Boolean(MapView && Camera && ShapeSource && LineLayer && CircleLayer);

export function TileMap({ styleUrl, line, bounds, current, follow, height, onLoaded, onFailed }: TileMapProps) {
  if (!nativeTileMapAvailable) return null;
  const point = current ? { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: current } } : null;

  return (
    <View style={{ height }}>
      <MapView
        style={{ flex: 1 }}
        mapStyle={styleUrl}
        logoEnabled={false}
        attributionEnabled
        compassEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onDidFinishLoadingMap={onLoaded}
        onDidFailLoadingMap={onFailed}
      >
        {follow && current ? (
          <Camera centerCoordinate={current} zoomLevel={16} animationDuration={600} />
        ) : bounds ? (
          <Camera
            bounds={{ ne: bounds.ne, sw: bounds.sw, paddingTop: 32, paddingBottom: 32, paddingLeft: 32, paddingRight: 32 }}
            animationDuration={0}
          />
        ) : null}
        {line ? (
          <ShapeSource id="vitacore-route" shape={line}>
            <LineLayer id="vitacore-route-line" style={{ lineColor: "#E7A15A", lineWidth: 4, lineCap: "round", lineJoin: "round" }} />
          </ShapeSource>
        ) : null}
        {point ? (
          <ShapeSource id="vitacore-current" shape={point}>
            <CircleLayer
              id="vitacore-current-dot"
              style={{ circleRadius: 7, circleColor: "#FFFFFF", circleStrokeColor: "#E7A15A", circleStrokeWidth: 3 }}
            />
          </ShapeSource>
        ) : null}
      </MapView>
    </View>
  );
}
