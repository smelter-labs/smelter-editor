import React, { useMemo } from "react";
import {
  FlatList,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { ITEM_HEIGHT, LIST_HEIGHT } from "./joinRoomConstants";
import {
  ActivityIndicator,
  Icon,
  IconButton,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { HealthIcon } from "./HealthIcon";
import { appColors } from "../../theme/paperTheme";
import type { HealthStatus, ServerStatus } from "./useJoinRoom";

interface Props {
  savedUrls: string[];
  healthStatus: Record<string, HealthStatus>;
  selectedServerUrl: string;
  onServerUrlChange: (url: string) => void;
  onRemoveUrl: (url: string) => void;
  onJoinServer: (urlOverride?: string) => void;
  serverStatus: ServerStatus;
  serverError: string | null;
}

export function ServerSection({
  savedUrls,
  healthStatus,
  selectedServerUrl,
  onServerUrlChange,
  onRemoveUrl,
  onJoinServer,
  serverStatus,
  serverError,
}: Props) {
  const theme = useTheme();

  const filteredUrls = useMemo(() => {
    const q = selectedServerUrl.trim().toLowerCase();
    if (!q) return savedUrls;
    return savedUrls.filter((u) => u.toLowerCase().includes(q));
  }, [savedUrls, selectedServerUrl]);

  return (
    <View style={styles.section}>
      <View style={styles.inputRow}>
        <TextInput
          mode="outlined"
          label="Server URL"
          value={selectedServerUrl}
          onChangeText={onServerUrlChange}
          placeholder="192.168.x.x:3001"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          style={styles.urlInput}
        />
        {serverStatus === "loading" ? (
          <ActivityIndicator style={styles.connectButton} />
        ) : (
          <IconButton
            icon="lan-connect"
            mode="contained"
            containerColor="#ffffff"
            iconColor="#000000"
            size={22}
            style={styles.connectButton}
            disabled={!selectedServerUrl.trim()}
            onPress={() => onJoinServer()}
          />
        )}
      </View>

      <View style={[styles.historyList, { borderColor: theme.colors.outline }]}>
        <FlatList
          data={filteredUrls}
          keyExtractor={(item) => item}
          scrollEnabled={filteredUrls.length > 5}
          keyboardShouldPersistTaps="always"
          getItemLayout={(_, index) => ({
            length: ITEM_HEIGHT,
            offset: ITEM_HEIGHT * index,
            index,
          })}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => {
                onServerUrlChange(item);
                onJoinServer(item);
              }}
              style={[
                styles.historyItem,
                index > 0 && {
                  borderTopWidth: StyleSheet.hairlineWidth,
                  borderTopColor: theme.colors.outline,
                },
                selectedServerUrl === item && {
                  backgroundColor: theme.colors.surfaceVariant,
                },
              ]}
            >
              <HealthIcon status={healthStatus[item]} />
              <Text
                style={[
                  styles.historyItemText,
                  { color: theme.colors.onSurface },
                ]}
                numberOfLines={1}
              >
                {item}
              </Text>
              <TouchableOpacity
                onPress={() => onRemoveUrl(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Icon
                  source="close"
                  size={14}
                  color={theme.colors.onSurfaceVariant}
                />
              </TouchableOpacity>
            </Pressable>
          )}
        />
      </View>

      {serverStatus === "error" && serverError && (
        <Text style={styles.errorText}>{serverError}</Text>
      )}
      {serverStatus === "success" && (
        <Text style={styles.successText}>Connected — select a room below.</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  urlInput: {
    flex: 1,
  },
  connectButton: {
    marginTop: 6,
  },
  historyList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    overflow: "hidden",
    height: LIST_HEIGHT,
  },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    height: ITEM_HEIGHT,
  },
  historyItemText: {
    flex: 1,
    fontSize: 14,
  },
  errorText: {
    fontSize: 13,
    color: appColors.error,
  },
  successText: {
    fontSize: 13,
    color: appColors.success,
  },
});
