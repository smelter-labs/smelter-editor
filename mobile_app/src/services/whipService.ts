import { PermissionsAndroid, Platform } from "react-native";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";

// ─── Media permissions ────────────────────────────────────────────────────────

export async function requestMediaPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  try {
    const grants = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);

    const cameraGranted =
      grants[PermissionsAndroid.PERMISSIONS.CAMERA] ===
      PermissionsAndroid.RESULTS.GRANTED;
    const audioGranted =
      grants[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] ===
      PermissionsAndroid.RESULTS.GRANTED;

    return cameraGranted && audioGranted;
  } catch {
    return false;
  }
}

// ─── Camera / stream helpers ──────────────────────────────────────────────────

export type ResolutionPreset = "480p" | "720p" | "1080p";

export const RESOLUTION_PRESETS: Record<
  ResolutionPreset,
  { width: number; height: number }
> = {
  "480p": { width: 854, height: 480 },
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

export async function getUserMediaStream(
  enableAudio: boolean,
  deviceId?: string,
  resolution?: ResolutionPreset,
): Promise<MediaStream> {
  let video: boolean | Record<string, unknown> = true;
  if (deviceId || resolution) {
    video = {};
    if (deviceId)
      (video as Record<string, unknown>).deviceId = { exact: deviceId };
    if (resolution) {
      const { width, height } = RESOLUTION_PRESETS[resolution];
      (video as Record<string, unknown>).width = { ideal: width };
      (video as Record<string, unknown>).height = { ideal: height };
    }
  }
  return (await mediaDevices.getUserMedia({
    audio: enableAudio,
    video: video as any,
  })) as MediaStream;
}

export function stopMediaStream(stream: MediaStream): void {
  stream.getTracks().forEach((track: any) => track.stop());
}

// ─── ICE helpers ──────────────────────────────────────────────────────────────

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];

async function waitForIceGatheringComplete(
  pc: RTCPeerConnection,
  timeoutMs: number,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    const listener = () => {
      if (pc.iceGatheringState === "complete") {
        clearTimeout(timeout);
        resolve();
      }
    };

    (pc as any).addEventListener("icegatheringstatechange", listener);
  });
}

// ─── SDP helpers ──────────────────────────────────────────────────────────────

/**
 * Strip the video m-line to only the specified codec (plus its RTX companion).
 * This forces the answerer to use our codec — it cannot "prefer" H264 when we
 * haven't offered it.
 * If the codec isn't present in the offer, returns the original SDP unchanged.
 */
function restrictVideoCodecInSdp(
  sdp: string | undefined,
  codec: VideoCodecPreference,
): string | undefined {
  if (!sdp || codec === "default") return sdp;

  const targetCodec = codec.toUpperCase();

  const lines = sdp.split("\r\n");
  const videoStart = lines.findIndex((l) => l.startsWith("m=video "));
  if (videoStart === -1) return sdp;

  let videoEnd = lines.findIndex(
    (l, i) => i > videoStart && l.startsWith("m="),
  );
  if (videoEnd === -1) videoEnd = lines.length;

  const videoSection = lines.slice(videoStart, videoEnd);

  // Map payload type → codec name
  const payloadCodecs = new Map<string, string>();
  for (const line of videoSection) {
    const m = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/i);
    if (!m) continue;
    payloadCodecs.set(m[1], m[2].toUpperCase());
  }

  // Collect target codec payload types
  const targetPayloads = new Set<string>();
  for (const [pt, name] of payloadCodecs.entries()) {
    if (name === targetCodec) targetPayloads.add(pt);
  }

  if (targetPayloads.size === 0) {
    console.log(`[WHIP] ${targetCodec} not found in offer, sending all codecs`);
    return sdp;
  }

  // Also keep RTX companions (apt= pointing to a target payload)
  const keepPayloads = new Set<string>(targetPayloads);
  for (const line of videoSection) {
    const m = line.match(/^a=fmtp:(\d+)\s+.*\bapt=(\d+)\b/i);
    if (!m) continue;
    if (targetPayloads.has(m[2])) keepPayloads.add(m[1]);
  }

  const mParts = videoSection[0].split(" ");
  const kept = mParts.slice(3).filter((pt) => keepPayloads.has(pt));
  if (kept.length === 0) return sdp;

  console.log(
    `[WHIP] Restricted video to ${targetCodec} only:`,
    kept.join(" "),
  );

  const newMLine = [...mParts.slice(0, 3), ...kept].join(" ");
  const rewrittenSection: string[] = [newMLine];
  for (const line of videoSection.slice(1)) {
    const pm = line.match(/^a=(rtpmap|fmtp|rtcp-fb):(\d+)/i);
    if (!pm) {
      rewrittenSection.push(line);
      continue;
    }
    if (keepPayloads.has(pm[2])) rewrittenSection.push(line);
  }

  return [
    ...lines.slice(0, videoStart),
    ...rewrittenSection,
    ...lines.slice(videoEnd),
  ].join("\r\n");
}

/** Legacy: strip every non-H264 codec from the video m-line. */
function stripToH264OnlyVideoSdp(sdp?: string): string | undefined {
  if (!sdp) return sdp;

  const lines = sdp.split("\r\n");
  const videoStart = lines.findIndex((l) => l.startsWith("m=video "));
  if (videoStart === -1) return sdp;

  let videoEnd = lines.findIndex(
    (l, i) => i > videoStart && l.startsWith("m="),
  );
  if (videoEnd === -1) videoEnd = lines.length;

  const videoSection = lines.slice(videoStart, videoEnd);
  const payloadCodecs = new Map<string, string>();
  for (const line of videoSection) {
    const m = line.match(/^a=rtpmap:(\d+)\s+([^/\s]+)/i);
    if (!m) continue;
    payloadCodecs.set(m[1], m[2].toUpperCase());
  }

  const h264Payloads = new Set<string>();
  for (const [pt, codec] of payloadCodecs.entries()) {
    if (codec === "H264") h264Payloads.add(pt);
  }
  if (h264Payloads.size === 0) return sdp;

  const keepPayloads = new Set<string>(h264Payloads);
  for (const line of videoSection) {
    const m = line.match(/^a=fmtp:(\d+)\s+.*\bapt=(\d+)\b/i);
    if (!m) continue;
    if (h264Payloads.has(m[2])) keepPayloads.add(m[1]);
  }

  const mParts = videoSection[0].split(" ");
  const filteredPayloads = mParts.slice(3).filter((pt) => keepPayloads.has(pt));
  if (filteredPayloads.length === 0) return sdp;

  const rewrittenSection: string[] = [];
  rewrittenSection.push([...mParts.slice(0, 3), ...filteredPayloads].join(" "));
  for (const line of videoSection.slice(1)) {
    const payloadMatch = line.match(/^a=(rtpmap|fmtp|rtcp-fb):(\d+)/i);
    if (!payloadMatch) {
      rewrittenSection.push(line);
      continue;
    }
    if (keepPayloads.has(payloadMatch[2])) rewrittenSection.push(line);
  }

  return [
    ...lines.slice(0, videoStart),
    ...rewrittenSection,
    ...lines.slice(videoEnd),
  ].join("\r\n");
}

// ─── WHIP connection ──────────────────────────────────────────────────────────

export type VideoCodecPreference = "h264" | "vp8" | "vp9" | "default";

export interface WhipConnectionParams {
  localStream: MediaStream;
  whipUrl: string;
  bearerToken: string;
  /** Reorder video codecs so the preferred one is offered first. Default: "h264". */
  videoCodec?: VideoCodecPreference;
  /** Legacy: strip all non-H264 codecs entirely. Diagnostic only. */
  forceH264?: boolean;
  onConnectionStateChange: (state: string) => void;
}

export async function createWhipConnection({
  localStream,
  whipUrl,
  bearerToken,
  videoCodec = "vp8",
  forceH264 = false,
  onConnectionStateChange,
}: WhipConnectionParams): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: DEFAULT_ICE_SERVERS });

  (pc as any).addEventListener("connectionstatechange", () => {
    console.log("[WHIP] connectionState →", pc.connectionState);
    onConnectionStateChange(pc.connectionState);
  });

  (pc as any).addEventListener("iceconnectionstatechange", () => {
    console.log("[WHIP] iceConnectionState →", pc.iceConnectionState);
  });

  (pc as any).addEventListener("icegatheringstatechange", () => {
    console.log("[WHIP] iceGatheringState →", pc.iceGatheringState);
  });

  (pc as any).addEventListener("icecandidate", (e: any) => {
    if (e.candidate) {
      console.log("[WHIP] local ICE candidate:", e.candidate.candidate);
    } else {
      console.log("[WHIP] ICE gathering done (null candidate)");
    }
  });

  localStream.getTracks().forEach((track: any) => {
    pc.addTrack(track, localStream);
  });

  const offer = await pc.createOffer({});
  // Strip all non-preferred video codecs from the offer so the server is forced to
  // negotiate the chosen codec. Default is VP8 (software encoder on Android) to avoid
  // the H264 HW encoder black-frame bug in react-native-webrtc.
  let offerSdp = restrictVideoCodecInSdp(offer.sdp, videoCodec) ?? offer.sdp;
  if (forceH264) {
    // Legacy strip mode: remove every non-H264 video codec entirely.
    // Only useful to diagnose codec negotiation; tends to cause server rejection.
    const stripped = stripToH264OnlyVideoSdp(offerSdp);
    if (stripped) {
      offerSdp = stripped;
      console.log(
        "[WHIP] H264-strip mode active (all other video codecs removed)",
      );
    }
  }

  await pc.setLocalDescription({ type: "offer", sdp: offerSdp });
  await waitForIceGatheringComplete(pc, 3000);

  const headers: Record<string, string> = {
    "Content-Type": "application/sdp",
  };
  if (bearerToken) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }

  console.log("[WHIP] Posting offer to", whipUrl);
  console.log("[WHIP] SDP:", pc.localDescription?.sdp);

  const response = await fetch(whipUrl, {
    method: "POST",
    headers,
    body: pc.localDescription?.sdp,
  });

  console.log("[WHIP] Response status:", response.status, response.statusText);

  if (!response.ok) {
    const errorBody = await response.text();
    console.error("[WHIP] Error body:", errorBody);
    throw new Error(
      `WHIP failed (${response.status} ${response.statusText}): ${errorBody}`,
    );
  }

  const answerSdp = await response.text();
  console.log("[WHIP] Answer SDP:", answerSdp);
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: "answer", sdp: answerSdp }),
  );

  return pc;
}

// ─── Camera enumeration ───────────────────────────────────────────────────────

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export async function enumerateCameras(): Promise<CameraDevice[]> {
  const devices = await mediaDevices.enumerateDevices();
  return (devices as MediaDeviceInfo[])
    .filter((d) => d.kind === "videoinput")
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
    }));
}
