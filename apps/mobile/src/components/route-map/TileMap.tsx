/**
 * Native tile map (iOS and Android) using @maplibre/maplibre-react-native 11.4.
 *
 * v11 renamed MapView → Map, ShapeSource → GeoJSONSource, and LineLayer/CircleLayer → Layer.
 * The package is a native module: a development build is required before tiles can render.
 * If the JavaScript module cannot be loaded, RouteMap keeps the SVG outline.
 *
 * Privacy: the tile host sees the requests any map view makes for the visible area.
 * The route geometry is drawn on the device and is not uploaded by this component.
 */
import type { ComponentType } from "react";
import { View } from "react-native";
import type {
  CameraProps,
  CircleLayerSpecification,
  GeoJSONSourceProps,
  LayerProps,
  LineLayerSpecification,
  MapProps,
} from "@maplibre/maplibre-react-native";
import type { TileMapProps } from "./types";

type MapLibreModule = {
  Map?: ComponentType<MapProps>;
  Camera?: ComponentType<CameraProps>;
  GeoJSONSource?: ComponentType<GeoJSONSourceProps>;
  Layer?: ComponentType<LayerProps>;
};

/* eslint-disable @typescript-eslint/no-require-imports */
let library: MapLibreModule | null = null;
try {
  library = require("@maplibre/maplibre-react-native") as MapLibreModule;
} catch {
  library = null;
}
/* eslint-enable @typescript-eslint/no-require-imports */

const routeLineLayer: LineLayerSpecification = {
  id: "vitacore-route-line",
  type: "line",
  source: "vitacore-route",
  layout: {
    "line-cap": "round",
    "line-join": "round",
  },
  paint: {
    "line-color": "#E7A15A",
    "line-width": 4,
  },
};

const currentPointLayer: CircleLayerSpecification = {
  id: "vitacore-current-dot",
  type: "circle",
  source: "vitacore-current",
  paint: {
    "circle-radius": 7,
    "circle-color": "#FFFFFF",
    "circle-stroke-color": "#E7A15A",
    "circle-stroke-width": 3,
  },
};

const Map = library?.Map;
const Camera = library?.Camera;
const GeoJSONSource = library?.GeoJSONSource;
const Layer = library?.Layer;

export const nativeTileMapAvailable = Boolean(Map && Camera && GeoJSONSource && Layer);

export function TileMap({ styleUrl, line, bounds, current, follow, height, onLoaded, onFailed }: TileMapProps) {
  if (!nativeTileMapAvailable || !Map || !Camera || !GeoJSONSource || !Layer) return null;
  const point = current ? { type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: current } } : null;

  return (
    <View style={{ height }}>
      <Map
        style={{ flex: 1 }}
        mapStyle={styleUrl}
        logo={false}
        attribution
        compass={false}
        touchRotate={false}
        touchPitch={false}
        onDidFinishLoadingMap={onLoaded}
        onDidFailLoadingMap={onFailed}
      >
        {follow && current ? (
          <Camera center={current} zoom={16} duration={600} />
        ) : bounds ? (
          <Camera
            bounds={[bounds.sw[0], bounds.sw[1], bounds.ne[0], bounds.ne[1]]}
            padding={{ top: 32, right: 32, bottom: 32, left: 32 }}
            duration={0}
          />
        ) : null}
        {line ? (
          <GeoJSONSource id="vitacore-route" data={line}>
            <Layer {...routeLineLayer} />
          </GeoJSONSource>
        ) : null}
        {point ? (
          <GeoJSONSource id="vitacore-current" data={point}>
            <Layer {...currentPointLayer} />
          </GeoJSONSource>
        ) : null}
      </Map>
    </View>
  );
}
