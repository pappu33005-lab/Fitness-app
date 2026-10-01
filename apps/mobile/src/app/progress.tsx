import { useCallback, useState } from "react";
import { Pressable, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import {
  deviceTimeZone,
  formatDistance,
  formatDuration,
  formatVolume,
  formatWeight,
  historyRanges,
  localDay,
  recordedSummary,
  seriesForRange,
  type HistoryRangeId,
} from "@vitacore/domain";
import { AppText, Button, Card, Screen } from "@/components/ui";
import { HistoryBars } from "@/components/history-bars";
import { useAppState } from "@/data/app-state";
import { loadLocalHistory } from "@/data/logs";
import { useTheme } from "@/design/theme";
import { radius, space } from "@/design/tokens";

type History = Awaited<ReturnType<typeof loadLocalHistory>>;

export default function ProgressScreen() {
  const router = useRouter();
  const { profile } = useAppState();
  const { colors } = useTheme();
  const units = profile?.unitSystem ?? "metric";
  const [range, setRange] = useState<HistoryRangeId>("7");
  const [history, setHistory] = useState<History | null>(null);

  useFocusEffect(useCallback(() => {
    void loadLocalHistory(deviceTimeZone()).then(setHistory);
  }, []));

  const selected = historyRanges.find((item) => item.id === range) ?? historyRanges[0];
  const today = localDay(new Date(), deviceTimeZone());
  const series = (rows: History[keyof Pick<History, "kcal" | "waterMl" | "sleepMinutes" | "distanceMeters" | "finishedWorkouts" | "volumeKg">] | undefined) =>
    seriesForRange(today, rows ?? [], selected.days, selected.bucketDays);

  const kcal = series(history?.kcal);
  const water = series(history?.waterMl);
  const sleep = series(history?.sleepMinutes);
  const distance = series(history?.distanceMeters);
  const workouts = series(history?.finishedWorkouts);
  const volume = series(history?.volumeKg);
  const bucketNote = selected.bucketDays > 1 ? "Each bar is a week. Days you did not record are left out of that week." : "Each bar is a day you recorded. Empty days are gaps.";

  return (
    <Screen>
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
      <AppText variant="h1">Progress</AppText>
      <AppText variant="small" color={colors.textSecondary}>
        These charts use meals, water, sleep notes, routes, and finished strength sessions saved on this device.
      </AppText>
      <View style={{ height: space.md }} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}>
        {historyRanges.map((item) => {
          const active = item.id === range;
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={item.label}
              onPress={() => setRange(item.id)}
              style={{
                paddingHorizontal: 14,
                minHeight: 36,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: active ? colors.accent : colors.border,
                backgroundColor: active ? colors.accentMuted : "transparent",
              }}
            >
              <AppText variant="caption" color={active ? colors.text : colors.textMuted}>{item.label}</AppText>
            </Pressable>
          );
        })}
      </View>
      <View style={{ height: space.lg }} />
      <SeriesCard
        title="Logged calories"
        detail={summary(kcal, (total) => `${Math.round(total).toLocaleString("en-US")} kcal logged`)}
        points={kcal}
        empty="No meals logged in this range."
        note={bucketNote}
      />
      <SeriesCard
        title="Water"
        detail={summary(water, (total) => `${formatVolume(total, units)} logged`)}
        points={water}
        empty="No water logged in this range."
        note={bucketNote}
      />
      <SeriesCard
        title="Sleep notes"
        detail={summary(sleep, (total) => `${formatDuration(total)} saved`)}
        points={sleep}
        empty="No sleep notes in this range. A health-platform night appears on Sleep only while that source returns it."
        note={bucketNote}
      />
      <SeriesCard
        title="Route distance"
        detail={summary(distance, (total) => `${formatDistance(total, units)} recorded`)}
        points={distance}
        empty="No GPS activities in this range."
        note={bucketNote}
      />
      <SeriesCard
        title="Finished strength sessions"
        detail={summary(workouts, (total) => `${Math.round(total)} finished`)}
        points={workouts}
        empty="No finished strength sessions in this range."
        note={bucketNote}
      />
      <SeriesCard
        title="Strength volume"
        detail={summary(volume, (total) => `${formatWeight(total, units)} × reps`)}
        points={volume}
        empty="Volume needs both a weight and a rep count on a completed set."
        note={bucketNote}
      />
      <Card>
        <AppText variant="label">Personal records</AppText>
        <View style={{ height: space.sm }} />
        {history && history.records.length > 0 ? history.records.map((record) => (
          <AppText key={record.exerciseName} variant="small">
            {record.exerciseName} · {formatWeight(record.weightKg, units)}{record.reps != null ? ` · ${record.reps} reps` : ""}
          </AppText>
        )) : <AppText variant="small" color={colors.textSecondary}>A record appears after you log a set with a weight.</AppText>}
      </Card>
      <View style={{ height: space.lg }} />
      <AppText variant="caption">
        Step history and a weight trend are not charted. Today’s steps come from the phone or a health platform, and the profile stores one current weight.
      </AppText>
    </Screen>
  );
}

function summary(points: ReturnType<typeof seriesForRange>, format: (total: number) => string): string {
  const { total, daysWithData } = recordedSummary(points);
  if (daysWithData === 0) return "No records in this range.";
  return format(total);
}

function SeriesCard({
  title,
  detail,
  points,
  empty,
  note,
}: {
  title: string;
  detail: string;
  points: ReturnType<typeof seriesForRange>;
  empty: string;
  note: string;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ marginBottom: space.lg }}>
      <AppText variant="label">{title}</AppText>
      <AppText variant="small" color={colors.textSecondary}>{detail}</AppText>
      <View style={{ height: space.md }} />
      <HistoryBars points={points} accessibilityLabel={`${title}. ${detail}`} empty={empty} />
      <AppText variant="caption">{note}</AppText>
    </Card>
  );
}
