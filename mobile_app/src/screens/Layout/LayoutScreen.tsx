import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "react-native-paper";
import { GestureDetector } from "react-native-gesture-handler";
import { useLayoutStore } from "../../store/layoutStore";
import { wsService } from "../../services/websocketService";
import type { GridItem } from "../../types/layout";
import { useLayoutGestures } from "./useLayoutGestures";
import { GridWrapper } from "./GridWrapper";
import { GridItemCell } from "./GridItem";
import { LayoutSidePanel } from "./LayoutSidePanel";
import { SettingsPanel } from "./SettingsPanel";
import { ScreenLabel } from "../../components/shared/ScreenLabel";

export function LayoutScreen() {
  const theme = useTheme();
  const { items, columns, rows, setItems } = useLayoutStore();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsPanelSide, setSettingsPanelSide] = useState<"left" | "right">(
    "right",
  );

  // Log data on mount
  useEffect(() => {
    console.log("[LayoutScreen] Mounted with data:", {
      items,
      columns,
      rows,
    });
  }, []);

  // Subscribe to server input updates
  useEffect(() => {
    const unsub = wsService.on("input_updated", (event) => {
      console.log("[Layout] input_updated:", event.inputId);
    });
    return unsub;
  }, []);

  const handleItemTap = useCallback((itemId: string) => {
    setSelectedItemId(itemId);
    setSidePanelOpen(true);
  }, []);

  const handleEdgeSwipe = useCallback((side: "left" | "right") => {
    setSettingsPanelSide(side);
    setSettingsPanelOpen(true);
  }, []);

  const { edgeSwipeGesture, makeItemTapGesture } = useLayoutGestures({
    onItemTap: handleItemTap,
    onEdgeSwipe: handleEdgeSwipe,
  });

  const handleLayoutChange = useCallback(
    (newItems: GridItem[]) => {
      setItems(newItems);
    },
    [setItems],
  );

  return (
    <GestureDetector gesture={edgeSwipeGesture}>
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <ScreenLabel label="Layout" />
        <GridWrapper
          items={items}
          columns={columns}
          rows={rows}
          onLayoutChange={handleLayoutChange}
          renderItem={(item) => (
            <GridItemCell
              key={item.id}
              item={item}
              tapGesture={makeItemTapGesture(item.id)}
            />
          )}
        />

        <LayoutSidePanel
          isVisible={sidePanelOpen}
          itemId={selectedItemId}
          onClose={() => setSidePanelOpen(false)}
        />

        <SettingsPanel
          isVisible={settingsPanelOpen}
          side={settingsPanelSide}
          onClose={() => setSettingsPanelOpen(false)}
        />
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
