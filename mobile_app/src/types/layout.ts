export interface GridItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

export interface GridLayout {
  items: GridItem[];
  columns: number;
  rows: number;
}

export interface LayoutSyncPayload {
  items: GridItem[];
}
