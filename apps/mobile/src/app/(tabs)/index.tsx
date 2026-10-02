import { useEffect, useState } from "react";
import { Platform, View } from "react-native";
import { useRouter } from "expo-router";
import { brandConfig } from "@vitacore/brand";
import {
  dayPeriod,
  deviceTimeZone,
  estimateDailyCalories,
  formatDuration,
  formatVolume,
  localDay,
  recommendNextAction,
  scoreRecovery,
  scoreSleep,
} from "@vitacore/domain";
import { AppText, Avatar, Button, Card, IconButton, ProgressBar, Screen, StatRow, WeekStrip } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { foodsForDay, listActivities, listWorkouts, waterForDay } from "@/data/logs";
import { useTheme } from "@/design/theme";
import { copy } from "@/i18n/copy";
import {
  readHeartRateVariability,
  readRestingHeartRate,
  readSleep,
  readSteps,
  type HeartRateReading,
  type HrvReading,
  type SleepReading,
  type StepReading,
} from "@/health";
import { space } from "@/design/tokens";

function weekDays(selected: string, zone: string) {
  const today = localDay(new Date(), zone);
  const anchor = new Date();
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(anchor);
    date.setDate(anchor.getDate() - 6 + index);
    const key = localDay(date, zone);
    return { key, label: date.toLocaleDateString("en-US", { weekday: "narrow", timeZone: zone }), selected: key === selected, isToday: key === today };
  });
}

export default function HomeScreen() {
  const { profile } = useAppState();
  const { colors } = useTheme();
  const router = useRouter();
  const zone = deviceTimeZone();
  const today = localDay(new Date(), zone);
  const [selected, setSelected] = useState(today);
  const [steps, setSteps] = useState<StepReading | null>(null);
  const [platformSleep, setPlatformSleep] = useState<SleepReading | null>(null);
  const [heartRate, setHeartRate] = useState<HeartRateReading | null>(null);
  const [hrv, setHrv] = useState<HrvReading | null>(null);
  const [kcal, setKcal] = useState(0);
  const [water, setWater] = useState(0);
  const [moved, setMoved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isToday = selected === today;
    Promise.all([
      foodsForDay(selected),
      waterForDay(selected),
      listActivities(),
      listWorkouts(),
      isToday ? readSteps() : Promise.resolve(null),
      // Recovery only ever reflects today: a past day's heart rate / sleep is not re-fetched here.
      isToday ? readSleep() : Promise.resolve(null),
      isToday ? readRestingHeartRate() : Promise.resolve(null),
      isToday ? readHeartRateVariability() : Promise.resolve(null),
    ])
      .then(([foods, ml, activities, workouts, stepReading, sleepReading, heartRateReading, hrvReading]) => {
        if (cancelled) return;
        setLoadError(null);
        setKcal(foods.reduce((sum, food) => sum + food.kcal, 0));
        setWater(ml);
        setMoved(
          activities.some((item) => localDay(new Date(item.started_at), zone) === selected) ||
            workouts.some((item) => localDay(new Date(item.started_at), zone) === selected),
        );
        setSteps(stepReading);
        setPlatformSleep(sleepReading);
        setHeartRate(heartRateReading);
        setHrv(hrvReading);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Today's cards could not be loaded from this device.");
      });
    return () => {
      cancelled = true;
    };
  }, [selected, today, zone]);

  const sleepScore = scoreSleep({
    asleepMinutes: platformSleep?.status === "value" ? platformSleep.asleepMinutes : null,
    inBedMinutes: platformSleep?.status === "value" ? platformSleep.inBedMinutes : null,
    targetMinutes: profile?.sleepTargetMinutes ?? null,
    bedtimeDeviationMinutes: null,
    disturbanceCount: null,
    stageMinutes: platformSleep?.status === "value" ? platformSleep.stages : null,
  });
  const recovery = scoreRecovery({
    sleepScore: sleepScore.status === "scored" ? sleepScore.score : null,
    restingHr: heartRate?.status === "value" ? heartRate.restingBpm : null,
    restingHrBaseline: heartRate?.status === "value" ? heartRate.baselineBpm : null,
    hrvMs: hrv?.status === "value" ? hrv.valueMs : null,
    hrvBaselineMs: hrv?.status === "value" ? hrv.baselineMs : null,
    // Training load is not tracked yet, so this factor is always left out honestly rather than guessed.
    recentLoad: null,
    chronicLoad: null,
  });

  const greeting = dayPeriod(new Date(), zone);
  const name = profile?.displayName ? `, ${profile.displayName}` : "";
  const estimate = profile
    ? estimateDailyCalories({
        ageYears: profile.ageYears,
        sex: profile.sex,
        heightCm: profile.heightCm,
        weightKg: profile.weightKg,
        activityLevel: profile.activityLevel,
        goal: profile.goal,
      })
    : null;
  const platform = Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web" ? Platform.OS : "other";
  const healthState =
    steps?.status === "value" || steps?.status === "empty"
      ? "ready"
      : steps?.status === "unavailable"
        ? "unavailable"
        : "unavailable";
  const action = recommendNextAction({
    platform,
    health: healthState,
    hasMealToday: kcal > 0,
    hasActivityToday: moved,
  });
  const actionCopy = {
    connect_health: { title: "Connect health data", body: "Allow Apple Health or Health Connect when you want steps and sleep from that store." },
    health_denied: { title: "Health access is off", body: copy.healthDenied },
    log_meal: { title: "Log what you ate", body: "Nutrition today is only what you record. Nothing is filled in for you." },
    start_activity: { title: "Record a session", body: "A walk, run, ride, or hike uses your location only after you start it." },
    review_today: { title: "Today is logged", body: "You can review the meal and the session, or leave the rest alone." },
  }[action];

  const sleepValue =
    selected !== today
      ? "Select today"
      : platformSleep?.status === "value"
        ? formatDuration(platformSleep.asleepMinutes)
        : platformSleep?.status === "empty"
          ? "No sleep recorded"
          : "Unavailable";
  const sleepDetail =
    selected !== today
      ? "Platform sleep is only read for today."
      : platformSleep?.status === "value"
        ? platformSleep.stages
          ? `${platformSleep.sourceLabel}. Stages from the health store.`
          : `${platformSleep.sourceLabel}. ${copy.stagesNeedSource}`
        : platformSleep?.detail ?? copy.stagesNeedSource;

  return (
    <Screen>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <View style={{ gap: 4 }}>
          <AppText variant="label">{brandConfig.name}</AppText>
          <AppText variant="h1">{greeting === "morning" ? "Good morning" : greeting === "afternoon" ? "Good afternoon" : "Good evening"}{name}</AppText>
        </View>
        <IconButton label="Profile" onPress={() => router.push("/profile")}>
          <Avatar label={profile?.displayName ?? brandConfig.name} />
        </IconButton>
      </View>
      <View style={{ height: space.xl }} />
      <WeekStrip days={weekDays(selected, zone)} onSelect={setSelected} />
      <View style={{ height: space.xl }} />
      {loadError ? <AppText variant="small" color={colors.accent}>{loadError}</AppText> : null}
      <Card>
        <AppText variant="label">Today</AppText>
        <StatRow
          label="Sleep"
          value={sleepValue}
          detail={sleepDetail}
        />
        <StatRow
          label="Recovery"
          value={recovery.status === "scored" ? String(recovery.score) : "Not scored"}
          detail={
            recovery.status === "scored"
              ? `From ${recovery.factors.map((factor) => factor.id.replace("_", " ")).join(", ")}${
                  recovery.omitted.length > 0 ? `. Left out: ${recovery.omitted.map((id) => id.replace("_", " ")).join(", ")}.` : "."
                }`
              : "A recovery score needs at least two real inputs, such as sleep plus a heart-rate baseline."
          }
        />
        <StatRow
          label="Activity"
          value={steps?.status === "value" ? steps.steps.toLocaleString("en-US") : "Unavailable"}
          detail={steps?.status === "value" ? steps.sourceLabel : steps?.status === "empty" ? steps.detail : steps?.detail ?? "Checking the health source."}
        />
        <StatRow
          label="Nutrition"
          value={kcal > 0 ? `${Math.round(kcal)} kcal` : "Nothing logged"}
          detail={kcal > 0 ? "From meals you logged on this device." : "No foods have been logged for this day."}
          onPress={() => router.push("/nutrition")}
        />
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Next</AppText>
        <View style={{ height: space.sm }} />
        <AppText variant="h2">{actionCopy.title}</AppText>
        <AppText variant="small" color={colors.textSecondary}>{actionCopy.body}</AppText>
        <View style={{ height: space.md }} />
        <Button
          label={action === "log_meal" ? "Log food" : action === "start_activity" ? "Start activity" : "Open profile"}
          onPress={() => router.push(action === "log_meal" ? "/search" : action === "start_activity" ? "/record" : "/profile")}
        />
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Goals you set</AppText>
        <View style={{ gap: space.md, marginTop: space.md }}>
          <View style={{ gap: 6 }}>
            <AppText variant="small">Water {profile?.hydrationTargetMl ? formatVolume(water, profile.unitSystem) : ""}</AppText>
            <ProgressBar progress={profile?.hydrationTargetMl ? water / profile.hydrationTargetMl : null} />
            <AppText variant="caption">{profile?.hydrationTargetMl ? `Target ${formatVolume(profile.hydrationTargetMl, profile.unitSystem)}` : "No hydration target yet."}</AppText>
          </View>
          <View style={{ gap: 6 }}>
            <AppText variant="small">Steps</AppText>
            <ProgressBar progress={profile?.stepGoal && steps?.status === "value" ? steps.steps / profile.stepGoal : null} />
            <AppText variant="caption">{profile?.stepGoal ? `Target ${profile.stepGoal.toLocaleString("en-US")}` : "No step target yet."}</AppText>
          </View>
          <AppText variant="small">
            Sleep target {profile?.sleepTargetMinutes ? formatDuration(profile.sleepTargetMinutes) : "not set"}
          </AppText>
          <AppText variant="caption">
            {estimate?.status === "estimated"
              ? `Estimated intake ${estimate.kcal.toLocaleString("en-US")} kcal. ${estimate.disclaimer}`
              : estimate?.reason === "adult_formula_does_not_apply"
                ? copy.calorieMinor
                : "A calorie estimate appears after age, body size, activity, and goal are saved."}
          </AppText>
        </View>
      </Card>
      <View style={{ height: space.lg }} />
      <Card>
        <AppText variant="label">Coach</AppText>
        <View style={{ height: space.sm }} />
        <AppText variant="small" color={colors.textSecondary}>
          Training, meals, and sleep questions use saved data. The Gemini key stays on the server.
        </AppText>
        <View style={{ height: space.md }} />
        <Button label="Ask the coach" tone="secondary" onPress={() => router.push("/coach")} />
        <View style={{ height: space.sm }} />
        <Button label="Progress" tone="ghost" onPress={() => router.push("/progress")} />
      </Card>
      <View style={{ height: space.lg }} />
      <AppText variant="caption">{copy.disclaimer}</AppText>
    </Screen>
  );
}
