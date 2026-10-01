import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

export async function selectionHaptic(enabled: boolean): Promise<void> {
  if (!enabled || Platform.OS === "web") return;
  await Haptics.selectionAsync();
}

export async function successHaptic(enabled: boolean): Promise<void> {
  if (!enabled || Platform.OS === "web") return;
  await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
}
