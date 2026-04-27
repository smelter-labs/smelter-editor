import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { wsService } from "../../services/websocketService";
import { apiService, type ActiveRoom } from "../../services/apiService";
import { useConnectionStore } from "../../store/connectionStore";
import { useInputsStore } from "../../store/inputsStore";
import { useLayoutStore } from "../../store/layoutStore";
import { useSettingsStore } from "../../store/settingsStore";
import { ConnectionStatus } from "../../types/connection";
import { ConnectionData } from "../../utils/connectionUtils";
import type { RootNavigationProp } from "../../navigation/navigationTypes";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";

const STORAGE_KEY = "saved-server-urls";

async function loadSavedUrls(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

async function persistSavedUrls(urls: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  } catch (err) {
    console.warn("[JoinRoom] failed to persist saved URLs", err);
  }
}

export type ServerStatus = "idle" | "loading" | "error" | "success";
export type HealthStatus = "checking" | "ok" | "error";
export type Phase = "server" | "room";

interface FormErrors {
  roomId?: string;
  general?: string;
}

export function useJoinRoom() {
  const navigation = useNavigation<RootNavigationProp>();
  const { serverUrl, setCredentials, setError, setStatus } =
    useConnectionStore();

  // URL history
  const [savedUrls, setSavedUrls] = useState<string[]>([]);
  const [healthStatus, setHealthStatus] = useState<
    Record<string, HealthStatus>
  >({});
  // Tracks in-flight health check requests so stale results are discarded
  const healthSeqRef = useRef<Record<string, number>>({});

  const [selectedServerUrl, setSelectedServerUrl] = useState(serverUrl ?? "");

  // Server connection phase
  const [serverStatus, setServerStatus] = useState<ServerStatus>("idle");
  const [serverError, setServerError] = useState<string | null>(null);
  const [rooms, setRooms] = useState<ActiveRoom[]>([]);

  // Room selection phase
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const [isPrivateRoom, setIsPrivateRoom] = useState(false);
  const [privateRoomId, setPrivateRoomId] = useState("");

  // Final connect
  const [errors, setErrors] = useState<FormErrors>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showQR, setShowQR] = useState(false);

  const phase: Phase = serverStatus === "success" ? "room" : "server";

  const checkUrlHealth = useCallback((url: string) => {
    const seq = (healthSeqRef.current[url] ?? 0) + 1;
    healthSeqRef.current[url] = seq;

    setHealthStatus((prev) => ({ ...prev, [url]: "checking" }));

    void (async () => {
      try {
        // fetchActiveRooms returning any response (even empty) proves the server is reachable
        await apiService.fetchActiveRooms(url);
        if (healthSeqRef.current[url] === seq) {
          setHealthStatus((prev) => ({ ...prev, [url]: "ok" }));
        }
      } catch {
        if (healthSeqRef.current[url] === seq) {
          setHealthStatus((prev) => ({ ...prev, [url]: "error" }));
        }
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const urls = await loadSavedUrls();
      setSavedUrls(urls);
      for (const url of urls) {
        checkUrlHealth(url);
      }
    })();
  }, [checkUrlHealth]);

  const removeSavedUrl = useCallback((url: string) => {
    setSavedUrls((prev) => {
      const next = prev.filter((u) => u !== url);
      void persistSavedUrls(next);
      return next;
    });
    setHealthStatus((prev) => {
      const next = { ...prev };
      delete next[url];
      return next;
    });
  }, []);

  // Changing the selected server resets to the server phase
  const handleServerUrlChange = useCallback((url: string) => {
    setSelectedServerUrl(url);
    setServerStatus("idle");
    setServerError(null);
    setRooms([]);
  }, []);

  // urlOverride exists so QR scan can pass the URL without waiting for state to flush
  const handleJoinServer = useCallback(
    async (urlOverride?: string) => {
      const trimmed = (urlOverride ?? selectedServerUrl).trim();

      if (!trimmed) {
        setServerError("Server URL is required");
        setServerStatus("error");
        return;
      }

      const probe = ConnectionData.fromManualInput(trimmed, "_probe_");
      if (!probe.isValid()) {
        setServerError("Invalid server URL format");
        setServerStatus("error");
        return;
      }

      setServerError(null);
      setServerStatus("loading");

      try {
        const result = await apiService.fetchActiveRooms(trimmed);
        const deduped = result.filter(
          (room, i, arr) =>
            arr.findIndex((c) => c.roomId === room.roomId) === i,
        );
        setRooms(deduped);
        setServerStatus("success");

        // Auto-save the URL and mark it healthy
        setSavedUrls((prev) => {
          if (prev.includes(trimmed)) return prev;
          const next = [...prev, trimmed];
          void persistSavedUrls(next);
          return next;
        });
        setHealthStatus((prev) => ({ ...prev, [trimmed]: "ok" }));
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Could not reach server";
        setServerError(msg);
        setServerStatus("error");
        setHealthStatus((prev) => ({ ...prev, [trimmed]: "error" }));
      }
    },
    [selectedServerUrl],
  );

  // While waiting on the room-selection phase, poll for new/removed rooms every 3 s
  useEffect(() => {
    if (serverStatus !== "success") return;

    const url = selectedServerUrl.trim();

    async function refresh() {
      try {
        const result = await apiService.fetchActiveRooms(url);
        const deduped = result.filter(
          (room, i, arr) =>
            arr.findIndex((c) => c.roomId === room.roomId) === i,
        );
        setRooms(deduped);
      } catch {
        // Silently ignore poll failures — the user can still attempt to connect
      }
    }

    const id = setInterval(() => void refresh(), 3000);
    return () => clearInterval(id);
  }, [serverStatus, selectedServerUrl]);

  const handleConnect = useCallback(async () => {
    const trimmedUrl = selectedServerUrl.trim();
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
        await apiService.fetchRoomState(trimmedUrl, trimmedRoomId);

      await wsService.connect(trimmedUrl, trimmedRoomId);
      setCredentials(trimmedUrl, trimmedRoomId);
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
    selectedServerUrl,
    selectedRoomId,
    isPrivateRoom,
    privateRoomId,
    navigation,
    setCredentials,
    setError,
    setStatus,
  ]);

  const handleQRScan = useCallback(
    (data: ConnectionData) => {
      setShowQR(false);
      setSelectedServerUrl(data.serverUrl);
      setSelectedRoomId(data.roomId);
      setErrors({});
      // Pass URL directly to avoid reading stale selectedServerUrl state
      void handleJoinServer(data.serverUrl);
    },
    [handleJoinServer],
  );

  const togglePrivateRoom = useCallback(() => {
    setIsPrivateRoom((v) => !v);
    setErrors({});
  }, []);

  return {
    // server dropdown
    savedUrls,
    healthStatus,
    selectedServerUrl,
    handleServerUrlChange,
    removeSavedUrl,
    serverStatus,
    serverError,
    handleJoinServer,

    // phase & rooms
    phase,
    rooms,

    // room selection
    selectedRoomId,
    setSelectedRoomId,
    isPrivateRoom,
    togglePrivateRoom,
    privateRoomId,
    setPrivateRoomId,

    // final connect
    errors,
    isLoading,
    handleConnect,

    // misc
    showQR,
    setShowQR,
    handleQRScan,
  };
}
