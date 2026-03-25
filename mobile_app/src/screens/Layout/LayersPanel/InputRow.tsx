import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Draggable, Droppable } from "react-native-reanimated-dnd";
import type { InputCard } from "../../../types/input";
import type { DragData, InputDragData, LayerDragData } from "./LayerRow";

const C = {
  itemBg: "#262626",
  layerBorder: "#3A3A3A",
  text: "#CCCCCC",
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
  dimmed: boolean;
  onDrop: (data: InputDragData) => void;
  onLayerDrop: (data: LayerDragData) => void;
}

export function InputRow({
  inputId,
  sourceLayerId,
  inputs,
  dimmed,
  onDrop,
  onLayerDrop,
}: InputRowProps) {
  const input = inputs.find((i) => i.id === inputId);
  const name = input?.name ?? inputId;
  const color = colorFromId(inputId);

  return (
    <Droppable<DragData>
      style={styles.dropZone}
      activeStyle={styles.dropZoneActive}
      onDrop={(data) => {
        if (data.type === "input") onDrop(data);
        else if (data.type === "layer") onLayerDrop(data);
      }}
    >
      <Draggable<InputDragData>
        data={{ type: "input", inputId, sourceLayerId }}
        dragAxis="y"
        preDragDelay={140}
        collisionAlgorithm="center"
      >
        <View style={[styles.row, dimmed && styles.rowDimmed]}>
          <View style={[styles.swatch, { backgroundColor: color }]} />
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
        </View>
      </Draggable>
    </Droppable>
  );
}

const styles = StyleSheet.create({
  dropZone: {
    backgroundColor: C.itemBg,
    borderTopWidth: 2,
    borderTopColor: "transparent",
  },
  dropZoneActive: {
    borderTopColor: C.accent,
    backgroundColor: "rgba(77, 157, 224, 0.06)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    height: 36,
    paddingLeft: 36,
    paddingRight: 10,
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
});
