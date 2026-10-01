import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { formatClockDuration, formatDistance } from "@vitacore/domain";
import { AppText, Button, Card, Screen } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { listActivities, listWorkouts } from "@/data/logs";
import { copy } from "@/i18n/copy";
import { space } from "@/design/tokens";
import { useTheme } from "@/design/theme";

export default function ActivityScreen() {
  const router = useRouter();
  const { profile } = useAppState();
  const { colors } = useTheme();
  const units = profile?.unitSystem ?? "metric";
  const [activities, setActivities] = useState<Awaited<ReturnType<typeof listActivities>>>([]);
  const [workouts, setWorkouts] = useState<Awaited<ReturnType<typeof listWorkouts>>>([]);

  useFocusEffect(useCallback(() => {
    void listActivities().then(setActivities);
    void listWorkouts().then(setWorkouts);
  }, []));

  return (
    <Screen>
      <AppText variant="h1">Activity</AppText>
      <AppText variant="small" color={colors.textSecondary}>Routes and workouts you record on this device.</AppText>
      <View style={{ height: space.lg }} />
      <Button label="Record a route" onPress={() => router.push("/record")} />
      <View style={{ height: space.sm }} />
      <Button label="Progress" tone="ghost" onPress={() => router.push("/progress")} />
      <View style={{ height: space.sm }} />
      <Button label="Start a strength session" tone="secondary" onPress={() => router.push("/exercises")} />
      <View style={{ height: space.xl }} />
      <AppText variant="label">Routes</AppText>
      {activities.length === 0 ? <AppText variant="small" color={colors.textSecondary}>No GPS activities yet.</AppText> : activities.map((item) => (
        <Card key={item.id} style={{ marginTop: space.sm }}>
          <AppText variant="h3">{item.kind}</AppText>
          <AppText variant="small">{formatDistance(item.distance_meters, units)} · {formatClockDuration(item.moving_seconds)}</AppText>
          <Button label="View route" tone="ghost" onPress={() => router.push(`/activity/${item.id}`)} />
        </Card>
      ))}
      <View style={{ height: space.lg }} />
      <AppText variant="label">Strength</AppText>
      {workouts.length === 0 ? <AppText variant="small" color={colors.textSecondary}>No strength sessions yet.</AppText> : workouts.map((item) => (
        <Card key={item.id} style={{ marginTop: space.sm }}>
          <AppText variant="h3">{item.ended_at ? "Finished" : "In progress"}</AppText>
          <AppText variant="caption">{item.started_at}</AppText>
          <Button label="Open" tone="ghost" onPress={() => router.push(`/workout/${item.id}`)} />
        </Card>
      ))}
      <View style={{ height: space.lg }} />
      <AppText variant="caption">{copy.mapTiles}</AppText>
    </Screen>
  );
}
