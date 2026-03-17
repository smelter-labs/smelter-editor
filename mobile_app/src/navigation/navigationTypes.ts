import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export type RootStackParamList = {
  JoinRoom: undefined;
  Main: undefined;
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const SCREEN_NAMES = {
  JOIN_ROOM: "JoinRoom" as const,
  MAIN: "Main" as const,
};

export const MAIN_SCREEN_INDEX = {
  LAYOUT: 0,
  INPUTS: 1,
  TIMELINE: 2,
  DEBUG: 3,
} as const;

export const MAIN_SCREEN_COUNT = Object.keys(MAIN_SCREEN_INDEX).length;
