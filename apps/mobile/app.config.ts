import type { ExpoConfig } from "expo/config";
import brand from "../../packages/brand/brand.json";

const cameraPermission = `${brand.name} uses the camera to scan a food barcode.`;
const locationWhenInUse = `${brand.name} uses your location while you record a run, walk, ride, or hike.`;
const locationAlways = `${brand.name} uses your location in the background only during an activity you started, so the route continues if the screen locks.`;

const config: ExpoConfig = {
  name: brand.name,
  slug: brand.slug,
  version: brand.version,
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: brand.scheme,
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: brand.iosBundleIdentifier,
    supportsTablet: true,
    infoPlist: {
      NSCameraUsageDescription: cameraPermission,
      UIBackgroundModes: ["audio", "location"],
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: brand.androidPackage,
    adaptiveIcon: {
      backgroundColor: "#12110F",
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    permissions: [
      "android.permission.CAMERA",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_BACKGROUND_LOCATION",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_LOCATION",
    ],
    predictiveBackGestureEnabled: false,
  },
  // Local UI preview only. iOS and Android development builds are the product.
  web: {
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-sqlite",
    "expo-secure-store",
    [
      "expo-audio",
      {
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    "expo-dev-client",
    [
      "expo-splash-screen",
      {
        backgroundColor: "#12110F",
        image: "./assets/images/splash-icon.png",
        imageWidth: 76,
      },
    ],
    [
      "expo-camera",
      {
        cameraPermission,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      "expo-location",
      {
        locationWhenInUsePermission: locationWhenInUse,
        locationAlwaysAndWhenInUsePermission: locationAlways,
        locationAlwaysPermission: locationAlways,
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
      },
    ],
    [
      "expo-build-properties",
      {
        android: {
          minSdkVersion: 26,
        },
      },
    ],
    [
      "@kingstinct/react-native-healthkit",
      {
        NSHealthShareUsageDescription: `${brand.name} reads steps, workouts, heart rate, and sleep you have already allowed in Apple Health.`,
        NSHealthUpdateUsageDescription: `${brand.name} can save workouts and body measurements you log, after you allow it.`,
        background: false,
      },
    ],
    "react-native-health-connect",
    "expo-localization",
    "expo-notifications",
    "@maplibre/maplibre-react-native",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    brand: brand.name,
    // Public runtime env expected at build time (see .env.example / README EAS section).
    // Values come from process.env / EAS secrets — never hardcode secrets here.
    easPublicEnv: [
      "EXPO_PUBLIC_SUPABASE_URL",
      "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "EXPO_PUBLIC_MAP_TILE_STYLE_URL",
    ],
  },
};

export default config;
