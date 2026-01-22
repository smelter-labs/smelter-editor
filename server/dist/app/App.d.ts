import type { RoomStore } from './store';
import type { StoreApi } from 'zustand';
export default function App({ store }: {
    store: StoreApi<RoomStore>;
}): import("react/jsx-runtime").JSX.Element;
