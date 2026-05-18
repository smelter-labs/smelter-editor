import React, { useState, useMemo } from "react";
import { Modal, SafeAreaView, StyleSheet, View } from "react-native";
import {
  Chip,
  Divider,
  IconButton,
  List,
  Searchbar,
  Surface,
  Text,
  useTheme,
} from "react-native-paper";
import { FlatList } from "react-native";

type Input = {
  inputId: string;
  title: string;
  type: "audio" | "video";
};

type Layer = {
  id: string;
  inputs: unknown[];
};

interface BroadcastTileAdderProps {
  isOpen: boolean;
  inputs: Input[];
  layers: Layer[];
  existingTileTargets: Set<string>;
  onAddTile: (type: "input" | "layer", targetId: string) => void;
  onClose: () => void;
}

export function BroadcastTileAdder({
  isOpen,
  inputs,
  layers,
  existingTileTargets,
  onAddTile,
  onClose,
}: BroadcastTileAdderProps) {
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<"inputs" | "layers">("inputs");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredInputs = useMemo(
    () =>
      inputs.filter(
        (input) =>
          !existingTileTargets.has(`input-${input.inputId}`) &&
          input.title.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [inputs, searchQuery, existingTileTargets],
  );

  const filteredLayers = useMemo(
    () =>
      layers.filter(
        (layer) =>
          !existingTileTargets.has(`layer-${layer.id}`) &&
          layer.id.toLowerCase().includes(searchQuery.toLowerCase()),
      ),
    [layers, searchQuery, existingTileTargets],
  );

  const currentData =
    activeTab === "inputs"
      ? (filteredInputs as (Input | Layer)[])
      : (filteredLayers as (Input | Layer)[]);

  const renderInputItem = ({ item }: { item: Input | Layer }) => {
    const input = item as Input;
    return (
      <List.Item
        title={input.title}
        description={input.type}
        left={(props) => <List.Icon {...props} icon="video" />}
        onPress={() => onAddTile("input", input.inputId)}
        titleStyle={{ color: theme.colors.onSurface }}
        descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
      />
    );
  };

  const renderLayerItem = ({ item }: { item: Input | Layer }) => {
    const layer = item as Layer;
    return (
      <List.Item
        title={layer.id}
        description={`${layer.inputs.length} input${layer.inputs.length !== 1 ? "s" : ""}`}
        left={(props) => <List.Icon {...props} icon="layers" />}
        onPress={() => onAddTile("layer", layer.id)}
        titleStyle={{ color: theme.colors.onSurface }}
        descriptionStyle={{ color: theme.colors.onSurfaceVariant }}
      />
    );
  };

  return (
    <Modal
      visible={isOpen}
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}
    >
      <SafeAreaView
        style={[styles.container, { backgroundColor: theme.colors.background }]}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text variant="titleLarge" style={{ color: theme.colors.onSurface }}>
            Add Broadcast Tile
          </Text>
          <IconButton
            icon="close"
            size={24}
            onPress={onClose}
            iconColor={theme.colors.onSurfaceVariant}
          />
        </View>

        <Divider />

        {/* Tabs */}
        <View style={styles.tabRow}>
          <Chip
            selected={activeTab === "inputs"}
            onPress={() => setActiveTab("inputs")}
            style={styles.tabChip}
            showSelectedOverlay
          >
            Inputs
          </Chip>
          <Chip
            selected={activeTab === "layers"}
            onPress={() => setActiveTab("layers")}
            style={styles.tabChip}
            showSelectedOverlay
          >
            Layers
          </Chip>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <Searchbar
            placeholder={`Search ${activeTab}…`}
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={[
              styles.searchBar,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
            inputStyle={{ color: theme.colors.onSurface }}
            iconColor={theme.colors.onSurfaceVariant}
            placeholderTextColor={theme.colors.onSurfaceVariant}
          />
        </View>

        <Divider />

        {/* List */}
        {currentData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text
              variant="bodyLarge"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              No {activeTab} available
            </Text>
          </View>
        ) : (
          <Surface style={styles.listSurface} elevation={0}>
            <FlatList
              data={currentData}
              renderItem={
                activeTab === "inputs"
                  ? (renderInputItem as (info: {
                      item: Input | Layer;
                    }) => React.ReactElement)
                  : (renderLayerItem as (info: {
                      item: Input | Layer;
                    }) => React.ReactElement)
              }
              keyExtractor={(item) =>
                activeTab === "inputs"
                  ? (item as Input).inputId
                  : (item as Layer).id
              }
              ItemSeparatorComponent={() => <Divider />}
            />
          </Surface>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  tabRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  tabChip: { flex: 1 },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  searchBar: {
    height: 44,
    borderRadius: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listSurface: { flex: 1 },
});
