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
import { foodsForDay, listActivities, listWorkouts, sleepForDay, waterForDay } from "@/data/logs";
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

function minutesBetween(startIso: string, endIso: string): number {
  return Math.max(0, (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000);
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
  const [manualSleep, setManualSleep] = useState<Awaited<ReturnType<typeof sleepForDay>>>(null);
  const [heartRate, setHeartRate] = useState<HeartRateReading | null>(null);
  const [hrv, setHrv] = useState<HrvReading | null>(null);
  const [kcal, setKcal] = useState(0);
  const [water, setWater] = useState(0);
  const [moved, setMoved] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const isToday = selected === today;
    void Promise.all([
      foodsForDay(selected),
      waterForDay(selected),
      listActivities(),
      listWorkouts(),
      isToday ? readSteps() : Promise.resolve(null),
      isToday ? readSleep() : Promise.resolve(null),
      isToday ? readRestingHeartRate() : Promise.resolve(null),
      isToday ? readHeartRateVariability() : Promise.resolve(null),
      sleepForDay(selected),
    ])
      .then(([foods, ml, activities, workouts, stepReading, sleepReading, heartRateReading, hrvReading, manual]) => {
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
        setManualSleep(manual);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError("This day's cards could not be loaded from this device.");
          setSteps(null);
          setPlatformSleep(null);
          setHeartRate(null);
          setHrv(null);
          setManualSleep(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected, today, zone]);

  const isToday = selected === today;
  const platformSleepValid = isToday && platformSleep?.status === "value";
  const asleepMinutes = platformSleepValid
    ? platformSleep.asleepMinutes
    : manualSleep
      ? minutesBetween(manualSleep.asleep_start, manualSleep.asleep_end)
      : null;
  const inBedMinutes = platformSleepValid ? platformSleep.inBedMinutes : null;
  const stageMinutes = platformSleepValid ? platformSleep.stages : null;

  const sleepScore = scoreSleep({
    asleepMinutes,
    inBedMinutes,
    targetMinutes: profile?.sleepTargetMinutes ?? null,
    bedtimeDeviationMinutes: null,
    disturbanceCount: null,
    stageMinutes,
  });
  const recovery = scoreRecovery({
    sleepScore: sleepScore.status === "scored" ? sleepScore.score : null,
    restingHr: isToday && heartRate?.status === "value" ? heartRate.restingBpm : null,
    restingHrBaseline: isToday && heartRate?.status === "value" ? heartRate.baselineBpm : null,
    hrvMs: isToday && hrv?.status === "value" ? hrv.valueMs : null,
    hrvBaselineMs: isToday && hrv?.status === "value" ? hrv.baselineMs : null,
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
  const healthState = !isToday
    ? "ready"
    : steps?.status === "value" || steps?.status === "empty"
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
    asleepMinutes != null
      ? formatDuration(asleepMinutes)
      : isToday
        ? platformSleep?.status === "empty"
          ? "No sleep recorded"
          : "Unavailable"
        : "No sleep note";
  const sleepDetail = platformSleepValid
    ? platformSleep.stages
      ? `${platformSleep.sourceLabel}. Stages from the health store.`
      : `${platformSleep.sourceLabel}. ${copy.stagesNeedSource}`
    : manualSleep
      ? "Entered by you on this device."
      : isToday
        ? platformSleep?.status === "empty" || platformSleep?.status === "unavailable"
          ? platformSleep.detail
          : copy.stagesNeedSource
        : "Manual sleep notes for this day appear here when saved.";

  const activityValue = !isToday
    ? moved
      ? "Logged"
      : "No session"
    : steps?.status === "value"
      ? steps.steps.toLocaleString("en-US")
      : steps?.status === "empty"
        ? "No steps yet"
        : "Unavailable";
  const activityDetail = !isToday
    ? moved
      ? "A workout or GPS session was recorded on this day."
      : "No workout or GPS session on this day. Platform steps are only read for today."
    : steps?.status === "value"
      ? steps.sourceLabel
      : steps?.detail ?? "Checking the health source.";

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
        <AppText variant="label">{isToday ? "Today" : selected}</AppText>
        <StatRow label="Sleep" value={sleepValue} detail={sleepDetail} />
        <StatRow
          label="Recovery"
          value={isToday ? (recovery.status === "scored" ? String(recovery.score) : "Not scored") : "Today only"}
          detail={
            !isToday
              ? "Recovery uses today's health-store readings."
              : recovery.status === "scored"
                ? `From ${recovery.factors.map((factor) => factor.id.replace("_", " ")).join(", ")}${
                    recovery.omitted.length > 0 ? `. Left out: ${recovery.omitted.map((id) => id.replace("_", " ")).join(", ")}.` : "."
                  }`
                : "A recovery score needs at least two real inputs, such as sleep plus a heart-rate baseline."
          }
        />
        <StatRow label="Activity" value={activityValue} detail={activityDetail} />
        <StatRow
          label="Nutrition"
          value={kcal > 0 ? `${Math.round(kcal)} kcal` : "Nothing logged"}
          detail={kcal > 0 ? "From meals you logged on this device." : "No foods have been logged for this day."}
          onPress={() => router.push("/nutrition")}
        />
      </Card>
      <View style={{ height: space.lg }} />
      {isToday ? (
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
      ) : (
        <Card>
          <AppText variant="label">Selected day</AppText>
          <View style={{ height: space.sm }} />
          <AppText variant="small" color={colors.textSecondary}>
            Review meals and sessions for {selected}. Live health readings and next-action suggestions stay on today.
          </AppText>
        </Card>
      )}
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
