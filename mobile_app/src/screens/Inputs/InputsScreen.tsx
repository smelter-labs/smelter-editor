import React, { useState, useEffect, useCallback, useRef } from "react";
import type { WSEventPayload } from "../../types/websocket";
import { View, StyleSheet } from "react-native";
import { useTheme } from "react-native-paper";
import DraggableFlatList, {
  RenderItemParams,
} from "react-native-draggable-flatlist";
import { GestureDetector } from "react-native-gesture-handler";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useConnectionStore } from "../../store/connectionStore";
import { wsService } from "../../services/websocketService";
import { apiService } from "../../services/apiService";
import type { InputCard as InputCardType } from "../../types/input";
import { getGridDimensions } from "../../utils/gridUtils";
import { useInputsGestures } from "./useInputsGestures";
import { InputCard } from "./InputCard";
import { InputSidePanel } from "./InputSidePanel";
import { InputsSettingsPanel } from "./InputsSettingsPanel";
import { ScreenLabel } from "../../components/shared/ScreenLabel";
<<<<<<< @Frendzlu/reduce-rerenders-mobile
import { areInputCardsEquivalent } from "../../utils/inputCardEquality";
=======

const ROOM_UPDATE_COALESCE_MS = 150;
>>>>>>> @Frendzlu/mobile-ui-fixes

export function InputsScreen() {
  const theme = useTheme();
  const {
    inputs,
    gridColumns,
    setInputs,
    updateInput,
    removeInput,
    reorderInputs,
  } = useInputsStore();
  const setLayers = useLayoutStore((state) => state.setLayers);
  const { serverUrl, roomId } = useConnectionStore();

  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedCardIndex, setSelectedCardIndex] = useState(0);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false);
  const [settingsPanelSide, setSettingsPanelSide] = useState<"left" | "right">(
    "right",
  );

  // Log data on mount
  useEffect(() => {
    if (__DEV__) {
      console.log("[InputsScreen] Mounted with data:", {
        inputs,
        gridColumns,
      });
    }
  }, []);

  // Hold latest room_updated payload and apply at most once per animation frame.
  const pendingEventRef = useRef<WSEventPayload<"room_updated"> | null>(null);
  const frameRef = useRef<number | null>(null);

  // Subscribe to server input updates
  useEffect(() => {
    const unsubUpdated = wsService.on("input_updated", (event) => {
      const changes = apiService.mapInputUpdateToCardChanges(event.input);
      updateInput(event.inputId, changes);
    });
    const unsubDeleted = wsService.on("input_deleted", (event) => {
      removeInput(event.inputId);
    });
    const unsubRoom = wsService.on("room_updated", (event) => {
      pendingEventRef.current = event;
      if (frameRef.current !== null) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        const latest = pendingEventRef.current;
        pendingEventRef.current = null;
        if (!latest) return;

        setLayers(latest.layers);

        const nextInputs = apiService.mapInputsToCards(latest.inputs);
        const currentInputs = useInputsStore.getState().inputs;
        if (!areInputCardsEquivalent(currentInputs, nextInputs)) {
          setInputs(nextInputs);
        }
      });
    });
    return () => {
      unsubUpdated();
      unsubDeleted();
      unsubRoom();
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [serverUrl, roomId, updateInput, removeInput, setInputs, setLayers]);

  const handleCardTap = useCallback(
    (cardId: string) => {
      const index = inputs.findIndex((i) => i.id === cardId);
      setSelectedCardId(cardId);
      setSelectedCardIndex(index >= 0 ? index : 0);
      setDetailPanelOpen(true);
    },
    [inputs],
  );

  const handleEdgeSwipe = useCallback((side: "left" | "right") => {
    setSettingsPanelSide(side);
    setSettingsPanelOpen(true);
  }, []);

  const { edgeSwipeGesture, makeCardTapGesture } = useInputsGestures({
    onCardTap: handleCardTap,
    onEdgeSwipe: handleEdgeSwipe,
  });

  const handleDragEnd = useCallback(
    ({ data }: { data: InputCardType[] }) => {
      reorderInputs(data.map((item) => item.id));
    },
    [reorderInputs],
  );

  const { columns } = getGridDimensions(inputs.length);
  const effectiveColumns = gridColumns || columns;

  const renderItem = useCallback(
    ({ item, drag, isActive }: RenderItemParams<InputCardType>) => (
      <View
        style={[
          { width: `${100 / effectiveColumns}%` },
          isActive && styles.activeItem,
        ]}
      >
        <InputCard input={item} tapGesture={makeCardTapGesture(item.id)} />
      </View>
    ),
    [effectiveColumns, makeCardTapGesture],
  );

  return (
    <GestureDetector gesture={edgeSwipeGesture}>
      <View
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        <ScreenLabel label="Inputs" />
        <DraggableFlatList
          data={inputs}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onDragEnd={handleDragEnd}
          numColumns={effectiveColumns}
          contentContainerStyle={styles.listContent}
          activationDistance={10}
        />

        <InputSidePanel
          isVisible={detailPanelOpen}
          cardId={selectedCardId}
          cardIndex={selectedCardIndex}
          totalColumns={effectiveColumns}
          onClose={() => setDetailPanelOpen(false)}
        />

        <InputsSettingsPanel
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
  listContent: {
    padding: 6,
  },
  activeItem: {
    opacity: 0.85,
    transform: [{ scale: 1.02 }],
  },
});
