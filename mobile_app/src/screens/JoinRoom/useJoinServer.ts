import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { apiService } from "../../services/apiService";
import { useConnectionStore } from "../../store/connectionStore";
import { ConnectionData } from "../../utils/connectionUtils";
import type { RootNavigationProp } from "../../navigation/navigationTypes";
import { SCREEN_NAMES } from "../../navigation/navigationTypes";

const STORAGE_KEY = "saved-server-urls";
const MANUAL_INPUT_PROBE_ROOM_ID = "_probe_";

async function loadSavedUrls(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => typeof item === "string")
    ) {
      console.warn("[JoinServer] Invalid format for saved URLs, resetting");
      return [];
    }
    return parsed;
  } catch {
    return [];
  }
}

async function persistSavedUrls(urls: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(urls));
  } catch (err) {
    console.warn("[JoinServer] failed to persist saved URLs", err);
  }
}

export type ServerStatus = "idle" | "loading" | "error" | "success";
export type HealthStatus = "checking" | "ok" | "error";

export function useJoinServer() {
  const navigation = useNavigation<RootNavigationProp>();
  const { serverUrl } = useConnectionStore();

  const [savedUrls, setSavedUrls] = useState<string[]>([]);
  const [healthStatus, setHealthStatus] = useState<
    Record<string, HealthStatus>
  >({});
  const healthSeqRef = useRef<Record<string, number>>({});
  const joinSeqRef = useRef(0);

  const [selectedServerUrl, setSelectedServerUrl] = useState(serverUrl ?? "");
  const [serverStatus, setServerStatus] = useState<ServerStatus>("idle");
  const [serverError, setServerError] = useState<string | null>(null);

  const [showQR, setShowQR] = useState(false);

  const checkUrlHealth = useCallback((url: string) => {
    const seq = (healthSeqRef.current[url] ?? 0) + 1;
    healthSeqRef.current[url] = seq;
    setHealthStatus((prev) => ({ ...prev, [url]: "checking" }));
    void (async () => {
      try {
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

  const removeSavedUrl = useCallback(
    (url: string) => {
      const nextSavedUrls = savedUrls.filter((u) => u !== url);
      setSavedUrls(nextSavedUrls);
      void persistSavedUrls(nextSavedUrls);
      setHealthStatus((prev) => {
        const next = { ...prev };
        delete next[url];
        return next;
      });
    },
    [savedUrls],
  );

  const handleServerUrlChange = useCallback((url: string) => {
    joinSeqRef.current += 1;
    setSelectedServerUrl(url);
    setServerStatus("idle");
    setServerError(null);
  }, []);

  // urlOverride exists so QR scan can pass the URL without waiting for state to flush
  const handleJoinServer = useCallback(
    async (urlOverride?: string) => {
      const requestId = ++joinSeqRef.current;
      const trimmed = (urlOverride ?? selectedServerUrl).trim();

      if (!trimmed) {
        setServerError("Server URL is required");
        setServerStatus("error");
        return;
      }

      const probe = ConnectionData.fromManualInput(
        trimmed,
        MANUAL_INPUT_PROBE_ROOM_ID,
      );
      if (!probe.isValid()) {
        setServerError("Invalid server URL format");
        setServerStatus("error");
        return;
      }

      setServerError(null);
      setServerStatus("loading");

      try {
        await apiService.fetchActiveRooms(trimmed);
        if (joinSeqRef.current !== requestId) return;

        setServerStatus("success");

        const nextSavedUrls = savedUrls.includes(trimmed)
          ? savedUrls
          : [...savedUrls, trimmed];
        setSavedUrls(nextSavedUrls);
        if (nextSavedUrls !== savedUrls) {
          void persistSavedUrls(nextSavedUrls);
        }
        setHealthStatus((prev) => ({ ...prev, [trimmed]: "ok" }));

        navigation.navigate(SCREEN_NAMES.JOIN_LOBBY, { serverUrl: trimmed });
      } catch (err) {
        if (joinSeqRef.current !== requestId) return;
        const msg =
          err instanceof Error ? err.message : "Could not reach server";
        setServerError(msg);
        setServerStatus("error");
        setHealthStatus((prev) => ({ ...prev, [trimmed]: "error" }));
      }
    },
    [selectedServerUrl, savedUrls, navigation],
  );

  const handleQRScan = useCallback(
    (data: ConnectionData) => {
      setShowQR(false);
      setSelectedServerUrl(data.serverUrl);
      navigation.navigate(SCREEN_NAMES.JOIN_ROOM, {
        serverUrl: data.serverUrl,
        initialRoomId: data.roomId,
      });
    },
    [navigation],
  );

  return {
    savedUrls,
    healthStatus,
    selectedServerUrl,
    handleServerUrlChange,
    removeSavedUrl,
    serverStatus,
    serverError,
    handleJoinServer,
    showQR,
    setShowQR,
    handleQRScan,
  };
}
