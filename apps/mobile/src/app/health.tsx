import { useCallback, useState } from "react";
import { Linking, Platform, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { describeHealthConnection, newExternalWorkouts, type HealthConnectionSummary } from "@vitacore/domain";
import { AppText, Button, Card, Screen } from "@/components/ui";
import { connectPlatformHealth, readRecentWorkouts, type ExternalWorkoutSample, type HealthConnection } from "@/health";
import { listActivities, listWorkouts } from "@/data/logs";
import { readPreference, writePreference } from "@/data/db";
import { copy } from "@/i18n/copy";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";

const LAST_READ_KEY = "health_last_successful_read_at";

function platformFor(): "healthkit" | "health_connect" | "unsupported" {
  if (Platform.OS === "ios") return "healthkit";
  if (Platform.OS === "android") return "health_connect";
  return "unsupported";
}

function toSummary(connection: HealthConnection, lastRead: string | null): HealthConnectionSummary {
  const platform = platformFor();
  if (platform === "unsupported") return { platform, status: "unavailable", lastSuccessfulReadAt: null };
  if (connection === "unavailable") return { platform, status: "unavailable", lastSuccessfulReadAt: null };
  if (connection === "denied") {
    // Android's Health Connect reports a real denial; iOS's requestAuthorization resolving false
    // means the system sheet was dismissed without granting anything it could ask for right now —
    // whether any individual item was actually denied is never reported back on iOS (see health.md).
    return { platform, status: platform === "health_connect" ? "denied" : "unknown", lastSuccessfulReadAt: lastRead };
  }
  if (connection === "ready") return { platform, status: platform === "healthkit" ? "unknown" : "granted", lastSuccessfulReadAt: lastRead };
  return { platform, status: "unknown", lastSuccessfulReadAt: lastRead };
}

const WEARABLES: { name: string; status: string }[] = [
  { name: "Apple Watch", status: "Not a separate connection. Anything the Watch already writes into Apple Health is read from there — see below." },
  { name: "WHOOP", status: "Not connected. WHOOP has an official OAuth API, but it needs a registered developer app and requires the person to have their own WHOOP membership. Not built in this phase — see docs/wearables.md." },
  { name: "Fitbit", status: "Not connected. Fitbit's Web API needs OAuth and app registration; on Android, a Fitbit that already writes into Health Connect may show up above without a separate connection. See docs/wearables.md." },
  { name: "Garmin", status: "Not connected. Garmin's Health API requires applying to and being approved for their Connect Developer Program — not a self-serve signup. See docs/wearables.md." },
];

export default function HealthScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [connection, setConnection] = useState<HealthConnection | "checking">("checking");
  const [lastRead, setLastRead] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<ExternalWorkoutSample[] | null>(null);
  const [workoutsNote, setWorkoutsNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void readPreference(LAST_READ_KEY).then(setLastRead);
    }, []),
  );

  async function connect() {
    setBusy(true);
    const result = await connectPlatformHealth();
    setConnection(result);
    if (result === "ready") {
      const now = new Date().toISOString();
      await writePreference(LAST_READ_KEY, now);
      setLastRead(now);
      await loadExternalWorkouts();
    }
    setBusy(false);
  }

  async function loadExternalWorkouts() {
    const reading = await readRecentWorkouts();
    if (reading.status !== "value") {
      setWorkouts([]);
      setWorkoutsNote(reading.status === "empty" ? reading.detail : reading.detail);
      return;
    }
    const [manualWorkouts, activities] = await Promise.all([listWorkouts(), listActivities()]);
    const localSessions = [
      ...manualWorkouts.map((session) => ({ startedAt: session.started_at, endedAt: session.ended_at })),
      // activity_sessions' ended_at is not selected by listActivities; the null default below
      // covers these with the same rough one-hour window isWorkoutAlreadyRepresented uses for
      // any still-open session, which is an approximation, not the activity's real duration.
      ...activities.map((session) => ({ startedAt: session.started_at, endedAt: null as string | null })),
    ];
    const fresh = newExternalWorkouts(
      reading.workouts.map((workout) => ({ ...workout, source: platformFor() === "healthkit" ? "healthkit" : "health_connect" })),
      localSessions,
    );
    setWorkouts(fresh);
    setWorkoutsNote(
      fresh.length === 0
        ? "Every recent workout from Health matches something already logged in VitaCore, so nothing new is shown."
        : null,
    );
  }

  const summary = connection === "checking" ? null : toSummary(connection, lastRead);
  const platform = platformFor();

  return (
    <Screen>
      <AppText variant="h1">Health & Devices</AppText>
      <AppText variant="small" color={colors.textSecondary}>
        {platform === "unsupported"
          ? "Health data connections are not available in this preview."
          : "VitaCore reads from the platform health store on your phone. Nothing here is invented if a permission is off or a device isn't connected."}
      </AppText>
      <View style={{ height: space.lg }} />

      <Card>
        <AppText variant="label">{platform === "healthkit" ? "Apple Health" : platform === "health_connect" ? "Health Connect" : "Health data"}</AppText>
        <AppText variant="small" color={colors.textSecondary}>
          {summary ? describeHealthConnection(summary) : "Checking…"}
        </AppText>
        {platform !== "unsupported" ? (
          <>
            <View style={{ height: space.md }} />
            <Button label={busy ? "Working…" : "Connect / review access"} onPress={() => void connect()} disabled={busy} />
            {platform === "healthkit" ? (
              <>
                <View style={{ height: space.sm }} />
                <Button label="Open Settings > Privacy > Health" tone="ghost" onPress={() => void Linking.openSettings()} />
              </>
            ) : null}
          </>
        ) : null}
      </Card>

      <View style={{ height: space.lg }} />
      <AppText variant="label">Recent workouts from Health</AppText>
      <AppText variant="caption" color={colors.textSecondary}>Read-only. A workout you also logged in VitaCore is not shown twice.</AppText>
      <View style={{ height: space.sm }} />
      {workouts === null ? (
        <AppText variant="small" color={colors.textSecondary}>Connect above to check for recent workouts.</AppText>
      ) : workoutsNote ? (
        <AppText variant="small" color={colors.textSecondary}>{workoutsNote}</AppText>
      ) : (
        workouts.map((workout, index) => (
          <View key={workout.sourceRecordId ?? index} style={{ paddingVertical: 6 }}>
            <AppText variant="small">{workout.kind} · {new Date(workout.startedAt).toLocaleString()}</AppText>
          </View>
        ))
      )}

      <View style={{ height: space.xl }} />
      <AppText variant="label">Wearables</AppText>
      <View style={{ height: space.sm }} />
      {WEARABLES.map((item) => (
        <Card key={item.name} style={{ marginBottom: space.sm }}>
          <AppText variant="small">{item.name}</AppText>
          <AppText variant="caption" color={colors.textSecondary}>{item.status}</AppText>
        </Card>
      ))}
      <AppText variant="caption" color={colors.textSecondary}>{copy.wearableBridge}</AppText>
      <AppText variant="caption" color={colors.textSecondary}>{copy.watchLater}</AppText>

      <View style={{ height: space.lg }} />
      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
