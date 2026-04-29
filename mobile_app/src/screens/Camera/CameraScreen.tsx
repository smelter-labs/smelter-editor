import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import {
  Button,
  Chip,
  IconButton,
  Menu,
  Surface,
  Switch,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";
import { ScrollView } from "react-native";
import { RTCView } from "react-native-webrtc";
import type { RTCPeerConnection, MediaStream } from "react-native-webrtc";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  requestMediaPermissions,
  getUserMediaStream,
  stopMediaStream,
  createWhipConnection,
  enumerateCameras,
  RESOLUTION_PRESETS,
  type CameraDevice,
  type VideoCodecPreference,
  type ResolutionPreset,
} from "../../services/whipService";
import { SmelterApiService } from "../../services/smelterApiService";
import type { RootStackParamList } from "../../navigation/navigationTypes";
import { CameraLogModal } from "./CameraLogModal";

type CameraRouteProp = RouteProp<RootStackParamList, "Camera">;

type Status =
  | "idle"
  | "preview"
  | "connecting"
  | "streaming"
  | "stopping"
  | "error";

const KEEP_AWAKE_TAG_PREVIEW = "camera-preview";
const KEEP_AWAKE_TAG_STREAMING = "camera-streaming";

export function CameraScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<CameraRouteProp>();
  const { serverUrl, roomId } = route.params;
  const insets = useSafeAreaInsets();

  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraDevice[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | undefined>(
    undefined,
  );
  const [cameraMenuOpen, setCameraMenuOpen] = useState(false);
  const [streamURL, setStreamURL] = useState<string | null>(null);

  // Debug overrides — when non-empty, bypass joinRoomAsWhip and use these directly
  const [debugExpanded, setDebugExpanded] = useState(false);
  const [overrideWhipUrl, setOverrideWhipUrl] = useState("");
  const [overrideBearerToken, setOverrideBearerToken] = useState("");
  const [forceH264, setForceH264] = useState(false);
  const [videoCodec, setVideoCodec] = useState<VideoCodecPreference>("vp8");
  const [resolution, setResolution] = useState<ResolutionPreset>("720p");
  const [logsVisible, setLogsVisible] = useState(false);
  const isDebugBuild = __DEV__;
  const isOverrideActive = isDebugBuild && overrideWhipUrl.trim().length > 0;

  const localStreamRef = useRef<MediaStream | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const inputIdRef = useRef<string | null>(null);
  const ackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const apiRef = useRef(new SmelterApiService(serverUrl, roomId));

  // ── keep-awake management ──────────────────────────────────────────────────

  useEffect(() => {
    if (status === "preview") {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG_PREVIEW);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG_PREVIEW);
    }
  }, [status]);

  useEffect(() => {
    if (status === "streaming") {
      void activateKeepAwakeAsync(KEEP_AWAKE_TAG_STREAMING);
    } else {
      deactivateKeepAwake(KEEP_AWAKE_TAG_STREAMING);
    }
  }, [status]);

  // ── cleanup on unmount ────────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      stopAckInterval();
      teardownPeerConnection();
      const localStream = localStreamRef.current;
      localStreamRef.current = null;
      if (localStream) {
        stopMediaStream(localStream);
      }
      deactivateKeepAwake(KEEP_AWAKE_TAG_PREVIEW);
      deactivateKeepAwake(KEEP_AWAKE_TAG_STREAMING);
    };
  }, []);

  // ── helpers ───────────────────────────────────────────────────────────────

  function setStream(stream: MediaStream | null) {
    localStreamRef.current = stream;
    setStreamURL(stream ? stream.toURL() : null);
  }

  function stopAckInterval() {
    if (ackIntervalRef.current) {
      clearInterval(ackIntervalRef.current);
      ackIntervalRef.current = null;
    }
  }

  function teardownPeerConnection() {
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  }

  // ── start preview ─────────────────────────────────────────────────────────

  const startPreview = useCallback(async () => {
    setErrorMessage(null);

    const granted = await requestMediaPermissions();
    if (!granted) {
      setErrorMessage("Camera and microphone permissions are required.");
      setStatus("error");
      return;
    }

    try {
      // Enumerate cameras on first preview start
      if (cameras.length === 0) {
        const found = await enumerateCameras();
        console.log("[Camera] Enumerated cameras:", found);
        setCameras(found);
      }

      console.log(
        "[Camera] Requesting getUserMedia (deviceId:",
        selectedCameraId ?? "default",
        "resolution:",
        resolution,
        ")",
      );
      const stream = await getUserMediaStream(
        true,
        selectedCameraId,
        resolution,
      );
      const videoTrack = stream.getVideoTracks()[0] as any;
      const settings = videoTrack?.getSettings?.() ?? {};
      console.log(
        "[Camera] Stream started — actual resolution:",
        settings.width,
        "×",
        settings.height,
        "(requested:",
        resolution,
        ")",
      );
      setStream(stream);
      setStatus("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Camera] startPreview failed:", msg);
      setErrorMessage(msg);
      setStatus("error");
    }
  }, [cameras.length, selectedCameraId, resolution]);

  // ── stop preview ──────────────────────────────────────────────────────────

  const stopPreview = useCallback(() => {
    if (localStreamRef.current) {
      stopMediaStream(localStreamRef.current);
      setStream(null);
    }
    setStatus("idle");
  }, []);

  // ── start streaming ───────────────────────────────────────────────────────

  const startStreaming = useCallback(async () => {
    if (!localStreamRef.current) return;
    setStatus("connecting");
    setErrorMessage(null);

    try {
      let finalWhipUrl: string;
      let finalBearerToken: string;

      if (isOverrideActive) {
        // Debug override — skip server registration, use provided credentials
        finalWhipUrl = overrideWhipUrl.trim();
        finalBearerToken = overrideBearerToken.trim();
        console.log("[Camera] Using override WHIP URL:", finalWhipUrl);
      } else {
        // Register as WHIP input — server returns the whipUrl and bearerToken.
        // After joinRoomAsWhip the input is already in a "connected" state on the
        // server, so connectInput is NOT called here (only needed after an
        // explicit disconnect → reconnect cycle).
        console.log("[Camera] Registering WHIP input…");
        const { inputId, bearerToken, whipUrl } =
          await apiRef.current.joinRoomAsWhip("mobile");
        inputIdRef.current = inputId;
        finalWhipUrl = apiRef.current.fixWhipUrl(whipUrl);
        finalBearerToken = bearerToken;
        console.log("[Camera] Got WHIP params", {
          inputId,
          whipUrl: finalWhipUrl,
          bearerToken: finalBearerToken ? "(present)" : "(empty)",
        });
      }

      // Snapshot inputId for use inside the closure (may be null for override mode)
      const capturedInputId = inputIdRef.current;

      // Create WebRTC WHIP connection
      console.log("[Camera] Creating WHIP peer connection…");
      const pc = await createWhipConnection({
        localStream: localStreamRef.current,
        whipUrl: finalWhipUrl,
        bearerToken: finalBearerToken,
        videoCodec,
        forceH264,
        onConnectionStateChange: (state) => {
          console.log("[Camera] WebRTC connection state:", state);
          if (state === "connected") {
            setStatus("streaming");
            stopAckInterval();
            if (capturedInputId) {
              // Send ack immediately, then every 5 seconds
              void apiRef.current
                .ackWhip(capturedInputId)
                .catch((e) => console.warn("[Camera] ack failed", e));
              ackIntervalRef.current = setInterval(() => {
                void apiRef.current
                  .ackWhip(capturedInputId)
                  .catch((e) => console.warn("[Camera] ack failed", e));
              }, 5000);
            }
          } else if (state === "failed" || state === "disconnected") {
            console.warn("[Camera] WebRTC connection", state);
            setErrorMessage(`Stream ${state}.`);
            setStatus("error");
            stopAckInterval();
          }
        },
      });
      pcRef.current = pc;
      console.log("[Camera] WHIP connection created, waiting for 'connected'…");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Camera] startStreaming failed:", msg);
      setErrorMessage(msg);
      setStatus("error");
      teardownPeerConnection();
      if (inputIdRef.current) {
        void apiRef.current.disconnectInput(inputIdRef.current).catch(() => {});
        inputIdRef.current = null;
      }
    }
  }, [
    isOverrideActive,
    overrideWhipUrl,
    overrideBearerToken,
    videoCodec,
    forceH264,
  ]);

  // ── stop streaming ────────────────────────────────────────────────────────

  const stopStreaming = useCallback(async () => {
    // Guard: prevent re-entrant calls while already stopping
    setStatus("stopping");
    stopAckInterval();
    teardownPeerConnection();

    if (inputIdRef.current) {
      await apiRef.current
        .disconnectInput(inputIdRef.current)
        .catch((e) => console.warn("[Camera] disconnectInput failed", e));
      inputIdRef.current = null;
    }

    // Restart preview so camera stays visible after stopping stream
    if (localStreamRef.current) {
      stopMediaStream(localStreamRef.current);
      setStream(null);
    }
    setStatus("idle");
    void startPreview();
  }, [startPreview]);

  // ── resolution change ─────────────────────────────────────────────────────

  const handleResolutionChange = useCallback(
    async (newRes: ResolutionPreset) => {
      setResolution(newRes);
      // Only auto-apply during preview; while streaming the change takes effect
      // on the next Start Stream press (avoids dropping the live connection).
      if (status === "preview" && localStreamRef.current) {
        console.log(
          "[Camera] Resolution changed to",
          newRes,
          "— restarting preview",
        );
        stopMediaStream(localStreamRef.current);
        setStream(null);
        const stream = await getUserMediaStream(
          true,
          selectedCameraId,
          newRes,
        ).catch((e) => {
          console.warn("[Camera] resolution restart failed", e);
          return null;
        });
        if (stream) {
          const vt = stream.getVideoTracks()[0] as any;
          const s = vt?.getSettings?.() ?? {};
          console.log(
            "[Camera] Stream started — actual resolution:",
            s.width,
            "×",
            s.height,
            "(requested:",
            newRes,
            ")",
          );
          setStream(stream);
        }
      }
    },
    [status, selectedCameraId],
  );

  // ── camera switch ──────────────────────────────────────────────────────────

  const switchCamera = useCallback(
    async (deviceId: string) => {
      setCameraMenuOpen(false);
      setSelectedCameraId(deviceId);
      if (status === "preview" || status === "streaming") {
        if (localStreamRef.current) {
          stopMediaStream(localStreamRef.current);
          setStream(null);
        }
        const stream = await getUserMediaStream(
          true,
          deviceId,
          resolution,
        ).catch(() => null);
        if (stream) {
          const vt = stream.getVideoTracks()[0] as any;
          const s = vt?.getSettings?.() ?? {};
          console.log(
            "[Camera] Stream started — actual resolution:",
            s.width,
            "×",
            s.height,
            "(requested:",
            resolution,
            ")",
          );
          setStream(stream);
          setStatus("preview");
        }
      }
    },
    [status, resolution],
  );

  // ── derived state ─────────────────────────────────────────────────────────

  const statusLabel: Record<Status, string> = {
    idle: "Idle",
    preview: "Preview",
    connecting: "Connecting…",
    streaming: "Live",
    stopping: "Stopping…",
    error: "Error",
  };

  const statusIcon: Record<Status, string> = {
    idle: "camera-off",
    preview: "camera",
    connecting: "loading",
    streaming: "broadcast",
    stopping: "loading",
    error: "alert-circle",
  };

  const isStreaming = status === "streaming" || status === "connecting";
  const isBusy = status === "connecting" || status === "stopping";

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {/* Camera preview */}
      <View style={styles.previewContainer}>
        {streamURL ? (
          <RTCView
            streamURL={streamURL}
            style={styles.preview}
            objectFit="cover"
            mirror={true}
            zOrder={1}
          />
        ) : (
          <View
            style={[
              styles.previewPlaceholder,
              { backgroundColor: theme.colors.surfaceVariant },
            ]}
          >
            <Text
              variant="bodyMedium"
              style={{ color: theme.colors.onSurfaceVariant }}
            >
              {status === "idle" ? "Press Start Preview" : "Loading camera…"}
            </Text>
          </View>
        )}

        {/* Back button (top-left, over preview) */}
        <IconButton
          icon="arrow-left"
          iconColor="#ffffff"
          containerColor="rgba(0,0,0,0.45)"
          size={22}
          style={[
            styles.backButton,
            {
              top: insets.top + 8,
              left: insets.left + 8,
            },
          ]}
          onPress={() => navigation.goBack()}
        />

        {/* Status chip (top-right, over preview) */}
        <View
          style={[
            styles.statusChipWrapper,
            { top: insets.top + 8, right: insets.right + 8 },
          ]}
        >
          <Chip
            icon={statusIcon[status]}
            compact
            style={[
              styles.statusChip,
              status === "streaming" && styles.statusChipLive,
              status === "error" && {
                backgroundColor: theme.colors.errorContainer,
              },
            ]}
            textStyle={styles.statusChipText}
          >
            {statusLabel[status]}
          </Chip>
          {isDebugBuild && (
            <IconButton
              icon="file-document-outline"
              iconColor="#ffffff"
              containerColor="rgba(0,0,0,0.45)"
              size={18}
              onPress={() => setLogsVisible(true)}
              style={styles.logsButton}
            />
          )}
        </View>
      </View>

      {/* Controls */}
      <Surface
        style={[
          styles.controls,
          {
            paddingBottom: insets.bottom + 16,
            paddingLeft: insets.left + 16,
            paddingRight: insets.right + 16,
          },
        ]}
        elevation={2}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.controlsScroll}
        >
          {/* All controls except Stop Stream are disabled while live */}
          <View
            pointerEvents={isStreaming ? "none" : "box-none"}
            style={isStreaming ? styles.controlsDisabled : undefined}
          >
            <View style={styles.controlsRow}>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}
                numberOfLines={1}
              >
                {serverUrl} / {roomId}
              </Text>

              {/* Camera selector — only shown when preview/streaming and multiple cameras */}
              {cameras.length > 1 && (status === "preview" || isStreaming) && (
                <Menu
                  visible={cameraMenuOpen}
                  onDismiss={() => setCameraMenuOpen(false)}
                  anchor={
                    <IconButton
                      icon="camera-switch"
                      size={20}
                      onPress={() => {
                        if (cameras.length === 0) {
                          void enumerateCameras().then(setCameras);
                        }
                        setCameraMenuOpen(true);
                      }}
                    />
                  }
                >
                  {cameras.map((cam) => (
                    <Menu.Item
                      key={cam.deviceId}
                      title={cam.label}
                      leadingIcon={
                        cam.deviceId === selectedCameraId ? "check" : undefined
                      }
                      onPress={() => void switchCamera(cam.deviceId)}
                    />
                  ))}
                </Menu>
              )}
            </View>

            {/* Resolution picker */}
            <View style={[styles.resolutionRow, { marginTop: 4 }]}>
              <Text
                variant="bodySmall"
                style={{ color: theme.colors.onSurfaceVariant }}
              >
                Resolution
              </Text>
              <View style={styles.resolutionButtons}>
                {(Object.keys(RESOLUTION_PRESETS) as ResolutionPreset[]).map(
                  (r) => (
                    <Button
                      key={r}
                      mode={resolution === r ? "contained" : "outlined"}
                      compact
                      onPress={() => void handleResolutionChange(r)}
                      style={styles.resolutionButton}
                      labelStyle={styles.resolutionLabel}
                    >
                      {r}
                    </Button>
                  ),
                )}
              </View>
            </View>

            {errorMessage && (
              <View style={styles.errorRow}>
                {isDebugBuild && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Open logs"
                    onPress={() => setLogsVisible(true)}
                    hitSlop={10}
                    style={styles.errorInfoButton}
                  >
                    <IconButton
                      icon="information-outline"
                      size={18}
                      iconColor={theme.colors.error}
                      style={styles.errorInfoIcon}
                    />
                  </Pressable>
                )}
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.error, flex: 1 }}
                >
                  {errorMessage}
                </Text>
              </View>
            )}

            {/* Debug override panel */}
            {isDebugBuild && (
              <Button
                mode="text"
                compact
                icon={debugExpanded ? "chevron-up" : "bug-outline"}
                onPress={() => setDebugExpanded((v) => !v)}
                style={styles.debugToggle}
                labelStyle={styles.debugToggleLabel}
              >
                {debugExpanded ? "Hide debug overrides" : "Debug overrides"}
              </Button>
            )}
            {isDebugBuild && debugExpanded && (
              <View style={styles.debugPanel}>
                <TextInput
                  mode="outlined"
                  label="Override WHIP URL"
                  value={overrideWhipUrl}
                  onChangeText={setOverrideWhipUrl}
                  placeholder="http://host:9000/whip/..."
                  autoCapitalize="none"
                  autoCorrect={false}
                  dense
                  style={styles.debugInput}
                />
                <TextInput
                  mode="outlined"
                  label="Override Bearer Token"
                  value={overrideBearerToken}
                  onChangeText={setOverrideBearerToken}
                  placeholder="(optional)"
                  autoCapitalize="none"
                  autoCorrect={false}
                  dense
                  style={styles.debugInput}
                />
                <Text
                  variant="bodySmall"
                  style={{ color: theme.colors.onSurfaceVariant }}
                >
                  Video codec preference
                </Text>
                <View style={styles.codecRow}>
                  {(
                    ["vp8", "vp9", "h264", "default"] as VideoCodecPreference[]
                  ).map((c) => (
                    <Button
                      key={c}
                      mode={videoCodec === c ? "contained" : "outlined"}
                      compact
                      onPress={() => setVideoCodec(c)}
                      style={styles.codecButton}
                      labelStyle={styles.codecLabel}
                    >
                      {c.toUpperCase()}
                    </Button>
                  ))}
                </View>
                <View style={styles.debugRow}>
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant, flex: 1 }}
                  >
                    Strip to H264-only (diagnostic)
                  </Text>
                  <Switch value={forceH264} onValueChange={setForceH264} />
                </View>
                {isOverrideActive ? (
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.primary }}
                  >
                    ✓ URL override active — joinRoomAsWhip will be skipped
                  </Text>
                ) : (
                  <Text
                    variant="bodySmall"
                    style={{ color: theme.colors.onSurfaceVariant }}
                  >
                    Leave WHIP URL empty to use normal server registration
                  </Text>
                )}
              </View>
            )}

            {/* Preview toggle — hidden while stream is active or stopping */}
            {!isStreaming && status !== "stopping" && (
              <View style={[styles.buttonsRow, { marginTop: 4 }]}>
                <Button
                  mode={status === "preview" ? "outlined" : "contained"}
                  onPress={
                    status === "preview"
                      ? stopPreview
                      : () => void startPreview()
                  }
                  style={styles.button}
                >
                  {status === "preview" ? "Stop Preview" : "Start Preview"}
                </Button>
              </View>
            )}

            {/* Retry after error */}
            {status === "error" && (
              <View style={[styles.buttonsRow, { marginTop: 4 }]}>
                <Button
                  mode="contained"
                  onPress={() => {
                    setStatus("idle");
                    void startPreview();
                  }}
                  style={styles.button}
                >
                  Retry
                </Button>
              </View>
            )}
          </View>
          {/* end disabled wrapper */}

          {/* Stream toggle — always outside the disabled wrapper */}
          {(status === "preview" || isStreaming || status === "stopping") && (
            <View style={[styles.buttonsRow, { marginTop: 4 }]}>
              <Button
                mode="contained"
                onPress={
                  isStreaming
                    ? () => void stopStreaming()
                    : () => void startStreaming()
                }
                loading={isBusy}
                disabled={isBusy}
                buttonColor={
                  isStreaming || status === "stopping"
                    ? theme.colors.error
                    : theme.colors.primary
                }
                style={styles.button}
              >
                {isStreaming || status === "stopping"
                  ? "Stop Stream"
                  : "Start Stream"}
              </Button>
            </View>
          )}
        </ScrollView>
      </Surface>

      {isDebugBuild && (
        <CameraLogModal
          visible={logsVisible}
          onClose={() => setLogsVisible(false)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: "#000",
  },
  preview: {
    flex: 1,
  },
  previewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backButton: {
    position: "absolute",
    margin: 0,
  },
  statusChipWrapper: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statusChip: {
    borderRadius: 20,
  },
  statusChipLive: {
    backgroundColor: "#cc2222",
  },
  statusChipText: {
    color: "#ffffff",
    fontSize: 12,
  },
  logsButton: {
    margin: 0,
  },
  controls: {
    paddingTop: 16,
    paddingHorizontal: 16,
    flexShrink: 1,
    minHeight: 0,
    maxHeight: 360,
  },
  controlsDisabled: {
    opacity: 0.4,
  },
  controlsScroll: {
    gap: 12,
    paddingBottom: 4,
  },
  controlsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
  },
  button: {
    flex: 1,
  },
  debugToggle: {
    alignSelf: "flex-start",
    marginLeft: -8,
    marginBottom: -4,
  },
  debugToggleLabel: {
    fontSize: 12,
  },
  debugPanel: {
    gap: 8,
    paddingTop: 4,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 2,
    marginTop: 4,
  },
  errorInfoButton: {
    margin: 0,
    padding: 0,
  },
  errorInfoIcon: {
    margin: 0,
  },
  debugInput: {
    fontSize: 12,
  },
  debugRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  codecRow: {
    flexDirection: "row",
    gap: 6,
  },
  codecButton: {
    flex: 1,
  },
  codecLabel: {
    fontSize: 11,
  },
  resolutionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  resolutionButtons: {
    flexDirection: "row",
    gap: 6,
  },
  resolutionButton: {
    minWidth: 60,
  },
  resolutionLabel: {
    fontSize: 12,
  },
});
