export const palette = {
  dark: {
    canvas: "#050506",
    background: "#0C0D10",
    surface: "#14161B",
    elevated: "#1C1F26",
    border: "rgba(255,255,255,0.08)",
    text: "#F6F3EC",
    textSecondary: "#B7B2A8",
    textMuted: "#7C776F",
    accent: "#E7A15A",
    accentMuted: "rgba(231,161,90,0.16)",
    onAccent: "#1A1208",
    success: "#8FCBB0",
    warning: "#E7A15A",
    danger: "#E58B7B",
    info: "#8EB7FF",
    track: "rgba(255,255,255,0.08)",
    chart: ["#E7A15A", "#C7B6FF", "#6FE0D2", "#8EB7FF", "#E58B7B"],
    stageAwake: "#F4F1EA",
    stageLight: "#8EB7FF",
    stageRem: "#C7B6FF",
    stageDeep: "#6FE0D2",
    shadow: "rgba(0,0,0,0.35)",
  },
  light: {
    canvas: "#E7E2D8",
    background: "#F7F4EF",
    surface: "#FFFCF8",
    elevated: "#FFFFFF",
    border: "rgba(28,26,23,0.08)",
    text: "#1C1A17",
    textSecondary: "#5C574F",
    textMuted: "#8A847A",
    accent: "#B86E2C",
    accentMuted: "rgba(184,110,44,0.12)",
    onAccent: "#FFF9F2",
    success: "#2F7D57",
    warning: "#B86E2C",
    danger: "#A33B32",
    info: "#2C5F99",
    track: "rgba(28,26,23,0.08)",
    chart: ["#B86E2C", "#6E5AA8", "#1F7A72", "#2C5F99", "#A33B32"],
    stageAwake: "#5C574F",
    stageLight: "#2C5F99",
    stageRem: "#6E5AA8",
    stageDeep: "#1F7A72",
    shadow: "rgba(28,26,23,0.08)",
  },
} as const;

export type ThemeName = keyof typeof palette;
export type AppColors = (typeof palette)[ThemeName];

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
} as const;

export const radius = {
  sm: 12,
  md: 18,
  lg: 26,
  pill: 999,
} as const;

export const font = {
  regular: "Outfit_400Regular",
  medium: "Outfit_500Medium",
  semibold: "Outfit_600SemiBold",
} as const;
