import { useEffect } from "react";
import { useFonts, Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold } from "@expo-google-fonts/outfit";
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavigationTheme, useRouter, useSegments } from "expo-router";
import * as Notifications from "expo-notifications";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { AppState, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "@/activity/backgroundLocation";
import { AppStateProvider, useAppState } from "@/data/app-state";
import { initSync } from "@/data/sync";
import { currentGoalProgress } from "@/notifications/goals";
import { configureNotifications, routeForNotificationResponse, syncReminders } from "@/notifications/scheduler";
import { ThemeProvider, useTheme } from "@/design/theme";
import { ErrorState, LoadingState } from "@/components/ui";

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function Gate() {
  const { ready, bootError, profile } = useAppState();
  const segments = useSegments();
  const router = useRouter();
  const onboarded = Boolean(profile?.onboardingCompletedAt);

  useEffect(() => {
    if (!ready || bootError) return;
    const onOnboarding = segments[0] === "onboarding";
    if (!onboarded && !onOnboarding) router.replace("/onboarding");
    if (onboarded && onOnboarding) router.replace("/");
  }, [bootError, onboarded, ready, router, segments]);

  // Reminders: re-sync on launch and whenever the app returns to the foreground, so a
  // reminder for a goal that has since been met is dropped without needing its own
  // per-mutation hook. Tapping a reminder opens the screen it names, nothing else.
  useEffect(() => {
    if (!ready || bootError) return;
    let cancelled = false;
    function resync() {
      void currentGoalProgress(profile)
        .then((goals) => syncReminders(goals))
        .catch(() => undefined);
    }
    void configureNotifications().then(() => {
      if (!cancelled) resync();
    });
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeForNotificationResponse(response);
      // typedRoutes narrows router.push's href type; NotificationRoute is already restricted to known screens.
      if (route) router.push(route as Parameters<typeof router.push>[0]);
    });
    const appStateSubscription = AppState.addEventListener("change", (next) => {
      if (next === "active") resync();
    });
    return () => {
      cancelled = true;
      responseSubscription.remove();
      appStateSubscription.remove();
    };
  }, [ready, bootError, profile, router]);

  if (!ready) return <LoadingState label="Opening your local record" />;
  if (bootError) return <ErrorState title="This device could not open its database" body={bootError} />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="profile" options={{ presentation: "modal" }} />
      <Stack.Screen name="account" />
      <Stack.Screen name="reminders" />
      <Stack.Screen name="health" />
      <Stack.Screen name="coach" />
      <Stack.Screen name="progress" />
      <Stack.Screen name="record" />
      <Stack.Screen name="activity/[id]" />
      <Stack.Screen name="food/new" />
      <Stack.Screen name="food/[id]" />
      <Stack.Screen name="workout/[id]" />
      <Stack.Screen name="search" />
      <Stack.Screen name="scan" />
      <Stack.Screen name="sounds" />
      <Stack.Screen name="exercises" />
    </Stack>
  );
}

function ThemedApp() {
  const { theme } = useAppState();
  return (
    <ThemeProvider preference={theme}>
      <Chrome />
    </ThemeProvider>
  );
}

function Chrome() {
  const { colors, name } = useTheme();
  const navigationTheme = name === "dark" ? DarkTheme : DefaultTheme;
  return (
    <NavigationTheme value={{ ...navigationTheme, colors: { ...navigationTheme.colors, background: colors.background, card: colors.surface, text: colors.text, border: colors.border, primary: colors.accent } }}>
      <StatusBar style={name === "dark" ? "light" : "dark"} />
      <View style={{ flex: 1, backgroundColor: colors.canvas, alignItems: "center" }}>
        <View style={{ flex: 1, width: "100%", maxWidth: 480, backgroundColor: colors.background }}>
          <Gate />
        </View>
      </View>
    </NavigationTheme>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({ Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold });
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded]);
  useEffect(() => initSync(), []);
  if (!loaded) return null;
  return (
    <SafeAreaProvider>
      <AppStateProvider>
        <ThemedApp />
      </AppStateProvider>
    </SafeAreaProvider>
  );
}
