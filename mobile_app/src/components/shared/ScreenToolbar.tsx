import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";
import { MaterialDesignIcons } from "@react-native-vector-icons/material-design-icons";
import { appColors } from "../../theme/paperTheme";

interface ScreenToolbarProps {
  children: React.ReactNode;
  style?: React.ComponentProps<typeof View>["style"];
}

interface ScreenToolbarChipProps {
  children: React.ReactNode;
  onPress?: () => void;
  style?: React.ComponentProps<typeof Chip>["style"];
}

interface ToolbarIconProps {
  name: React.ComponentProps<typeof MaterialDesignIcons>["name"];
}

export function ScreenToolbar({ children, style }: ScreenToolbarProps) {
  return <View style={[styles.toolbar, style]}>{children}</View>;
}

export function ScreenToolbarChip({
  children,
  onPress,
  style,
}: ScreenToolbarChipProps) {
  return (
    <Chip
      compact
      mode="flat"
      style={[styles.chip, style]}
      textStyle={styles.chipText}
      onPress={onPress}
    >
      {children}
    </Chip>
  );
}

export function ToolbarIcon({ name }: ToolbarIconProps) {
  return (
    <MaterialDesignIcons name={name} color={appColors.toolbarIcon} size={16} />
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    minHeight: 36,
    paddingHorizontal: 8,
    gap: 8,
  },
  chip: {
    borderRadius: 8,
    backgroundColor: appColors.toolbarSurface,
  },
  chipText: {
    color: appColors.toolbarText,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
