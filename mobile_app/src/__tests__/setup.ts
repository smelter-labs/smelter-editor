// Global test setup — runs before every test file.
// Stubs for React Native / Expo modules that can't run in jsdom.

import { vi } from "vitest";

// AsyncStorage — backed by an in-memory map so persist/load round-trips work.
const _store: Record<string, string> = {};
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn((key: string) => Promise.resolve(_store[key] ?? null)),
    setItem: vi.fn((key: string, value: string) => {
      _store[key] = value;
      return Promise.resolve();
    }),
    removeItem: vi.fn((key: string) => {
      delete _store[key];
      return Promise.resolve();
    }),
    clear: vi.fn(() => {
      Object.keys(_store).forEach((k) => delete _store[k]);
      return Promise.resolve();
    }),
  },
}));

// React Navigation — useNavigation returns a jest spy object.
vi.mock("@react-navigation/native", () => ({
  useNavigation: vi.fn(() => ({
    navigate: vi.fn(),
    replace: vi.fn(),
    goBack: vi.fn(),
  })),
}));

// Expo screen orientation — no-op in tests.
vi.mock("expo-screen-orientation", () => ({
  lockAsync: vi.fn(() => Promise.resolve()),
  OrientationLock: { LANDSCAPE: "LANDSCAPE", PORTRAIT: "PORTRAIT" },
}));
