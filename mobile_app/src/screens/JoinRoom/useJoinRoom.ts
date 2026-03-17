import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import { wsService } from "../../services/websocketService";
import { apiService, type ActiveRoom } from "../../services/apiService";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { ConnectionStatus } from "../../types/connection";
import { ConnectionData } from "../../utils/connectionUtils";
import type { RootNavigationProp } from "../../navigation/navigationTypes";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";

interface FormErrors {
  serverUrl?: string;
  roomId?: string;
  general?: string;
}

export function useJoinRoom() {
  const navigation = useNavigation<RootNavigationProp>();
  const { serverUrl, roomId, setCredentials, setError, setStatus } =
    useConnectionStore();

  const [localServerUrl, setLocalServerUrl] = useState(serverUrl);
  const [localRoomId, setLocalRoomId] = useState(roomId);
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);

  // Room list fetched from server
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const fetchIdRef = useRef(0);
  const refreshIntervalMs = 5000;

  useEffect(() => {
    console.log("[JoinRoom/useJoinRoom] mounted", {
      initialServerUrl: serverUrl,
      initialRoomId: roomId,
    });
    return () => {
      console.log("[JoinRoom/useJoinRoom] unmounted");
    };
  }, [serverUrl, roomId]);

  // Auto-fetch rooms when serverUrl changes (debounced 600ms)
  // and keep refreshing every 5 seconds to detect stale rooms.
  useEffect(() => {
    const trimmed = localServerUrl.trim();

    if (!trimmed) {
      setRooms([]);
      setRoomsLoading(false);
      return;
    }

    const fetchRooms = async (reason: "debounce" | "interval") => {
      const id = ++fetchIdRef.current;
      setRoomsLoading(true);
      try {
        const result = await apiService.fetchActiveRooms(trimmed);

        const deduped = result.filter(
          (room, index, arr) =>
            arr.findIndex((candidate) => candidate.roomId === room.roomId) ===
            index,
        );

        // Only apply if this is still the latest request
        if (id === fetchIdRef.current) {
          setRooms(deduped);

          const selectedStillExists = deduped.some(
            (room) => room.roomId === localRoomId,
          );
          if (localRoomId && !selectedStillExists) {
            setErrors((prev) => ({
              ...prev,
              roomId:
                "Selected room is no longer active. Please choose another room.",
            }));
          }
        }
      } catch (err) {
        console.warn("[JoinRoom] failed to fetch rooms:", err);
        if (id === fetchIdRef.current) {
          setRooms([]);
        }
      } finally {
        if (id === fetchIdRef.current) {
          setRoomsLoading(false);
        }
      }
    };

    const timer = setTimeout(() => {
      void fetchRooms("debounce");
    }, 600);

    const interval = setInterval(() => {
      void fetchRooms("interval");
    }, refreshIntervalMs);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [localServerUrl, localRoomId]);

  const selectRoom = useCallback((room: ActiveRoom) => {
    setLocalRoomId(room.roomId);
    setErrors((prev) => ({ ...prev, roomId: undefined }));
  }, []);

  const validate = useCallback((): FormErrors => {
    const newErrors: FormErrors = {};
    if (!localServerUrl.trim()) {
      newErrors.serverUrl = "Server URL is required";
    }
    if (!localRoomId.trim()) {
      newErrors.roomId = "Room ID is required";
    }
    const data = ConnectionData.fromManualInput(localServerUrl, localRoomId);
    if (localServerUrl && !data.isValid()) {
      newErrors.serverUrl = "Invalid server URL format";
    }
    return newErrors;
  }, [localServerUrl, localRoomId]);

  const handleConnect = useCallback(async () => {
    const validationErrors = validate();
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    setIsLoading(true);
    setStatus(ConnectionStatus.Connecting);
    const trimmedUrl = localServerUrl.trim();
    const trimmedRoomId = localRoomId.trim();
    setCredentials(trimmedUrl, trimmedRoomId);

    const { setInputs } = useInputsStore.getState();
    const { setItems, setGridConfig } = useLayoutStore.getState();

    try {
      await wsService.connect(trimmedUrl, trimmedRoomId);
      setStatus(ConnectionStatus.Connected);

      // Fetch and populate room state
      try {
        const { inputs, layout } = await apiService.fetchRoomState(
          trimmedUrl,
          trimmedRoomId,
        );
        setInputs(inputs);
        setItems(layout.items);
        setGridConfig(layout.columns, layout.rows);
        console.log("[JoinRoom] Room state loaded", {
          inputCount: inputs.length,
          layoutGrid: `${layout.columns}x${layout.rows}`,
        });
      } catch (err) {
        console.warn("[JoinRoom] Failed to load room state:", err);
        // Non-fatal; continue to main screen
      }

      navigation.replace(SCREEN_NAMES.MAIN);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setError(message);
      setErrors({ serverUrl: message });
    } finally {
      setIsLoading(false);
    }
  }, [
    localServerUrl,
    localRoomId,
    validate,
    navigation,
    setCredentials,
    setError,
    setStatus,
  ]);

  const handleQRScan = useCallback((data: ConnectionData) => {
    setShowQR(false);
    setLocalServerUrl(data.serverUrl);
    setLocalRoomId(data.roomId);
    setErrors({});
  }, []);

  return {
    localServerUrl,
    setLocalServerUrl,
    localRoomId,
    setLocalRoomId,
    errors,
    isLoading,
    showQR,
    setShowQR,
    handleConnect,
    handleQRScan,
    rooms,
    roomsLoading,
    selectRoom,
  };
}
