import { StrictMode, useEffect } from "react";
import { Platform, StatusBar as RNStatusBar, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { NavigationContainer } from "@react-navigation/native";
import { PaperProvider } from "react-native-paper";
import * as ScreenOrientation from "expo-screen-orientation";
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
    ScreenOrientation.lockAsync(
      ScreenOrientation.OrientationLock.LANDSCAPE,
    ).catch((err) => console.warn("[App] orientation lock failed", err));
  }, []);

  useEffect(() => {
    if (Platform.OS !== "android") {
      return;
    }

    RNStatusBar.setHidden(true, "none");

    NavigationBar.setBackgroundColorAsync("transparent").catch((err) =>
      console.warn("[App] navigation bar background update failed", err),
    );
    NavigationBar.setBehaviorAsync("overlay-swipe").catch((err) =>
      console.warn("[App] navigation bar behavior update failed", err),
    );
    NavigationBar.setVisibilityAsync("hidden").catch((err) =>
      console.warn("[App] navigation bar hide failed", err),
    );

    return () => {
      NavigationBar.setVisibilityAsync("visible").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const { setClientId, setPeers, reset } = useConnectionStore.getState();

    const unsubConnected = wsService.on("connected", ({ clientId }) => {
      setClientId(clientId);
    });

    const unsubPeersUpdated = wsService.on("peers_updated", ({ peers }) => {
      setPeers(peers);
    });

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
