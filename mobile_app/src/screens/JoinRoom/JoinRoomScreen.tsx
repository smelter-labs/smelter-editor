import React, { useEffect, useState } from "react";
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
import { useJoinRoom } from "./useJoinRoom";
import { ServerSection } from "./ServerSection";
import { RoomSection } from "./RoomSection";
import { QRScannerModal } from "./QRScannerModal";
import { LoadingOverlay } from "../../components/shared/LoadingOverlay";
import { JoinRoomSettingsPanel } from "./JoinRoomSettingsPanel";

export function JoinRoomScreen() {
  const theme = useTheme();
  const navigation = useNavigation<RootNavigationProp>();
  const isTablet = useIsTablet();
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    if (isTablet === null) return;
    ScreenOrientation.lockAsync(
      isTablet
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT,
    ).catch((err) =>
      console.warn("[JoinRoomScreen] orientation lock failed", err),
    );
  }, [isTablet]);

  const {
    savedUrls,
    healthStatus,
    selectedServerUrl,
    handleServerUrlChange,
    removeSavedUrl,
    handleJoinServer,
    serverStatus,
    serverError,
    phase,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    isPrivateRoom,
    togglePrivateRoom,
    privateRoomId,
    setPrivateRoomId,
    errors,
    isLoading,
    handleConnect,
    showQR,
    setShowQR,
    handleQRScan,
  } = useJoinRoom();

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

        {phase === "server" ? (
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
        ) : (
          <RoomSection
            selectedServerUrl={selectedServerUrl}
            onChangeServer={() => handleServerUrlChange(selectedServerUrl)}
            rooms={rooms}
            selectedRoomId={selectedRoomId}
            onSelectRoom={setSelectedRoomId}
            isPrivateRoom={isPrivateRoom}
            onTogglePrivateRoom={togglePrivateRoom}
            privateRoomId={privateRoomId}
            onPrivateRoomIdChange={setPrivateRoomId}
            errors={errors}
            isLoading={isLoading}
            onConnect={handleConnect}
          />
        )}

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

      {isLoading && <LoadingOverlay message="Connecting to room..." />}

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
});
