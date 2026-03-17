import React, { useMemo, useState } from "react";
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  ActivityIndicator,
  Button,
  Surface,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { useJoinRoom } from "./useJoinRoom";
import { getRoomDisplayName } from "../../services/apiService";
import { QRScannerModal } from "./QRScannerModal";
import { ErrorMessage } from "../../components/shared/ErrorMessage";
import { LoadingOverlay } from "../../components/shared/LoadingOverlay";
import { appColors } from "../../theme/paperTheme";

export function JoinRoomScreen() {
  const theme = useTheme();
  const [selectOpen, setSelectOpen] = useState(false);

  const {
    localServerUrl,
    setLocalServerUrl,
    localRoomId,
    setLocalRoomId,
    errors,
    isLoading,
    showQR,
    setShowQR,
    handleConnect,
    handleQRScan,
    rooms,
    roomsLoading,
    selectRoom,
  } = useJoinRoom();

  const hasRooms = rooms.length > 0;

  const roomItems = useMemo(
    () =>
      rooms.map((room) => ({
        value: room.roomId,
        label: getRoomDisplayName(room),
      })),
    [rooms],
  );

  const selectedRoomLabel = roomItems.find(
    (i) => i.value === localRoomId,
  )?.label;

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

        {/* Server URL */}
        <TextInput
          mode="outlined"
          label="Server URL"
          value={localServerUrl}
          onChangeText={setLocalServerUrl}
          placeholder="192.168.x.x:3001"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          error={!!errors.serverUrl}
        />
        <ErrorMessage message={errors.serverUrl ?? null} />

        {/* Room picker trigger */}
        <View style={styles.roomSection}>
          <View style={styles.roomLabelRow}>
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              Room ID
            </Text>
            {roomsLoading && <ActivityIndicator size={14} />}
          </View>

          {hasRooms && (
            <Pressable
              style={[
                styles.roomPicker,
                {
                  borderColor: theme.colors.outline,
                  backgroundColor: theme.colors.background,
                },
              ]}
              onPress={() => setSelectOpen(true)}
            >
              <Text
                variant="bodyMedium"
                style={{
                  color: selectedRoomLabel
                    ? theme.colors.onSurface
                    : theme.colors.onSurfaceVariant,
                }}
              >
                {selectedRoomLabel ?? "Select a room..."}
              </Text>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                ▼
              </Text>
            </Pressable>
          )}

          {/* Room picker modal */}
          <Modal
            visible={selectOpen}
            transparent
            animationType="fade"
            onRequestClose={() => setSelectOpen(false)}
          >
            <Pressable
              style={styles.modalBackdrop}
              onPress={() => setSelectOpen(false)}
            >
              <Surface
                style={[
                  styles.modalCard,
                  { borderColor: theme.colors.outline },
                ]}
                elevation={3}
              >
                <Text
                  variant="labelSmall"
                  style={[
                    styles.modalTitle,
                    { color: theme.colors.onSurfaceVariant },
                  ]}
                >
                  SELECT A ROOM
                </Text>
                <FlatList
                  data={roomItems}
                  keyExtractor={(item) => item.value}
                  renderItem={({ item }) => (
                    <Pressable
                      style={[
                        styles.roomItem,
                        { borderTopColor: appColors.slate + "66" },
                      ]}
                      onPress={() => {
                        const room = rooms.find((r) => r.roomId === item.value);
                        if (room) {
                          selectRoom(room);
                          setSelectOpen(false);
                        }
                      }}
                    >
                      <Text variant="bodyMedium">{item.label}</Text>
                      {localRoomId === item.value && (
                        <Text
                          variant="bodyMedium"
                          style={{ color: theme.colors.primary }}
                        >
                          ✓
                        </Text>
                      )}
                    </Pressable>
                  )}
                />
              </Surface>
            </Pressable>
          </Modal>

          {hasRooms && (
            <View
              style={[
                styles.divider,
                { backgroundColor: theme.colors.outline },
              ]}
            />
          )}

          <TextInput
            mode="outlined"
            label={hasRooms ? "Or type room ID manually" : "Room ID"}
            value={localRoomId}
            onChangeText={setLocalRoomId}
            placeholder={hasRooms ? "" : "my-room"}
            autoCapitalize="none"
            autoCorrect={false}
            error={!!errors.roomId}
          />
          <ErrorMessage message={errors.roomId ?? null} />
        </View>

        <ErrorMessage message={errors.general ?? null} />

        {/* Connect button */}
        <Button
          mode="contained"
          onPress={handleConnect}
          loading={isLoading}
          disabled={isLoading}
          style={styles.connectButton}
          buttonColor="#ffffff"
          textColor="#000000"
        >
          {isLoading ? "Connecting..." : "Connect"}
        </Button>

        {/* QR button */}
        <Button mode="text" onPress={() => setShowQR(true)}>
          Scan QR Code instead
        </Button>
      </Surface>

      {isLoading && <LoadingOverlay message="Connecting to room..." />}

      <QRScannerModal
        isVisible={showQR}
        onScan={handleQRScan}
        onClose={() => setShowQR(false)}
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
    width: 440,
    gap: 8,
  },
  roomSection: {
    gap: 6,
  },
  roomLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  roomPicker: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    borderWidth: 1,
    borderRadius: 12,
    width: 380,
    overflow: "hidden",
  },
  modalTitle: {
    letterSpacing: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  roomItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
  },
  divider: {
    height: 1,
    marginVertical: 4,
  },
  connectButton: {
    marginTop: 8,
  },
});
