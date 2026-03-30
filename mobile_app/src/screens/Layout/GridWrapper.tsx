import React, { useState } from "react";
import { View, LayoutChangeEvent } from "react-native";
import type { GridItem } from "../../types/layout";

interface GridWrapperProps {
  items: GridItem[];
  columns: number;
  rows: number;
  onLayoutChange: (items: GridItem[]) => void;
  renderItem: (item: GridItem) => React.ReactNode;
}

export function GridWrapper({
  items,
  columns,
  rows,
  renderItem,
}: GridWrapperProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize({ width, height });
  };

  const cellW = size.width / columns;
  const cellH = size.height / rows;

  return (
    <View style={{ flex: 1 }} onLayout={onLayout}>
      {size.width > 0 &&
        items.map((item) => (
          <View
            key={item.id}
            style={{
              position: "absolute",
              left: item.x * cellW,
              top: item.y * cellH,
              width: item.w * cellW,
              height: item.h * cellH,
              padding: 4,
            }}
          >
            {renderItem(item)}
          </View>
        ))}
    </View>
  );
}
