import React from "react";
import { StyleSheet, View } from "react-native";
import { Chip } from "react-native-paper";
import type { LayerBehaviorConfig } from "../../../types/layout";

const C = {
  layerBg: "#2D2D2D",
  layerBorder: "#3A3A3A",
  itemBg: "#262626",
  textDim: "#777777",
  accent: "#4D9DE0",
};

const BEHAVIOR_OPTIONS: {
  label: string;
  type: LayerBehaviorConfig["type"] | "manual";
}[] = [
  { label: "Equal Grid", type: "equal-grid" },
  { label: "≈ Aspect Grid", type: "approximate-aspect-grid" },
  { label: "Exact Aspect", type: "exact-aspect-grid" },
  { label: "PiP", type: "picture-in-picture" },
  { label: "Manual", type: "manual" },
];

export interface BehaviorSelectorProps {
  behavior: LayerBehaviorConfig | undefined;
  onChange: (b: LayerBehaviorConfig | undefined) => void;
}

export function BehaviorSelector({
  behavior,
  onChange,
}: BehaviorSelectorProps) {
  const current = behavior?.type ?? "manual";
  return (
    <View style={styles.behaviorRow}>
      {BEHAVIOR_OPTIONS.map((opt) => {
        const active = current === opt.type;
        return (
          <Chip
            key={opt.type}
            compact
            mode={active ? "flat" : "outlined"}
            selected={active}
            showSelectedCheck={false}
            style={[styles.behaviorChip, active && styles.behaviorChipActive]}
            textStyle={[
              styles.behaviorChipText,
              active && styles.behaviorChipTextActive,
            ]}
            onPress={() => {
              if (opt.type === "manual") onChange(undefined);
              else if (opt.type !== current)
                onChange({ type: opt.type } as LayerBehaviorConfig);
            }}
          >
            {opt.label}
          </Chip>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  behaviorRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: C.layerBg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.layerBorder,
  },
  behaviorChip: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.layerBorder,
    backgroundColor: C.itemBg,
  },
  behaviorChipActive: {
    borderColor: C.accent,
    backgroundColor: "rgba(77, 157, 224, 0.15)",
  },
  behaviorChipText: {
    color: C.textDim,
    fontSize: 10,
    fontWeight: "500",
  },
  behaviorChipTextActive: {
    color: C.accent,
  },
});
