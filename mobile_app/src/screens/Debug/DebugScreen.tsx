import React, { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import {
  Button,
  Chip,
  Divider,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { useShallow } from "zustand/react/shallow";
import { useNavigation } from "@react-navigation/native";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";
import { useConnectionStore } from "../../store";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import { SharedSettingsPanel } from "../../components/shared/SharedSettingsPanel";
import { useLeaveRoom } from "../../hooks/useLeaveRoom";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";
import type { RootNavigationProp } from "../../navigation/navigationTypes";

export function DebugScreen() {
  const theme = useTheme();
  const navigation = useNavigation<RootNavigationProp>();
  const leaveRoom = useLeaveRoom();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { status, clientId, peers, roomId, serverUrl } = useConnectionStore(
    useShallow((state) => ({
      status: state.status,
      clientId: state.clientId,
      peers: state.peers,
      roomId: state.roomId,
      serverUrl: state.serverUrl,
    })),
  );
  const selfPeer = clientId
    ? peers.find(
        (peer: { clientId: string; name: string }) =>
          peer.clientId === clientId,
      )
    : null;
  const clientName = selfPeer?.name ?? "—";

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScreenLabel label="Debug" />

      <View style={styles.toolbar}>
        <Chip
          compact
          mode="flat"
          style={styles.toolbarChip}
          textStyle={styles.toolbarChipText}
          onPress={() => navigation.navigate(SCREEN_NAMES.HELP)}
        >
          <MaterialDesignIcons
            name="help-circle-outline"
            color="#777777"
            size={16}
          />
        </Chip>
        <Chip
          compact
          mode="flat"
          style={styles.toolbarChip}
          textStyle={styles.toolbarChipText}
          onPress={() => setSettingsOpen(true)}
        >
          <MaterialDesignIcons name="cog" color="#777777" size={16} />
        </Chip>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Surface style={styles.card} elevation={2}>
          <Text variant="titleMedium">Connection</Text>
          <Text variant="bodyMedium">Status: {status}</Text>
          <Text variant="bodyMedium">Server: {serverUrl || "—"}</Text>
          <Text variant="bodyMedium">Room: {roomId || "—"}</Text>
          <Text variant="bodyMedium">Client ID: {clientId || "—"}</Text>
          <Text variant="bodyMedium">Client Name: {clientName}</Text>
        </Surface>

        <Button
          mode="contained"
          buttonColor={theme.colors.error}
          textColor={theme.colors.onError}
          onPress={leaveRoom}
          style={styles.leaveButton}
        >
          Leave room
        </Button>

        <Surface style={styles.card} elevation={2}>
          <Text variant="titleMedium">Peers ({peers.length})</Text>
          <Divider style={styles.divider} />

          {peers.length === 0 ? (
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              No peers connected.
            </Text>
          ) : (
            peers.map((peer: { clientId: string; name: string }) => (
              <View key={peer.clientId} style={styles.peerRow}>
                <Text variant="bodyLarge" style={styles.peerName}>
                  {peer.name || "Unnamed"}
                </Text>
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  {peer.clientId}
                </Text>
              </View>
            ))
          )}
        </Surface>
      </ScrollView>

      <SharedSettingsPanel
        isVisible={settingsOpen}
        side="right"
        onClose={() => setSettingsOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    height: 36,
    paddingHorizontal: 8,
    gap: 8,
  },
  toolbarChip: {
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  toolbarChipText: {
    color: "#CCCCCC",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderRadius: 12,
    padding: 16,
    gap: 6,
  },
  divider: {
    marginVertical: 6,
  },
  peerRow: {
    gap: 2,
    paddingVertical: 6,
  },
  peerName: {
    fontWeight: "600",
  },
  leaveButton: {
    borderRadius: 8,
  },
});
