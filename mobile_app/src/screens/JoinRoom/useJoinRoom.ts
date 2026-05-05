import { useState, useCallback, useEffect } from "react";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { wsService } from "../../services/websocketService";
import { apiService, type ActiveRoom } from "../../services/apiService";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ConnectionStatus } from "../../types/connection";
import { ConnectionData } from "../../utils/connectionUtils";
import type {
  RootNavigationProp,
  RootStackParamList,
} from "../../navigation/navigationTypes";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";

interface FormErrors {
  roomId?: string;
  general?: string;
}

export function useJoinRoom() {
  const navigation = useNavigation<RootNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, "JoinRoom">>();
  const { serverUrl, initialRoomId } = route.params;

  const { setCredentials, setError, setStatus } = useConnectionStore();

  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState(initialRoomId ?? "");
  const [isPrivateRoom, setIsPrivateRoom] = useState(!!initialRoomId);
  const [privateRoomId, setPrivateRoomId] = useState(initialRoomId ?? "");

  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Fetch rooms on mount and poll every 3 s
  useEffect(() => {
    async function fetchRooms() {
      try {
        const result = await apiService.fetchActiveRooms(serverUrl);
        const deduped = result.filter(
          (room, i, arr) =>
            arr.findIndex((c) => c.roomId === room.roomId) === i,
        );
        setRooms(deduped);
      } catch {
        // Silently ignore — user can still type a room ID manually
      }
    }

    void fetchRooms();
    const id = setInterval(() => void fetchRooms(), 3000);
    return () => clearInterval(id);
  }, [serverUrl]);

  const togglePrivateRoom = useCallback(() => {
    setIsPrivateRoom((v) => !v);
    setErrors({});
  }, []);

  const handleConnectAsCamera = useCallback(() => {
    const trimmedRoomId = (
      isPrivateRoom ? privateRoomId : selectedRoomId
    ).trim();

    const newErrors: FormErrors = {};
    if (!trimmedRoomId) newErrors.roomId = "Room ID is required";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    navigation.navigate(SCREEN_NAMES.CAMERA, {
      serverUrl,
      roomId: trimmedRoomId,
    });
  }, [serverUrl, selectedRoomId, isPrivateRoom, privateRoomId, navigation]);

  const handleConnect = useCallback(async () => {
    const trimmedRoomId = (
      isPrivateRoom ? privateRoomId : selectedRoomId
    ).trim();

    const newErrors: FormErrors = {};
    if (!trimmedRoomId) newErrors.roomId = "Room ID is required";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    setIsLoading(true);
    setStatus(ConnectionStatus.Connecting);

    const { setInputs } = useInputsStore.getState();
    const { setLayers, setResolution, setGridConfig } =
      useLayoutStore.getState();
    const { setTimelinePlaying } = useConnectionStore.getState();

    try {
      const { inputs, layers, resolution, isTimelinePlaying } =
        await apiService.fetchRoomState(serverUrl, trimmedRoomId);

      await wsService.connect(serverUrl, trimmedRoomId);
      setCredentials(serverUrl, trimmedRoomId);
      setStatus(ConnectionStatus.Connected);

      setInputs(inputs);
      setLayers(layers);
      setResolution(resolution);
      setTimelinePlaying(isTimelinePlaying);
      const { gridFactor } = useSettingsStore.getState();
      setGridConfig(
        Math.round(resolution.width / gridFactor),
        Math.round(resolution.height / gridFactor),
      );

      navigation.replace(SCREEN_NAMES.MAIN);
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : "Connection failed";
      const isRoomNotFound = /\(404\)/.test(rawMessage);
      const message = isRoomNotFound
        ? "Room not found. Check the room ID and try again."
        : rawMessage;
      setError(message);
      setErrors(isRoomNotFound ? { roomId: message } : { general: message });
    } finally {
      setIsLoading(false);
    }
  }, [
    serverUrl,
    selectedRoomId,
    isPrivateRoom,
    privateRoomId,
    navigation,
    setCredentials,
    setError,
    setStatus,
  ]);

  // QR scan from room screen: navigate directly with scanned credentials
  const handleQRScan = useCallback(
    (data: ConnectionData) => {
      setShowQR(false);
      if (data.serverUrl === serverUrl) {
        setSelectedRoomId(data.roomId);
        setPrivateRoomId(data.roomId);
        setIsPrivateRoom(true);
      } else {
        // Different server — go back to server screen and navigate fresh
        navigation.navigate(SCREEN_NAMES.JOIN_ROOM, {
          serverUrl: data.serverUrl,
          initialRoomId: data.roomId,
        });
      }
    },
    [serverUrl, navigation],
  );

  return {
    serverUrl,
    rooms,
    selectedRoomId,
    setSelectedRoomId,
    isPrivateRoom,
    togglePrivateRoom,
    privateRoomId,
    setPrivateRoomId,
    errors,
    isLoading,
    handleConnect,
    handleConnectAsCamera,
    showQR,
    setShowQR,
    handleQRScan,
  };
}
