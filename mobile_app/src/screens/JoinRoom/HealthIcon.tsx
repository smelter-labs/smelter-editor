import React from "react";
import { View, StyleSheet } from "react-native";
import { ActivityIndicator, Icon } from "react-native-paper";
import { appColors } from "../../theme/paperTheme";
import type { HealthStatus } from "./useJoinServer";

interface Props {
  status: HealthStatus | undefined;
}

export function HealthIcon({ status }: Props) {
  if (status === "checking") return <ActivityIndicator size={14} />;
  if (status === "ok")
    return <Icon source="check-circle" size={16} color={appColors.success} />;
  if (status === "error")
    return <Icon source="close-circle" size={16} color={appColors.error} />;
  // Reserve space so text doesn't shift when icons appear
  return <View style={styles.placeholder} />;
}

const styles = StyleSheet.create({
  placeholder: { width: 16, height: 16 },
});
