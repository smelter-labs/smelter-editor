import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ConnectionStatus, type ConnectedPeer } from "../types/connection";

interface ConnectionState {
  serverUrl: string;
  roomId: string;
  token: string | null;
  status: ConnectionStatus;
  error: string | null;
  clientId: string | null;
  peers: ConnectedPeer[];

  setCredentials: (serverUrl: string, roomId: string) => void;
  setToken: (token: string) => void;
  setError: (error: string | null) => void;
  setStatus: (status: ConnectionStatus) => void;
  setClientId: (clientId: string) => void;
  setPeers: (peers: ConnectedPeer[]) => void;
  reset: () => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      serverUrl: "",
      roomId: "",
      token: null,
      status: ConnectionStatus.Idle,
      error: null,
      clientId: null,
      peers: [],

      setCredentials: (serverUrl, roomId) => set({ serverUrl, roomId }),
      setToken: (token) =>
        set({ token, status: ConnectionStatus.Connected, error: null }),
      setError: (error) => set({ error, status: ConnectionStatus.Failed }),
      setStatus: (status) => set({ status }),
      setClientId: (clientId) =>
        set((state) => {
          if (
            state.clientId === clientId &&
            state.status === ConnectionStatus.Connected &&
            state.error === null
          ) {
            return state;
          }
          return { clientId, status: ConnectionStatus.Connected, error: null };
        }),
      setPeers: (peers) =>
        set((state) => {
          const unchanged =
            state.peers.length === peers.length &&
            state.peers.every(
              (peer, index) =>
                peer.clientId === peers[index]?.clientId &&
                peer.name === peers[index]?.name,
            );

          if (unchanged) {
            return state;
          }

          return { peers };
        }),
      reset: () =>
        set({
          token: null,
          status: ConnectionStatus.Idle,
          error: null,
          clientId: null,
          peers: [],
        }),
    }),
    {
      name: "connection-storage",
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist credentials, not transient state
      partialize: (state) => ({
        serverUrl: state.serverUrl,
        roomId: state.roomId,
      }),
    },
  ),
);
