import { StrictMode, useEffect } from "react";
import {
  AppState,
  Platform,
  StatusBar as RNStatusBar,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { PaperProvider } from "react-native-paper";
import * as SplashScreen from "expo-splash-screen";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { smelterTheme } from "./theme/paperTheme";
import { RootNavigator } from "./navigation/RootNavigator";
import { SCREEN_NAMES } from "./navigation/navigationTypes";
import { navigationRef } from "./navigation/navigationRef";
import { wsService } from "./services/websocketService";
import { useConnectionStore } from "./store";

SplashScreen.preventAutoHideAsync();

export function App() {
  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    RNStatusBar.setHidden(true, "none");

    NavigationBar.setVisibilityAsync("hidden").catch((err) =>
      console.warn("[App] navigation bar hide failed", err),
    );

    // Re-apply hidden state when app comes to focus
    const appStateSubscription = AppState.addEventListener(
      "change",
      (state) => {
        if (state === "active") {
          RNStatusBar.setHidden(true, "none");
          NavigationBar.setVisibilityAsync("hidden").catch((err) =>
            console.warn("[App] navigation bar hide on app focus failed", err),
          );
        }
      },
    );

    return () => {
      appStateSubscription.remove();
      NavigationBar.setVisibilityAsync("visible").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const { setClientId, setPeers, setTimelinePlaying, reset } =
      useConnectionStore.getState();

    const unsubConnected = wsService.on("connected", ({ clientId }) => {
      setClientId(clientId);
    });

    const unsubPeersUpdated = wsService.on("peers_updated", ({ peers }) => {
      setPeers(peers);
    });

    const unsubTimelinePlaybackUpdated = wsService.on(
      "timeline_playback_updated",
      ({ isTimelinePlaying }) => {
        setTimelinePlaying(isTimelinePlaying);
      },
    );

    const goToJoinRoom = () => {
      wsService.disconnect();
      reset();
      if (navigationRef.isReady()) {
        navigationRef.reset({
          index: 0,
          routes: [{ name: SCREEN_NAMES.JOIN_ROOM }],
        });
      }
    };

    const unsubDisconnected = wsService.on("disconnected", goToJoinRoom);

    return () => {
      unsubConnected();
      unsubPeersUpdated();
      unsubTimelinePlaybackUpdated();
      unsubDisconnected();
    };
  }, []);

  return (
    <StrictMode>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <PaperProvider theme={smelterTheme}>
          <View
            style={{ flex: 1, backgroundColor: smelterTheme.colors.background }}
          >
            <NavigationContainer
              ref={navigationRef}
              onReady={() => {
                SplashScreen.hideAsync();
              }}
            >
              <StatusBar hidden translucent />
              <RootNavigator />
            </NavigationContainer>
          </View>
        </PaperProvider>
      </GestureHandlerRootView>
    </StrictMode>
  );
}
