import React from "react";
import { View, StyleSheet } from "react-native";
import { Text, useTheme } from "react-native-paper";

interface ErrorMessageProps {
  message: string | null;
}

export function ErrorMessage({ message }: ErrorMessageProps) {
  const theme = useTheme();
  if (!message) return null;

  return (
    <View style={styles.container}>
      <Text variant="bodySmall" style={{ color: theme.colors.error }}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 4,
    paddingHorizontal: 4,
  },
});
