import { Component, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState, StyleSheet, View } from "react-native";
import {
  routeBounds,
  routeMapAvailability,
  routeToLineFeature,
  simplifyRoute,
  toRouteCoordinates,
} from "@vitacore/domain";
import { AppText } from "@/components/ui";
import { useTheme } from "@/design/theme";
import { appSurface } from "@/platform/capabilities";
import { RouteSketch } from "./RouteSketch";
import { nativeTileMapAvailable, TileMap } from "./TileMap";

type Props = {
  /** Stored/recorded GPS points. Only read here; the recorded data is never changed. */
  points: readonly { latitude: unknown; longitude: unknown }[];
  /** True while recording: the camera follows the newest point. False: the whole route is fitted. */
  live?: boolean;
  height?: number;
};

const MAX_DRAWN_VERTICES = 600;
const STYLE_LOAD_TIMEOUT_MS = 12_000;

class MapBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function RouteMap({ points, live = false, height = 240 }: Props) {
  const { colors } = useTheme();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  const [mapState, setMapState] = useState<"loading" | "ready" | "failed">("loading");
  // Keep the last on-screen route while the app is backgrounded. Updating here, instead of in an effect, avoids a second render after paint.
  const [shown, setShown] = useState(points);
  if (appActive && shown !== points) setShown(points);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => subscription.remove();
  }, []);

  const coordinates = useMemo(() => toRouteCoordinates(shown), [shown]);
  const drawn = useMemo(() => simplifyRoute(coordinates, MAX_DRAWN_VERTICES), [coordinates]);
  const line = useMemo(() => routeToLineFeature(drawn), [drawn]);
  const bounds = useMemo(() => routeBounds(coordinates), [coordinates]);
  const current = coordinates.length > 0 ? (coordinates[coordinates.length - 1] ?? null) : null;

  const availability = routeMapAvailability({
    surface: appSurface(),
    styleUrl: process.env.EXPO_PUBLIC_MAP_TILE_STYLE_URL,
    nativeMapLibraryAvailable: nativeTileMapAvailable,
  });
  const wantsTiles = availability.status === "tiles" && coordinates.length > 0;

  useEffect(() => {
    if (!wantsTiles || mapState !== "loading") return;
    const timer = setTimeout(() => setMapState((state) => (state === "loading" ? "failed" : state)), STYLE_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [wantsTiles, mapState]);

  if (coordinates.length === 0) {
    return (
      <View style={{ height, borderRadius: 12, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <AppText variant="small" color={colors.textSecondary}>
          {live ? "Waiting for the first GPS point. Nothing is drawn until a real location arrives." : "No GPS points were recorded for this activity."}
        </AppText>
      </View>
    );
  }

  const tilesShowing = wantsTiles && mapState === "ready";
  let note: string | null = null;
  if (availability.status === "outline_only") note = availability.message;
  else if (mapState === "loading") note = "Loading the map. The saved route outline is shown meanwhile.";
  else if (mapState === "failed") {
    note = "Map tiles could not load (you may be offline). The route is saved on this device and is shown here as an outline.";
  }

  return (
    <View>
      <View style={{ height, borderRadius: 12, overflow: "hidden" }}>
        {wantsTiles && availability.status === "tiles" ? (
          <MapBoundary onError={() => setMapState("failed")}>
            <TileMap
              styleUrl={availability.styleUrl}
              line={line}
              bounds={bounds}
              current={current}
              follow={live}
              height={height}
              onLoaded={() => setMapState("ready")}
              onFailed={() => setMapState("failed")}
            />
          </MapBoundary>
        ) : null}
        {!tilesShowing ? (
          <View style={StyleSheet.absoluteFill}>
            <RouteSketch coordinates={drawn} height={height} accessibilityLabel="Route outline" />
          </View>
        ) : null}
      </View>
      {note ? (
        <AppText variant="caption" color={colors.textSecondary} style={{ marginTop: 6 }}>
          {note}
        </AppText>
      ) : null}
    </View>
  );
}
