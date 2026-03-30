import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Button, Divider, Surface, Text, useTheme } from "react-native-paper";
import { useShallow } from "zustand/react/shallow";
import { useConnectionStore } from "../../store";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import { useLeaveRoom } from "../../hooks/useLeaveRoom";

export function DebugScreen() {
  const theme = useTheme();
  const leaveRoom = useLeaveRoom();
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
      <ScrollView contentContainerStyle={styles.content}>
        <Text
          variant="headlineMedium"
          style={{ color: theme.colors.onBackground }}
        >
          Debug
        </Text>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
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
