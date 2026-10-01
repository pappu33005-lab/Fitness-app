import { createContext, useContext, useMemo, type ReactNode } from "react";
import { useColorScheme } from "react-native";
import { palette, type AppColors, type ThemeName } from "./tokens";

export type ThemePreference = "system" | ThemeName;

type ThemeValue = {
  preference: ThemePreference;
  name: ThemeName;
  colors: AppColors;
};

const ThemeContext = createContext<ThemeValue>({
  preference: "system",
  name: "dark",
  colors: palette.dark,
});

export function ThemeProvider({
  preference,
  children,
}: {
  preference: ThemePreference;
  children: ReactNode;
}) {
  const system = useColorScheme();
  const value = useMemo<ThemeValue>(() => {
    const name: ThemeName =
      preference === "system" ? (system === "light" ? "light" : "dark") : preference;
    return { preference, name, colors: palette[name] };
  }, [preference, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}
