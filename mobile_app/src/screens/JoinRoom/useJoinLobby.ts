import { useState, useCallback } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { apiService } from "../../services/apiService";
import { wsService } from "../../services/websocketService";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ConnectionStatus } from "../../types/connection";
import type { RootNavigationProp, RootStackParamList } from "../../navigation/navigationTypes";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";

export type CreateRoomStatus = "idle" | "loading" | "error";

export function useJoinLobby() {
  const navigation = useNavigation<RootNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, "JoinLobby">>();
  const { serverUrl } = route.params;

  const { setCredentials, setError, setStatus } = useConnectionStore();

  const [createStatus, setCreateStatus] = useState<CreateRoomStatus>("idle");
  const [createError, setCreateError] = useState<string | null>(null);

  const handleJoinRoom = useCallback(() => {
    navigation.navigate(SCREEN_NAMES.JOIN_ROOM, { serverUrl });
  }, [navigation, serverUrl]);

  const handleCreateRoom = useCallback(async () => {
    setCreateStatus("loading");
    setCreateError(null);
    setStatus(ConnectionStatus.Connecting);

    const { setInputs } = useInputsStore.getState();
    const { setLayers, setResolution, setGridConfig } = useLayoutStore.getState();
    const { setTimelinePlaying } = useConnectionStore.getState();
    const { gridFactor } = useSettingsStore.getState();

    try {
      const roomId = await apiService.createRoom(serverUrl);
      const { inputs, layers, resolution, isTimelinePlaying } =
        await apiService.fetchRoomState(serverUrl, roomId);

      await wsService.connect(serverUrl, roomId);
      setCredentials(serverUrl, roomId);
      setStatus(ConnectionStatus.Connected);

      setInputs(inputs);
      setLayers(layers);
      setResolution(resolution);
      setTimelinePlaying(isTimelinePlaying);
      setGridConfig(
        Math.round(resolution.width / gridFactor),
        Math.round(resolution.height / gridFactor),
      );

      navigation.replace(SCREEN_NAMES.MAIN);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create room";
      setError(message);
      setCreateError(message);
      setCreateStatus("error");
    }
  }, [serverUrl, navigation, setCredentials, setError, setStatus]);

  return {
    serverUrl,
    createStatus,
    createError,
    handleJoinRoom,
    handleCreateRoom,
  };
}
