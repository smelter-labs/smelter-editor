import React, { useEffect } from "react";
import { KeyboardAvoidingView, StyleSheet, View } from "react-native";
import {
  Button,
  IconButton,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import * as ScreenOrientation from "expo-screen-orientation";
import { useNavigation } from "@react-navigation/native";
import { useIsTablet } from "../../hooks/useIsTablet";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";
import type { RootNavigationProp } from "../../navigation/navigationTypes";
import { useJoinServer } from "./useJoinServer";
import { ServerSection } from "./ServerSection";
import { QRScannerModal } from "./QRScannerModal";
import { JoinRoomSettingsPanel } from "./JoinRoomSettingsPanel";
import { useState } from "react";

export function JoinServerScreen() {
  const theme = useTheme();
  const isTablet = useIsTablet();
  const navigation = useNavigation<RootNavigationProp>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (isTablet === null) return;
    ScreenOrientation.lockAsync(
      isTablet
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT,
    ).catch((err) =>
      console.warn("[JoinServerScreen] orientation lock failed", err),
    );
  }, [isTablet]);

  const {
    savedUrls,
    healthStatus,
    selectedServerUrl,
    handleServerUrlChange,
    removeSavedUrl,
    serverStatus,
    serverError,
    handleJoinServer,
    showQR,
    setShowQR,
    handleQRScan,
  } = useJoinServer();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior="padding"
    >
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineMedium">Smelter Editor</Text>
        <Text
          variant="bodyMedium"
          style={{ color: theme.colors.onSurfaceVariant, marginBottom: 8 }}
        >
          Connect to a room
        </Text>

        <ServerSection
          savedUrls={savedUrls}
          healthStatus={healthStatus}
          selectedServerUrl={selectedServerUrl}
          onServerUrlChange={handleServerUrlChange}
          onRemoveUrl={removeSavedUrl}
          onJoinServer={handleJoinServer}
          serverStatus={serverStatus}
          serverError={serverError}
        />

        <View style={styles.bottomRow}>
          <Button mode="text" onPress={() => setShowQR(true)}>
            Scan QR Code instead
          </Button>
          <View style={styles.iconRow}>
            <IconButton
              icon="help-circle-outline"
              size={20}
              onPress={() => navigation.navigate(SCREEN_NAMES.HELP)}
            />
            <IconButton
              icon="cog"
              size={20}
              onPress={() => setSettingsOpen(true)}
            />
          </View>
        </View>
      </Surface>

      {__DEV__ && (
        <Button
          mode="text"
          compact
          icon="bug-outline"
          style={styles.devButton}
          labelStyle={{ color: theme.colors.onSurfaceVariant, fontSize: 12 }}
          onPress={() =>
            navigation.navigate(SCREEN_NAMES.CAMERA, {
              serverUrl: "",
              roomId: "",
            })
          }
        >
          [DEV] Open WHIP camera directly
        </Button>
      )}

      <QRScannerModal
        isVisible={showQR}
        onScan={handleQRScan}
        onClose={() => setShowQR(false)}
      />

      <JoinRoomSettingsPanel
        isVisible={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    borderRadius: 16,
    padding: 32,
    width: "90%",
    maxWidth: 440,
    gap: 8,
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconRow: {
    flexDirection: "row",
  },
  devButton: {
    marginTop: 8,
    opacity: 0.6,
  },
});
