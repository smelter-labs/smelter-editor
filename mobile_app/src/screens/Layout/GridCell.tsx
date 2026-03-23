import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { LayerItemProps } from "./dnd/types";

export default function GridCell({ name, color, isVisible }: LayerItemProps) {
  return (
    <View style={[styles.cell, { backgroundColor: color, opacity: isVisible ? 1 : 0.5 }]}>
      <Text style={styles.cellText} numberOfLines={1}>
        {name}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: {
    flex: 1,
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  cellText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
});
