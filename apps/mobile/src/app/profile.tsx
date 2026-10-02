import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { brandConfig } from "@vitacore/brand";
import { AppText, Button, Dialog, Screen, SegmentedControl, Toggle } from "@/components/ui";
import { useAppState } from "@/data/app-state";
import { deleteAllLocalData, type LocalProfile } from "@/data/db";
import { exportLocalJson } from "@/data/logs";
import { syncNow, useSyncStatus } from "@/data/sync";
import { copy } from "@/i18n/copy";
import { useTheme } from "@/design/theme";
import { space } from "@/design/tokens";
import type { ThemePreference } from "@/design/theme";

const SYNC_STATUS_COPY: Record<string, string> = {
  idle: "Sign in on the Account screen to back up this device's history.",
  syncing: "Syncing…",
  synced: "Everything on this device is backed up.",
  offline: "No connection right now. Nothing is lost — this will pick back up automatically.",
  auth_required: "Your sign-in needs to be refreshed before syncing can continue.",
  claim_required: "Confirm on Account that local data on this device may be associated with the signed-in account.",
  error: "Some records could not sync yet. They stay on this device and will be retried.",
};

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, theme, setTheme, haptics, setHaptics, updateProfile, refresh } = useAppState();
  const { colors } = useTheme();
  const [confirm, setConfirm] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const sync = useSyncStatus();

  return (
    <Screen>
      <AppText variant="label">{brandConfig.name}</AppText>
      <AppText variant="h1">{profile?.displayName ?? "Profile"}</AppText>
      <AppText variant="small" color={colors.textSecondary}>Version {brandConfig.version}</AppText>
      <View style={{ height: space.lg }} />
      <AppText variant="label">Appearance</AppText>
      <SegmentedControl<ThemePreference>
        value={theme}
        onChange={(value) => void setTheme(value)}
        options={[
          { value: "system", label: "System" },
          { value: "dark", label: "Dark" },
          { value: "light", label: "Light" },
        ]}
      />
      <Toggle label="Haptics" value={haptics} onChange={(value) => void setHaptics(value)} />
      <View style={{ height: space.lg }} />
      <AppText variant="label">Units</AppText>
      <SegmentedControl
        value={profile?.unitSystem ?? "metric"}
        onChange={(value) => {
          if (!profile) return;
          void updateProfile({ ...profile, unitSystem: value } satisfies LocalProfile);
        }}
        options={[{ value: "metric", label: "Metric" }, { value: "imperial", label: "Imperial" }]}
      />
      <View style={{ height: space.lg }} />
      <Button label="Account" onPress={() => router.push("/account")} />
      <View style={{ height: space.sm }} />
      <Button label="Reminders" tone="secondary" onPress={() => router.push("/reminders")} />
      <View style={{ height: space.sm }} />
      <Button label="Health & Devices" tone="secondary" onPress={() => router.push("/health")} />
      <View style={{ height: space.sm }} />
      <AppText variant="label">Sync</AppText>
      <AppText variant="small" color={colors.textSecondary}>
        {SYNC_STATUS_COPY[sync.status] ?? sync.status}
      </AppText>
      {sync.status !== "idle" ? (
        <>
          <View style={{ height: space.sm }} />
          <Button label="Sync now" tone="secondary" onPress={syncNow} disabled={sync.status === "syncing"} />
        </>
      ) : null}
      <View style={{ height: space.lg }} />
      <Button label="Export local data" tone="secondary" onPress={() => void exportLocalJson().then(setExported)} />
      {exported ? <AppText variant="caption">Export is ready in this session. It includes profile, events, workouts, and meal names. It does not include a cloud copy.</AppText> : null}
      <View style={{ height: space.sm }} />
      <Button label="Delete local data" tone="danger" onPress={() => setConfirm(true)} />
      <View style={{ height: space.xl }} />
      <AppText variant="caption">{copy.wearableBridge}</AppText>
      <AppText variant="caption">{copy.watchLater}</AppText>
      <AppText variant="caption">{copy.disclaimer}</AppText>
      <Dialog
        visible={confirm}
        title="Delete everything on this device?"
        body="Workouts, meals, and the guest profile on this device are removed. A cloud account, if you have one, is not deleted here."
        confirmLabel="Delete"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          void deleteAllLocalData().then(() => refresh());
          setConfirm(false);
        }}
      />
    </Screen>
  );
}
