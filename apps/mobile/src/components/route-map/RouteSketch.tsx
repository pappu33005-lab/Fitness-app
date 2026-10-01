import { useMemo, useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { projectRouteToViewport, type RouteCoordinate } from "@vitacore/domain";
import { useTheme } from "@/design/theme";

/**
 * Tile-free route outline drawn from the stored points. It works offline, in the browser
 * preview, and before any tile provider is configured. It is an outline, not a map: there
 * are no roads or labels.
 */
export function RouteSketch({
  coordinates,
  height,
  accessibilityLabel,
}: {
  coordinates: RouteCoordinate[];
  height: number;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const projected = useMemo(() => projectRouteToViewport(coordinates, width, height), [coordinates, width, height]);
  const first = projected[0];
  const last = projected[projected.length - 1];

  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{ height, backgroundColor: colors.surface, borderRadius: 12, overflow: "hidden" }}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 && first && last ? (
        <Svg width={width} height={height}>
          {projected.length > 1 ? (
            <Polyline
              points={projected.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ")}
              fill="none"
              stroke={colors.accent}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          <Circle cx={first[0]} cy={first[1]} r={5} fill={colors.textSecondary} />
          <Circle cx={last[0]} cy={last[1]} r={6} fill={colors.accent} stroke={colors.text} strokeWidth={2} />
        </Svg>
      ) : null}
    </View>
  );
}
