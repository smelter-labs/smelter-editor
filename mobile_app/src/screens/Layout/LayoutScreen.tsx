import React, { useState, useEffect, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "react-native-paper";
import { GestureDetector } from "react-native-gesture-handler";
import { useLayoutStore } from "../../store/layoutStore";
import { useConnectionStore } from "../../store/connectionStore";
import { wsService } from "../../services/websocketService";
import { apiService } from "../../services/apiService";
import { useLayoutGestures } from "./useLayoutGestures";
import { GridWrapper } from "./GridWrapper";
import { GridItemCell } from "./GridItem";
import { LayoutSidePanel } from "./LayoutSidePanel";
import { SettingsPanel } from "./SettingsPanel";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
import type { GridItem } from "../../types/layout";

export function LayoutScreen() {
  const theme = useTheme();
  const { layers, setLayers } = useLayoutStore();
  const { serverUrl, roomId } = useConnectionStore();

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsPanelSide, setSettingsPanelSide] = useState<"left" | "right">(
    "right",
  );

  // Subscribe to server input and room updates
  useEffect(() => {
    const unsubInput = wsService.on("input_updated", (event) => {
      console.log("[Layout] input_updated:", event.inputId);
    });
    const unsubRoom = wsService.on("room_updated", async () => {
      try {
        const { layers: updatedLayers } = await apiService.fetchRoomState(serverUrl, roomId);
        setLayers(updatedLayers);
      } catch (err) {
        console.warn("[Layout] Failed to refresh layers on room_updated:", err);
      }
    });
    return () => {
      unsubInput();
      unsubRoom();
    };
  }, [serverUrl, roomId, setLayers]);

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
    (_newItems: GridItem[]) => {
      // Layer-based layout changes will be wired when layer UI is added
    },
    [],
  );

  return (
    <GestureDetector gesture={edgeSwipeGesture}>
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <ScreenLabel label={`Layout (${layers.length} layers)`} />
        <GridWrapper
          items={[]}
          columns={4}
          rows={3}
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
