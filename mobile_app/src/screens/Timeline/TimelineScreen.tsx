import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text, useTheme } from "react-native-paper";
import { useNavigation } from "@react-navigation/native";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import { SharedSettingsPanel } from "../../components/shared/SharedSettingsPanel";
import {
  ScreenToolbar,
  ScreenToolbarChip,
  ToolbarIcon,
} from "../../components/shared/ScreenToolbar";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";
import type { RootNavigationProp } from "../../navigation/navigationTypes";
import { QRModal } from "../../components/shared/QRModal";
import { useConnectionStore } from "../../store";

/**
 * Timeline screen — placeholder only.
 * Will display input on/off timeline, shader schedule, and future actions.
 */
export function TimelineScreen() {
  const theme = useTheme();
  const navigation = useNavigation<RootNavigationProp>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [qrModalOpen, setQRModalOpen] = useState(false);
  const { serverUrl, roomId } = useConnectionStore();

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScreenLabel label="Timeline" />

      <ScreenToolbar style={styles.toolbar}>
        <ScreenToolbarChip
          onPress={() => navigation.navigate(SCREEN_NAMES.HELP)}
        >
          <ToolbarIcon name="help-circle-outline" />
        </ScreenToolbarChip>
        <ScreenToolbarChip onPress={() => setSettingsOpen(true)}>
          <ToolbarIcon name="cog" />
        </ScreenToolbarChip>

        <ScreenToolbarChip onPress={() => setQRModalOpen(true)}>
          <ToolbarIcon name="qrcode" />
        </ScreenToolbarChip>
      </ScreenToolbar>

      <QRModal
        visible={qrModalOpen}
        onDismiss={() => setQRModalOpen(false)}
        serverUrl={serverUrl}
        roomId={roomId}
      />

      <Text
        variant="headlineMedium"
        style={{ color: theme.colors.onBackground }}
      >
        Timeline
      </Text>
      <Text
        variant="bodyMedium"
        style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}
      >
        Timeline tracking for inputs, shaders, and scheduled actions.
        {"\n"}Coming soon.
      </Text>

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
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  toolbar: {
    position: "absolute",
    top: 0,
    right: 0,
  },
  subtitle: {
    textAlign: "center",
    maxWidth: 360,
    lineHeight: 22,
  },
});
