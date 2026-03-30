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

  export type Grid = { cellsSet: Cell[]; cellsToBeSet: Cell[] };

  export interface GetNewGridProps {
    oldGrid: Grid;
    pickedCellIndex: number;
    targetRow: number;
    targetCol: number;
    rows: number;
    columns: number;
    movePenalty: number;
  }

  export type RenderItemInfo<ItemT> = {
    item: ItemT;
    index: number;
  };

  export interface ReshufflableGridProps<ItemT extends Cell> {
    data: ItemT[];
    renderItem: (info: RenderItemInfo<ItemT>) => React.ReactElement | null;
    renderShadow?: (info: RenderItemInfo<ItemT>) => React.ReactElement | null;
    onDragEnd?: (items: ItemT[]) => void;
    rows: number;
    columns: number;
    style: StyleProp<ViewStyle>;
    gapVertical?: number;
    gapHorizontal?: number;
    allowCollisions?: boolean;
    movePenalty?: number;
    getNewGrid?: (props: GetNewGridProps) => Cell[];
  }

  export const ReshufflableGrid: <ItemT extends Cell>(
    props: ReshufflableGridProps<ItemT>,
  ) => React.ReactElement;
}
