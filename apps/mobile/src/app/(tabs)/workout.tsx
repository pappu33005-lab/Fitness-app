import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { deviceTimeZone, formatWeight } from "@vitacore/domain";
import { AppText, Button, Card, Screen } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { loadLocalHistory } from "@/data/logs";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

const routes = [
  { kind: "walk", label: "Walk" },
  { kind: "run", label: "Run" },
  { kind: "cycle", label: "Cycle" },
  { kind: "hike", label: "Hike" },
] as const;

export default function WorkoutScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { profile } = useAppState();
  const units = profile?.unitSystem ?? "metric";
  const [records, setRecords] = useState<Awaited<ReturnType<typeof loadLocalHistory>>["records"]>([]);

  useFocusEffect(useCallback(() => {
    void loadLocalHistory(deviceTimeZone()).then((history) => setRecords(history.records));
  }, []));

  return (
    <Screen>
      <AppText variant="h1">Workout</AppText>
      <AppText variant="small" color={colors.textSecondary}>
        Strength uses an original text library. Walks, runs, rides, and hikes record a real GPS route on iOS and Android.
      </AppText>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Strength</AppText>
        <View style={{ height: space.sm }} />
        <AppText variant="small" color={colors.textSecondary}>
          Sets, reps, weight, and a rest timer. No licensed workout video is bundled.
        </AppText>
        <View style={{ height: space.md }} />
        <Button label="Browse exercises" onPress={() => router.push("/exercises")} />
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Cardio route</AppText>
        <View style={{ height: space.sm }} />
        <AppText variant="small" color={colors.textSecondary}>
          Distance, pace, and elevation come from the device. The route is drawn as an outline, and on a base map once a tile style is configured.
        </AppText>
        <View style={{ height: space.md, gap: space.sm }}>
          {routes.map((item) => (
            <Button key={item.kind} label={item.label} tone="secondary" onPress={() => router.push(`/record?kind=${item.kind}`)} />
          ))}
        </View>
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Mobility</AppText>
        <View style={{ height: space.sm }} />
        <AppText variant="small" color={colors.textSecondary}>
          Easy breathing and the same original exercise list. HIIT and stretching videos are not included.
        </AppText>
        <View style={{ height: space.md }} />
        <Button label="Open the library" tone="secondary" onPress={() => router.push("/exercises")} />
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Personal records</AppText>
        <View style={{ height: space.sm }} />
        {records.length === 0 ? (
          <AppText variant="small" color={colors.textSecondary}>The heaviest logged weight for each exercise shows up here.</AppText>
        ) : records.slice(0, 5).map((record) => (
          <AppText key={record.exerciseName} variant="small">
            {record.exerciseName} · {formatWeight(record.weightKg, units)}{record.reps != null ? ` · ${record.reps} reps` : ""}
          </AppText>
        ))}
      </Card>
      <View style={{ height: space.lg }} />
      <Button label="Ask the coach" tone="ghost" onPress={() => router.push("/coach")} />
    </Screen>
  );
}
