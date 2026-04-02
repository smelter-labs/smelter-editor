import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Badge, Menu, IconButton } from "react-native-paper";
import type { InputCard } from "../../../types/input";
import type { Layer } from "../../../types/layout";

const C = {
  itemBg: "#262626",
  layerBorder: "#3A3A3A",
  text: "#CCCCCC",
  textDim: "#777777",
  accent: "#4D9DE0",
};

function colorFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(hash, 31) + id.charCodeAt(i)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 55%, 45%)`;
}

export interface InputRowProps {
  inputId: string;
  sourceLayerId: string;
  inputs: InputCard[];
  layers: Layer[];
  dimmed: boolean;
  onMoveToLayer: (
    inputId: string,
    fromLayerId: string,
    toLayerId: string,
  ) => void;
}

export function InputRow({
  inputId,
  sourceLayerId,
  inputs,
  layers,
  dimmed,
  onMoveToLayer,
}: InputRowProps) {
  const [menuVisible, setMenuVisible] = useState(false);
  const input = inputs.find((i) => i.id === inputId);
  const name = input?.name ?? inputId;
  const color = colorFromId(inputId);
  const effectsCount = input?.shaders?.length ?? 0;

  return (
    <View style={[styles.row, dimmed && styles.rowDimmed]}>
      <View style={[styles.swatch, { backgroundColor: color }]} />
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      {effectsCount > 0 && (
        <Badge style={styles.effectsBadge}>{effectsCount}</Badge>
      )}

      {/* Menu to move input to another layer */}
      <Menu
        visible={menuVisible}
        onDismiss={() => setMenuVisible(false)}
        anchor={
          <IconButton
            icon="dots-vertical"
            size={16}
            iconColor={C.textDim}
            onPress={() => setMenuVisible(true)}
            style={styles.menuButton}
          />
        }
      >
        {layers.map((layer) =>
          layer.id !== sourceLayerId ? (
            <Menu.Item
              key={layer.id}
              onPress={() => {
                onMoveToLayer(inputId, sourceLayerId, layer.id);
                setMenuVisible(false);
              }}
              title={`Layer ${layers.indexOf(layer) + 1}`}
            />
          ) : null,
        )}
      </Menu>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    paddingLeft: 12,
    paddingRight: 4,
    backgroundColor: C.itemBg,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: C.layerBorder,
  },
  rowDimmed: { opacity: 0.4 },
  swatch: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.15)",
  },
  name: {
    color: C.text,
    fontSize: 12,
    flex: 1,
  },
  effectsBadge: {
    backgroundColor: "rgba(77, 157, 224, 0.9)",
  },
  menuButton: {
    margin: 0,
    padding: 0,
  },
});
