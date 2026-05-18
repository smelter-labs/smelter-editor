import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  SafeAreaView,
  FlatList,
  Pressable,
  TextInput,
  ScrollView,
} from "react-native";
import type { BroadcastTile } from "@smelter-editor/types";

type Input = {
  inputId: string;
  title: string;
  type: string;
};

type Layer = {
  id: string;
  inputs: any[];
};

interface BroadcastTileAdderProps {
  isOpen: boolean;
  inputs: Input[];
  layers: Layer[];
  existingTileTargets: Set<string>;
  onAddTile: (type: "input" | "layer", targetId: string) => void;
  onClose: () => void;
}

export default function BroadcastTileAdder({
  isOpen,
  inputs,
  layers,
  existingTileTargets,
  onAddTile,
  onClose,
}: BroadcastTileAdderProps) {
  const [activeTab, setActiveTab] = useState<"inputs" | "layers">("inputs");
  const [searchInput, setSearchInput] = useState("");

  // Filter inputs
  const filteredInputs = useMemo(
    () =>
      inputs.filter(
        (input) =>
          !existingTileTargets.has(`input-${input.inputId}`) &&
          input.title.toLowerCase().includes(searchInput.toLowerCase()),
      ),
    [inputs, searchInput, existingTileTargets],
  );

  // Filter layers
  const filteredLayers = useMemo(
    () =>
      layers.filter(
        (layer) =>
          !existingTileTargets.has(`layer-${layer.id}`) &&
          layer.id.toLowerCase().includes(searchInput.toLowerCase()),
      ),
    [layers, searchInput, existingTileTargets],
  );

  const renderInputItem = ({ item }: { item: Input }) => (
    <Pressable
      style={styles.itemContainer}
      onPress={() => onAddTile("input", item.inputId)}
    >
      <View style={styles.itemContent}>
        <Text style={styles.itemIcon}>🎬</Text>
        <View style={styles.itemTextContainer}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.itemSubtitle}>{item.type}</Text>
        </View>
      </View>
      <Text style={styles.itemCheckmark}>✓</Text>
    </Pressable>
  );

  const renderLayerItem = ({ item }: { item: Layer }) => (
    <Pressable
      style={styles.itemContainer}
      onPress={() => onAddTile("layer", item.id)}
    >
      <View style={styles.itemContent}>
        <Text style={styles.itemIcon}>🎞️</Text>
        <View style={styles.itemTextContainer}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {item.id}
          </Text>
          <Text style={styles.itemSubtitle}>
            {item.inputs.length} input{item.inputs.length !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>
      <Text style={styles.itemCheckmark}>✓</Text>
    </Pressable>
  );

  const currentData = activeTab === "inputs" ? filteredInputs : filteredLayers;

  return (
    <Modal visible={isOpen} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Add Broadcast Tile</Text>
          <Pressable onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </Pressable>
        </View>

        {/* Tabs */}
        <View style={styles.tabContainer}>
          <Pressable
            style={[styles.tab, activeTab === "inputs" && styles.tabActive]}
            onPress={() => setActiveTab("inputs")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "inputs" && styles.tabTextActive,
              ]}
            >
              Inputs
            </Text>
          </Pressable>
          <Pressable
            style={[styles.tab, activeTab === "layers" && styles.tabActive]}
            onPress={() => setActiveTab("layers")}
          >
            <Text
              style={[
                styles.tabText,
                activeTab === "layers" && styles.tabTextActive,
              ]}
            >
              Layers
            </Text>
          </Pressable>
        </View>

        {/* Search */}
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.searchInput}
            placeholder={`Search ${activeTab}...`}
            placeholderTextColor="#999"
            value={searchInput}
            onChangeText={setSearchInput}
          />
        </View>

        {/* List */}
        {currentData.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No {activeTab} available</Text>
          </View>
        ) : (
          <FlatList
            data={currentData as unknown as (Input | Layer)[]}
            renderItem={
              activeTab === "inputs"
                ? (renderInputItem as any)
                : (renderLayerItem as any)
            }
            keyExtractor={(item) =>
              activeTab === "inputs"
                ? (item as Input).inputId
                : (item as Layer).id
            }
            scrollEnabled
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#fff",
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 24,
    color: "#999",
  },
  tabContainer: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#0066ff",
  },
  tabText: {
    fontSize: 14,
    color: "#999",
    fontWeight: "500",
  },
  tabTextActive: {
    color: "#0066ff",
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  searchInput: {
    height: 40,
    backgroundColor: "#1a1a1a",
    borderRadius: 4,
    paddingHorizontal: 12,
    color: "#fff",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#333",
  },
  emptyContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 16,
    color: "#999",
  },
  itemContainer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  itemContent: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: 12,
  },
  itemIcon: {
    fontSize: 16,
  },
  itemTextContainer: {
    flex: 1,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#fff",
  },
  itemSubtitle: {
    fontSize: 12,
    color: "#999",
    marginTop: 2,
  },
  itemCheckmark: {
    fontSize: 16,
    color: "#0066ff",
    marginLeft: 8,
  },
});
