import { MD3DarkTheme } from "react-native-paper";
import type { MD3Theme } from "react-native-paper";

export const appColors = {
  bg: "#0f0f1a",
  surface: "#1e1e2e",
  surface2: "#0f172a",
  text: "#e2e8f0",
  muted: "#94a3b8",
  subtle: "#64748b",
  dim: "#475569",
  accent: "#bfdbfe",
  purple: "#7c3aed",
  slate: "#334155",
  blue: "#1d4ed8",
  red: "#7f1d1d",
};

export const smelterTheme: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: appColors.purple,
    onPrimary: "#ffffff",
    primaryContainer: appColors.purple,
    onPrimaryContainer: "#ffffff",
    secondary: appColors.blue,
    onSecondary: appColors.accent,
    background: appColors.bg,
    onBackground: appColors.text,
    surface: appColors.surface,
    onSurface: appColors.text,
    surfaceVariant: appColors.surface2,
    onSurfaceVariant: appColors.muted,
    outline: appColors.slate,
    outlineVariant: appColors.slate,
    error: "#ef4444",
    onError: "#ffffff",
    errorContainer: appColors.red,
    onErrorContainer: "#ffffff",
    surfaceDisabled: appColors.slate,
    onSurfaceDisabled: appColors.dim,
    elevation: {
      level0: "transparent",
      level1: appColors.surface,
      level2: "#252536",
      level3: "#2c2c40",
      level4: "#333344",
      level5: "#3a3a4a",
    },
  },
};
