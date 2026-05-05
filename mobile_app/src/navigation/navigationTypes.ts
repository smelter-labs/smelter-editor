import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

export type RootStackParamList = {
  JoinServer: undefined;
  JoinLobby: { serverUrl: string };
  JoinRoom: { serverUrl: string; initialRoomId?: string };
  Main: undefined;
  Help: undefined;
  Camera: { serverUrl: string; roomId: string };
};

export type RootNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export const SCREEN_NAMES = {
  JOIN_SERVER: "JoinServer" as const,
  JOIN_LOBBY: "JoinLobby" as const,
  JOIN_ROOM: "JoinRoom" as const,
  MAIN: "Main" as const,
  HELP: "Help" as const,
  CAMERA: "Camera" as const,
};

const MAIN_SCREEN_INDEX = {
  LAYOUT: 0,
  INPUTS: 1,
  TIMELINE: 2,
  DEBUG: 3,
} as const;

export const MAIN_SCREEN_COUNT = Object.keys(MAIN_SCREEN_INDEX).length;

export const MAIN_NAV_ARROW_WIDTH_RATIO = 0.05;
