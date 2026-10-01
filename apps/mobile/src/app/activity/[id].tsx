import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  elevationGainMeters,
  formatClockDuration,
  formatDistance,
  formatPace,
  paceSecondsPerKilometer,
} from "@vitacore/domain";
import { AppText, Button, Screen } from "@/components/ui";
import { RouteMap } from "@/components/route-map/RouteMap";
import { useAppState } from "@/data/app-state";
import { activityPointsForSession, activitySummary, type ActivityPointInput } from "@/data/logs";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

type Summary = NonNullable<Awaited<ReturnType<typeof activitySummary>>>;

/** Reads only from the device database, so a saved route opens with no network or account. */
export default function ActivityDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile } = useAppState();
  const { colors } = useTheme();
  const units = profile?.unitSystem ?? "metric";
  const [state, setState] = useState<"loading" | "missing" | "error" | "ready">("loading");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [points, setPoints] = useState<ActivityPointInput[]>([]);

  useFocusEffect(
    useCallback(() => {
      if (!id) {
        setState("missing");
        return;
      }
      let cancelled = false;
      Promise.all([activitySummary(id), activityPointsForSession(id)])
        .then(([found, stored]) => {
          if (cancelled) return;
          if (!found) {
            setState("missing");
            return;
          }
          setSummary(found);
          setPoints(stored);
          setState("ready");
        })
        .catch(() => {
          if (!cancelled) setState("error");
        });
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const pace = summary ? paceSecondsPerKilometer(summary.distanceMeters, summary.movingSeconds) : null;
  const gain = elevationGainMeters(points);

  return (
    <Screen>
      <AppText variant="h1">{summary ? summary.kind : "Activity"}</AppText>
      {state === "loading" ? <AppText variant="small">Opening this activity…</AppText> : null}
      {state === "missing" ? <AppText variant="small" color={colors.textSecondary}>This activity is not on this device.</AppText> : null}
      {state === "error" ? <AppText variant="small" color={colors.textSecondary}>This activity could not be read from the device database.</AppText> : null}
      {state === "ready" && summary ? (
        <>
          <AppText variant="caption" color={colors.textSecondary}>{summary.startedAt}</AppText>
          <View style={{ height: space.md }} />
          <RouteMap points={points} height={280} />
          <View style={{ height: space.md }} />
          <AppText variant="metric" style={{ fontSize: 42 }}>{formatDistance(summary.distanceMeters, units)}</AppText>
          <AppText variant="small">
            {formatClockDuration(summary.movingSeconds)}
            {pace ? ` · ${formatPace(pace, units)}` : ""}
          </AppText>
          <AppText variant="caption">{gain == null ? "Elevation was not reported by this device." : `Elevation gain ${Math.round(gain)} m`}</AppText>
        </>
      ) : null}
      <View style={{ height: space.lg }} />
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
