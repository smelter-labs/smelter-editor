import React, { useCallback, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import MaterialDesignIcons from "@react-native-vector-icons/material-design-icons";

const C = {
  layerBg: "#2D2D2D",
  text: "#CCCCCC",
  textDim: "#777777",
  accent: "#4D9DE0",
};

function EditableName({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const lastTapRef = useRef(0);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed) onChange(trimmed);
    else setDraft(value);
  }, [draft, value, onChange]);

  const handlePress = useCallback(() => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) {
      setDraft(value);
      setEditing(true);
    }
    lastTapRef.current = now;
  }, [value]);

  if (editing) {
    return (
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={commit}
        onSubmitEditing={commit}
        autoFocus
        selectTextOnFocus
        style={styles.editInput}
      />
    );
  }

  return (
    <Pressable onPress={handlePress} style={styles.nameHitArea}>
      <Text style={styles.layerName} numberOfLines={1}>
        {value}
      </Text>
    </Pressable>
  );
}

export interface LayerHeaderProps {
  name: string;
  isVisible: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onToggleVisible: () => void;
  onNameChange: (name: string) => void;
}

export function LayerHeader({
  name,
  isVisible,
  isCollapsed,
  onToggleCollapse,
  onToggleVisible,
  onNameChange,
}: LayerHeaderProps) {
  return (
    <Pressable onPress={onToggleCollapse} style={styles.header}>
      <Pressable onPress={onToggleVisible} hitSlop={8} style={styles.eyeBtn}>
        <MaterialDesignIcons
          name={isVisible ? "eye-outline" : "eye-closed"}
          color={isVisible ? C.text : C.textDim}
          size={16}
        />
      </Pressable>

      <EditableName value={name} onChange={onNameChange} />

      <View style={styles.collapseBtn} pointerEvents="none">
        <MaterialDesignIcons
          name={isCollapsed ? "chevron-right" : "chevron-down"}
          color={C.text}
          size={16}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    height: 38,
    paddingHorizontal: 8,
    backgroundColor: C.layerBg,
    gap: 6,
  },
  eyeBtn: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  layerName: {
    color: C.text,
    fontSize: 12,
    fontWeight: "600",
  },
  nameHitArea: { flex: 1, justifyContent: "center" },
  collapseBtn: {
    width: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  collapseIcon: { color: C.textDim, fontSize: 11 },
  editInput: {
    flex: 1,
    padding: 0,
    margin: 0,
    color: C.text,
    fontSize: 12,
    fontWeight: "600",
    borderBottomWidth: 1,
    borderBottomColor: C.accent,
  },
});
