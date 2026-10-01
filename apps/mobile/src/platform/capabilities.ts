import { Platform } from "react-native";

/**
 * Production targets are iOS and Android development/release builds.
 * `web-preview` exists so Expo can render screens in a browser during development.
 * It is not a shipping platform and must not stand in for a native API.
 */
export type AppSurface = "ios" | "android" | "web-preview";

export function appSurface(): AppSurface {
  if (Platform.OS === "ios") return "ios";
  if (Platform.OS === "android") return "android";
  return "web-preview";
}

export const capabilities = {
  healthKit: Platform.OS === "ios",
  healthConnect: Platform.OS === "android",
  pedometer: Platform.OS === "ios" || Platform.OS === "android",
  backgroundLocation: Platform.OS === "ios" || Platform.OS === "android",
  barcodeCamera: Platform.OS === "ios" || Platform.OS === "android",
  nativeAudioSession: Platform.OS === "ios" || Platform.OS === "android",
  haptics: Platform.OS === "ios" || Platform.OS === "android",
  localNotifications: Platform.OS === "ios" || Platform.OS === "android",
} as const;
