import { useState } from "react";
import { View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import type { HistoryPoint } from "@vitacore/domain";
import { AppText } from "@/components/ui";
import { useTheme } from "@/design/theme";

export function HistoryBars({
  points,
  accessibilityLabel,
  empty,
}: {
  points: HistoryPoint[];
  accessibilityLabel: string;
  empty: string;
}) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const hasRecord = points.some((point) => point.value != null);
  if (!hasRecord) return <AppText variant="small">{empty}</AppText>;

  const max = Math.max(...points.map((point) => point.value ?? 0), 1);
  const gap = points.length > 40 ? 1 : 3;
  const barWidth = width > 0 ? Math.max(1, (width - gap * Math.max(points.length - 1, 0)) / points.length) : 0;
  const height = 72;

  return (
    <View accessibilityLabel={accessibilityLabel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {width > 0 ? (
        <Svg width={width} height={height}>
          {points.map((point, index) => {
            if (point.value == null) return null;
            const barHeight = Math.max(2, (point.value / max) * (height - 8));
            return (
              <Rect
                key={`${point.day}-${index}`}
                x={index * (barWidth + gap)}
                y={height - 4 - barHeight}
                width={barWidth}
                height={barHeight}
                rx={Math.min(2, barWidth / 2)}
                fill={colors.accent}
              />
            );
          })}
        </Svg>
      ) : (
        <View style={{ height }} />
      )}
    </View>
  );
}
