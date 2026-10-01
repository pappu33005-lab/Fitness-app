import { useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { deviceTimeZone, formatDuration, historyRanges, localDay, scoreSleep, seriesForRange } from "@vitacore/domain";
import { HistoryBars } from "@/components/history-bars";
import { AppText, Button, Card, ProgressRing, Screen, TextField, WeekStrip } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { latestManualSleep, loadLocalHistory, saveSleep } from "@/data/logs";
import { readSleep, type SleepReading } from "@/health";
import { copy } from "@/i18n/copy";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

export default function SleepScreen() {
  const router = useRouter();
  const { profile } = useAppState();
  const { colors } = useTheme();
  const zone = deviceTimeZone();
  const today = localDay(new Date(), zone);
  const [bed, setBed] = useState("23:00");
  const [wake, setWake] = useState("07:00");
  const [platformSleep, setPlatformSleep] = useState<SleepReading | null>(null);
  const [manual, setManual] = useState<Awaited<ReturnType<typeof latestManualSleep>>>(null);
  const [sleepHistory, setSleepHistory] = useState<Awaited<ReturnType<typeof loadLocalHistory>>["sleepMinutes"]>([]);

  useFocusEffect(() => {
    void readSleep().then(setPlatformSleep);
    void latestManualSleep().then(setManual);
    void loadLocalHistory(zone).then((history) => setSleepHistory(history.sleepMinutes));
  });

  const asleepMinutes = platformSleep?.status === "value" ? platformSleep.asleepMinutes : manual ? minutesBetween(manual.asleep_start, manual.asleep_end) : null;
  const score = scoreSleep({
    asleepMinutes,
    inBedMinutes: platformSleep?.status === "value" ? platformSleep.inBedMinutes : asleepMinutes,
    targetMinutes: profile?.sleepTargetMinutes ?? null,
    bedtimeDeviationMinutes: null,
    disturbanceCount: null,
    stageMinutes: platformSleep?.status === "value" ? platformSleep.stages : null,
  });

  return (
    <Screen>
      <AppText variant="h1">{new Date().toLocaleDateString("en-US", { weekday: "long", timeZone: zone })}</AppText>
      <AppText variant="caption">{today}</AppText>
      <View style={{ height: space.lg }} />
      <WeekStrip
        days={Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setDate(date.getDate() - 6 + index);
          const key = localDay(date, zone);
          return { key, label: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: zone }), selected: key === today };
        })}
        onSelect={() => undefined}
      />
      <View style={{ height: space.xl }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <ProgressRing progress={score.status === "scored" ? score.score / 100 : null} label={score.status === "scored" ? String(score.score) : "—"} caption="Score" />
        <View style={{ flex: 1 }}>
          <AppText variant="metric" style={{ fontSize: 40, lineHeight: 44 }}>{asleepMinutes == null ? "—" : formatDuration(asleepMinutes)}</AppText>
          <AppText variant="caption">{platformSleep?.status === "value" ? platformSleep.sourceLabel : manual ? "Entered by you" : "No sleep record"}</AppText>
        </View>
      </View>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="small" color={colors.textSecondary}>{copy.stagesNeedSource}</AppText>
        {platformSleep?.status === "value" && platformSleep.stages ? (
          <AppText variant="small">Awake {formatDuration(platformSleep.stages.awake)} · Light {formatDuration(platformSleep.stages.light)} · REM {formatDuration(platformSleep.stages.rem)} · Deep {formatDuration(platformSleep.stages.deep)}</AppText>
        ) : (
          <AppText variant="caption">Stage minutes stay hidden until a health platform sends them.</AppText>
        )}
        {score.status === "scored" ? score.factors.map((factor) => (
          <AppText key={factor.id} variant="caption">{factor.id} {factor.score} · {Math.round(factor.weight * 100)}% of this score. {factor.detail}</AppText>
        )) : <AppText variant="caption">No score yet. Duration needs both a record and a sleep target.</AppText>}
        {score.status === "scored" && score.omitted.length > 0 ? <AppText variant="caption">Left out: {score.omitted.join(", ")}.</AppText> : null}
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Saved nights</AppText>
        <View style={{ height: space.sm }} />
        <HistoryBars
          points={seriesForRange(today, sleepHistory, historyRanges[0].days, historyRanges[0].bucketDays)}
          accessibilityLabel="Sleep notes for the last 7 days"
          empty="No sleep notes in the last 7 days."
        />
        <AppText variant="caption">This is only nights you saved in the app. It is not a clinical sleep study.</AppText>
      </Card>
      <View style={{ height: space.lg }} />
      <AppText variant="h3">Enter last night</AppText>
      <AppText variant="caption">This is your note, not a sensor reading.</AppText>
      <View style={{ height: space.sm }} />
      <TextField label="Fell asleep" value={bed} onChangeText={setBed} />
      <View style={{ height: space.sm }} />
      <TextField label="Woke" value={wake} onChangeText={setWake} />
      <View style={{ height: space.md }} />
      <Button label="Save sleep note" onPress={() => {
        const start = combine(today, bed);
        const end = combine(today, wake);
        void saveSleep({ day: today, timezone: zone, start, end }).then(() => latestManualSleep().then(setManual));
      }} />
      <View style={{ height: space.lg }} />
      <Button label="Sleep sounds" tone="secondary" onPress={() => router.push("/sounds")} />
      <View style={{ height: space.sm }} />
      <Button label="Ask the coach" tone="ghost" onPress={() => router.push("/coach")} />
      <View style={{ height: space.lg }} />
      <AppText variant="caption">{copy.soundModel}</AppText>
      <AppText variant="caption">{copy.alarmLimit}</AppText>
    </Screen>
  );
}

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
}

function combine(day: string, time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year ?? 2026, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0, 0, 0);
  if ((hour ?? 0) < 12) value.setDate(value.getDate() + 1);
  return value.toISOString();
}
