import React from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { ITEM_HEIGHT, LIST_HEIGHT } from "./joinRoomConstants";
import { Button, Icon, Text, TextInput, useTheme } from "react-native-paper";
import { ErrorMessage } from "../../components/shared/ErrorMessage";
import { getRoomDisplayName, type ActiveRoom } from "../../services/apiService";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons/static";

interface Props {
  selectedServerUrl: string;
  onChangeServer: () => void;
  rooms: ActiveRoom[];
  selectedRoomId: string;
  onSelectRoom: (roomId: string) => void;
  isPrivateRoom: boolean;
  onTogglePrivateRoom: () => void;
  privateRoomId: string;
  onPrivateRoomIdChange: (id: string) => void;
  errors: { roomId?: string; general?: string };
  isLoading: boolean;
  onConnect: () => void;
  onConnectAsCamera: () => void;
}

export function RoomSection({
  selectedServerUrl,
  onChangeServer,
  rooms,
  selectedRoomId,
  onSelectRoom,
  isPrivateRoom,
  onTogglePrivateRoom,
  privateRoomId,
  onPrivateRoomIdChange,
  errors,
  isLoading,
  onConnect,
  onConnectAsCamera,
}: Props) {
  const theme = useTheme();

  return (
    <View style={styles.section}>
      {!isPrivateRoom ? (
        <>
          {rooms.length > 0 ? (
            <>
              <View
                style={{
                  flexDirection: "row",
                  width: "100%",
                  justifyContent: "space-between",
                }}
              >
                <Button onPress={onChangeServer} icon="arrow-left">
                  Back
                </Button>
                <Button onPress={onTogglePrivateRoom}>
                  Join a private room
                </Button>
              </View>

              <View
                style={[styles.roomList, { borderColor: theme.colors.outline }]}
              >
                <FlatList
                  data={rooms}
                  keyExtractor={(r) => r.roomId}
                  scrollEnabled={rooms.length > 5}
                  keyboardShouldPersistTaps="always"
                  getItemLayout={(_, index) => ({
                    length: ITEM_HEIGHT,
                    offset: ITEM_HEIGHT * index,
                    index,
                  })}
                  renderItem={({ item, index }) => (
                    <Pressable
                      onPress={() => onSelectRoom(item.roomId)}
                      style={[
                        styles.roomItem,
                        index > 0 && {
                          borderTopWidth: StyleSheet.hairlineWidth,
                          borderTopColor: theme.colors.outline,
                        },
                        selectedRoomId === item.roomId && {
                          backgroundColor: theme.colors.surfaceVariant,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.roomItemText,
                          { color: theme.colors.onSurface },
                        ]}
                        numberOfLines={1}
                      >
                        {getRoomDisplayName(item)}
                      </Text>
                      {selectedRoomId === item.roomId && (
                        <Icon
                          source="check"
                          size={16}
                          color={theme.colors.primary}
                        />
                      )}
                    </Pressable>
                  )}
                />
              </View>
            </>
          ) : (
            <>
              <Button
                style={styles.subtleButton}
                onPress={onChangeServer}
                icon="arrow-left"
              >
                Back
              </Button>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                No active rooms on this server.
              </Text>
            </>
          )}
        </>
      ) : (
        <>
          <Button
            mode="text"
            onPress={onTogglePrivateRoom}
            style={styles.subtleButton}
            icon="arrow-left"
          >
            Back
          </Button>
          <TextInput
            mode="outlined"
            label="Private Room ID"
            value={privateRoomId}
            onChangeText={onPrivateRoomIdChange}
            autoCapitalize="none"
            autoCorrect={false}
            error={!!errors.roomId}
          />
        </>
      )}

      <ErrorMessage message={errors.roomId ?? null} />
      <ErrorMessage message={errors.general ?? null} />

      <View style={styles.joinButtons}>
        <Button
          mode="contained"
          onPress={onConnect}
          loading={isLoading}
          disabled={isLoading}
          style={styles.joinButton}
          buttonColor="#ffffff"
          textColor="#000000"
        >
          {isLoading ? "Connecting..." : "Join as Editor"}
        </Button>
        <Button
          mode="contained-tonal"
          onPress={onConnectAsCamera}
          disabled={isLoading}
          style={styles.joinButton}
          icon="video"
        >
          Join as Camera
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  roomList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: "hidden",
    height: LIST_HEIGHT,
  },
  roomItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: ITEM_HEIGHT,
  },
  roomItemText: {
    flex: 1,
    fontSize: 14,
  },
  subtleButton: {
    alignSelf: "flex-start",
    marginLeft: -8,
  },
  joinButtons: {
    marginTop: 4,
    flexDirection: "row",
    gap: 8,
  },
  joinButton: {
    flex: 1,
  },
});
