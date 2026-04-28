import React, { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chip, Text, useTheme } from "react-native-paper";
import { useNavigation } from "@react-navigation/native";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import { SharedSettingsPanel } from "../../components/shared/SharedSettingsPanel";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";
import type { RootNavigationProp } from "../../navigation/navigationTypes";

/**
 * Timeline screen — placeholder only.
 * Will display input on/off timeline, shader schedule, and future actions.
 */
export function TimelineScreen() {
  const theme = useTheme();
  const navigation = useNavigation<RootNavigationProp>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.colors.background }]}
    >
      <ScreenLabel label="Timeline" />

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
    flexDirection: "row",
    alignItems: "center",
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
  subtitle: {
    textAlign: "center",
    maxWidth: 360,
    lineHeight: 22,
  },
});
