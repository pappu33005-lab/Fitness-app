import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ThemePreference } from "@/design/theme";
import { readPreference, readProfile, saveProfile, writePreference, type LocalProfile } from "./db";

type AppState = {
  ready: boolean;
  bootError: string | null;
  profile: LocalProfile | null;
  theme: ThemePreference;
  haptics: boolean;
  refresh: () => Promise<void>;
  updateProfile: (profile: LocalProfile) => Promise<void>;
  setTheme: (theme: ThemePreference) => Promise<void>;
  setHaptics: (enabled: boolean) => Promise<void>;
};

const AppStateContext = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [bootError, setBootError] = useState<string | null>(null);
  const [profile, setProfile] = useState<LocalProfile | null>(null);
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [haptics, setHapticsState] = useState(true);

  const refresh = useCallback(async () => {
    const [nextProfile, themeValue, hapticValue] = await Promise.all([
      readProfile(),
      readPreference("theme"),
      readPreference("haptics"),
    ]);
    setProfile(nextProfile);
    if (themeValue === "light" || themeValue === "dark" || themeValue === "system") setThemeState(themeValue);
    if (hapticValue === "0") setHapticsState(false);
    if (hapticValue === "1") setHapticsState(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await refresh();
        if (!cancelled) setReady(true);
      } catch (error: unknown) {
        if (cancelled) return;
        if (error instanceof Error) console.error(error.stack ?? error.message);
        setBootError(error instanceof Error ? error.message : "The local database could not be opened.");
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const value = useMemo<AppState>(
    () => ({
      ready,
      bootError,
      profile,
      theme,
      haptics,
      refresh,
      updateProfile: async (next) => {
        await saveProfile(next);
        setProfile(next);
      },
      setTheme: async (next) => {
        await writePreference("theme", next);
        setThemeState(next);
      },
      setHaptics: async (enabled) => {
        await writePreference("haptics", enabled ? "1" : "0");
        setHapticsState(enabled);
      },
    }),
    [ready, bootError, profile, theme, haptics, refresh],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(AppStateContext);
  if (!value) throw new Error("useAppState must be used inside AppStateProvider");
  return value;
}
