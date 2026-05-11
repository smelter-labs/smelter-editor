import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import type { RootStackParamList } from "./navigationTypes";
import { SCREEN_NAMES } from "./navigationTypes";
import { useConnectionStore } from "../store/connectionStore";
import { JoinRoomScreen } from "../screens/JoinRoom/JoinRoomScreen";
import { HelpScreen } from "../screens/Help/HelpScreen";
import { CameraScreen } from "../screens/Camera/CameraScreen";
import { MainNavigator } from "./MainNavigator";

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const token = useConnectionStore((s) => s.token);

  return (
    <Stack.Navigator
      initialRouteName={token ? SCREEN_NAMES.MAIN : SCREEN_NAMES.JOIN_ROOM}
      screenOptions={{ headerShown: false, animation: "fade" }}
    >
      <Stack.Screen name={SCREEN_NAMES.JOIN_ROOM} component={JoinRoomScreen} />
      <Stack.Screen name={SCREEN_NAMES.MAIN} component={MainNavigator} />
      <Stack.Screen name={SCREEN_NAMES.HELP} component={HelpScreen} />
      <Stack.Screen name={SCREEN_NAMES.CAMERA} component={CameraScreen} />
    </Stack.Navigator>
  );
}
