import { useCallback, useState } from "react";
import { View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { deviceTimeZone, formatDuration, historyRanges, localDay, overnightSleepBounds, scoreSleep, seriesForRange, startOfZonedDay } from "@vitacore/domain";
import { HistoryBars } from "@/components/history-bars";
import { AppText, Button, Card, ProgressRing, Screen, TextField, WeekStrip } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { loadLocalHistory, saveSleep, sleepForDay } from "@/data/logs";
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
  const [selected, setSelected] = useState(today);
  const [bed, setBed] = useState("23:00");
  const [wake, setWake] = useState("07:00");
  const [platformSleep, setPlatformSleep] = useState<SleepReading | null>(null);
  const [manual, setManual] = useState<Awaited<ReturnType<typeof sleepForDay>>>(null);
  const [sleepHistory, setSleepHistory] = useState<Awaited<ReturnType<typeof loadLocalHistory>>["sleepMinutes"]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback((day: string) => {
    const isToday = day === today;
    void (isToday ? readSleep() : Promise.resolve(null)).then(setPlatformSleep);
    void sleepForDay(day).then(setManual);
    void loadLocalHistory(zone).then((history) => setSleepHistory(history.sleepMinutes));
  }, [today, zone]);

  useFocusEffect(
    useCallback(() => {
      refresh(selected);
    }, [refresh, selected]),
  );

  const asleepMinutes =
    selected === today && platformSleep?.status === "value"
      ? platformSleep.asleepMinutes
      : manual
        ? minutesBetween(manual.asleep_start, manual.asleep_end)
        : null;
  const score = scoreSleep({
    asleepMinutes,
    inBedMinutes:
      selected === today && platformSleep?.status === "value" ? platformSleep.inBedMinutes : asleepMinutes,
    targetMinutes: profile?.sleepTargetMinutes ?? null,
    bedtimeDeviationMinutes: null,
    disturbanceCount: null,
    stageMinutes: selected === today && platformSleep?.status === "value" ? platformSleep.stages : null,
  });

  async function saveNote() {
    const bounds = overnightSleepBounds({
      wakeDay: selected,
      bedTime: bed,
      wakeTime: wake,
      timeZone: zone,
    });
    if (!bounds.ok) {
      setSaveError(bounds.reason);
      return;
    }
    setBusy(true);
    setSaveError(null);
    try {
      await saveSleep({ day: bounds.day, timezone: zone, start: bounds.startIso, end: bounds.endIso });
      setManual(await sleepForDay(selected));
      const history = await loadLocalHistory(zone);
      setSleepHistory(history.sleepMinutes);
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "This sleep note could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const selectedWeekday = startOfZonedDay(selected, zone).toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: zone,
  });

  return (
    <Screen>
      <AppText variant="h1">{selectedWeekday}</AppText>
      <AppText variant="caption">{selected}</AppText>
      <View style={{ height: space.lg }} />
      <WeekStrip
        days={Array.from({ length: 7 }, (_, index) => {
          const date = new Date();
          date.setDate(date.getDate() - 6 + index);
          const key = localDay(date, zone);
          return { key, label: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: zone }), selected: key === selected };
        })}
        onSelect={(key) => {
          setSelected(key);
          setSaveError(null);
          refresh(key);
        }}
      />
      <View style={{ height: space.xl }} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.lg }}>
        <ProgressRing progress={score.status === "scored" ? score.score / 100 : null} label={score.status === "scored" ? String(score.score) : "—"} caption="Score" />
        <View style={{ flex: 1 }}>
          <AppText variant="metric" style={{ fontSize: 40, lineHeight: 44 }}>{asleepMinutes == null ? "—" : formatDuration(asleepMinutes)}</AppText>
          <AppText variant="caption">
            {selected === today && platformSleep?.status === "value"
              ? platformSleep.sourceLabel
              : manual
                ? "Entered by you"
                : "No sleep record"}
          </AppText>
        </View>
      </View>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="small" color={colors.textSecondary}>{copy.stagesNeedSource}</AppText>
        {selected === today && platformSleep?.status === "value" && platformSleep.stages ? (
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
      <AppText variant="h3">{selected === today ? "Enter last night" : `Enter sleep for ${selected}`}</AppText>
      <AppText variant="caption">This is your note, not a sensor reading. Bedtime before wake time on the clock is treated as the previous evening.</AppText>
      <View style={{ height: space.sm }} />
      <TextField label="Fell asleep" value={bed} onChangeText={setBed} />
      <View style={{ height: space.sm }} />
      <TextField label="Woke" value={wake} onChangeText={setWake} />
      <View style={{ height: space.md }} />
      {saveError ? <AppText variant="small" color={colors.accent}>{saveError}</AppText> : null}
      <Button label={busy ? "Saving…" : "Save sleep note"} onPress={() => void saveNote()} disabled={busy} />
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
