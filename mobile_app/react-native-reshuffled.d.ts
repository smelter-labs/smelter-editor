declare module "react-native-reshuffled" {
  import React from "react";
  import { StyleProp, ViewStyle } from "react-native";

  export type Cell = {
    id: string;
    color: string;
    height: number;
    width: number;
    startRow: number;
    startColumn: number;
  };

  export type RenderItemInfo<ItemT> = {
    item: ItemT;
    index: number;
  };

  export interface ReshufflableGridProps<ItemT extends Cell> {
    data: ItemT[];
    onItemsChange?: (items: ItemT[]) => void;
    renderItem: (info: RenderItemInfo<ItemT>) => React.ReactElement | null;
    renderShadow?: (info: RenderItemInfo<ItemT>) => React.ReactElement | null;
    rows: number;
    columns: number;
    style: StyleProp<ViewStyle>;
    gapVertical?: number;
    gapHorizontal?: number;
    movePenalty?: number;
  }

  export const ReshufflableGrid: <ItemT extends Cell>(
    props: ReshufflableGridProps<ItemT>,
  ) => React.ReactElement;
}
