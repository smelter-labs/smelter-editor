import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  NavigationContainer,
  createNavigationContainerRef,
} from "@react-navigation/native";
import { PaperProvider } from "react-native-paper";
import * as ScreenOrientation from "expo-screen-orientation";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { smelterTheme } from "./theme/paperTheme";
import { RootNavigator } from "./navigation/RootNavigator";
import {
  SCREEN_NAMES,
  type RootStackParamList,
} from "./navigation/navigationTypes";
import { wsService } from "./services/websocketService";
import { useConnectionStore } from "./store";

SplashScreen.preventAutoHideAsync();

const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function App() {
  useEffect(() => {
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch((err) => console.warn("[App] orientation lock failed", err));
  }, []);

  useEffect(() => {
    const { setClientId, setPeers, reset } = useConnectionStore.getState();

    const unsubConnected = wsService.on("connected", ({ clientId }) => {
      setClientId(clientId);
    });

    const unsubPeersUpdated = wsService.on("peers_updated", ({ peers }) => {
      setPeers(peers);
    });

    const unsubDisconnected = wsService.on("disconnected", () => {
      wsService.disconnect();
      reset();
      if (navigationRef.isReady()) {
        navigationRef.reset({
          index: 0,
          routes: [{ name: SCREEN_NAMES.JOIN_ROOM }],
        });
      }
    });

    return () => {
      unsubConnected();
      unsubPeersUpdated();
      unsubDisconnected();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <PaperProvider theme={smelterTheme}>
        <NavigationContainer
          ref={navigationRef}
          onReady={() => {
            SplashScreen.hideAsync();
          }}
        >
          <StatusBar hidden />
          <RootNavigator />
        </NavigationContainer>
      </PaperProvider>
    </GestureHandlerRootView>
  );
}
