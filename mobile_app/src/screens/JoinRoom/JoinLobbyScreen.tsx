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
import { useJoinLobby } from "./useJoinLobby";
import { ErrorMessage } from "../../components/shared/ErrorMessage";

export function JoinLobbyScreen() {
  const theme = useTheme();
  const isTablet = useIsTablet();
  const navigation = useNavigation<RootNavigationProp>();

  useEffect(() => {
    if (isTablet === null) return;
    ScreenOrientation.lockAsync(
      isTablet
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT,
    ).catch((err) =>
      console.warn("[JoinLobbyScreen] orientation lock failed", err),
    );
  }, [isTablet]);

  const {
    serverUrl,
    createStatus,
    createError,
    handleJoinRoom,
    handleCreateRoom,
  } = useJoinLobby();

  const isLoading = createStatus === "loading";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior="padding"
    >
      <Surface style={styles.card} elevation={2}>
        <Text variant="headlineMedium">Smelter Editor</Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            justifyContent: "flex-start",
          }}
        >
          <Text
            variant="bodyMedium"
            style={{ color: theme.colors.onSurfaceVariant, marginBottom: 4 }}
          >
            Connected to
          </Text>
          <View
            style={[
              styles.serverBadge,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
          >
            <Text
              variant="bodySmall"
              style={{ color: theme.colors.onSurfaceVariant }}
              numberOfLines={1}
            >
              {serverUrl}
            </Text>
          </View>
        </View>

        <ErrorMessage message={createError} />

        <View style={styles.actions}>
          <Button
            mode="contained"
            onPress={handleJoinRoom}
            disabled={isLoading}
            style={styles.actionButton}
            buttonColor="#ffffff"
            textColor="#000000"
            icon="login"
          >
            Join room
          </Button>
          <Button
            mode="contained-tonal"
            onPress={() => void handleCreateRoom()}
            loading={isLoading}
            disabled={isLoading}
            style={styles.actionButton}
            icon="plus-circle-outline"
          >
            {isLoading ? "Creating..." : "Create room"}
          </Button>
        </View>

        <View style={styles.bottomRow}>
          <Button
            mode="text"
            icon="arrow-left"
            onPress={() => navigation.goBack()}
          >
            Change server
          </Button>
          <IconButton
            icon="help-circle-outline"
            size={20}
            onPress={() => navigation.navigate(SCREEN_NAMES.HELP)}
          />
        </View>
      </Surface>
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
  serverBadge: {
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  actions: {
    gap: 8,
    marginTop: 4,
  },
  actionButton: {
    width: "100%",
  },
  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
});
