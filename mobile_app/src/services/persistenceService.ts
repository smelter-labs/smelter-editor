import AsyncStorage from "@react-native-async-storage/async-storage";

const CONNECTION_KEY = "smelter:connection";

interface SavedConnectionData {
  serverUrl: string;
  roomId: string;
}

export const persistenceService = {
  async saveConnectionData(data: SavedConnectionData): Promise<void> {
    await AsyncStorage.setItem(CONNECTION_KEY, JSON.stringify(data));
  },

  async loadConnectionData(): Promise<SavedConnectionData | null> {
    const raw = await AsyncStorage.getItem(CONNECTION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SavedConnectionData;
    } catch {
      return null;
    }
  },

  async clearConnectionData(): Promise<void> {
    await AsyncStorage.removeItem(CONNECTION_KEY);
  },
};
