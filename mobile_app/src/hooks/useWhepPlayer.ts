import { useEffect, useRef, useState } from "react";
import {
  MediaStream,
  RTCPeerConnection,
  RTCSessionDescription,
} from "react-native-webrtc";

type Status = "idle" | "connecting" | "connected" | "error";

async function waitForIceGathering(
  pc: RTCPeerConnection,
  timeoutMs = 3000,
): Promise<void> {
  if (pc.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      (pc as any).removeEventListener("icegatheringstatechange", onStateChange);
      resolve();
    };
    const onStateChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    (pc as any).addEventListener("icegatheringstatechange", onStateChange);
    if (pc.iceGatheringState === "complete") finish();
  });
}

type ConnectResult = {
  pc: RTCPeerConnection;
  detachTrackListener: () => void;
};

async function connectWhep(
  whepUrl: string,
  onStream: (stream: MediaStream) => void,
  signal: AbortSignal,
): Promise<ConnectResult> {
  const pc = new RTCPeerConnection({ iceServers: [] });

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const stream = new MediaStream(undefined);
  const onTrack = (event: any) => {
    if (signal.aborted) return;
    const track = event.track ?? event.streams?.[0]?.getTracks?.()?.[0];
    if (track) stream.addTrack(track);
    if (stream.getVideoTracks().length > 0 && !signal.aborted) {
      onStream(stream);
    }
  };
  (pc as any).addEventListener("track", onTrack);
  const detachTrackListener = () => {
    (pc as any).removeEventListener("track", onTrack);
  };

  try {
    await pc.setLocalDescription(await pc.createOffer({}));
    await waitForIceGathering(pc);

    if (signal.aborted) {
      detachTrackListener();
      pc.close();
      const abortErr = new Error("Aborted");
      abortErr.name = "AbortError";
      throw abortErr;
    }

    const resp = await fetch(whepUrl, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: pc.localDescription?.sdp,
      signal,
    });

    if (!resp.ok) {
      detachTrackListener();
      pc.close();
      throw new Error(`WHEP ${resp.status}: ${resp.statusText}`);
    }

    const answerSdp = await resp.text();
    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: "answer", sdp: answerSdp }),
    );

    return { pc, detachTrackListener };
  } catch (err) {
    detachTrackListener();
    throw err;
  }
}

export function useWhepPlayer(whepUrl: string | null) {
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const pcRef = useRef<RTCPeerConnection | null>(null);

  useEffect(() => {
    if (!whepUrl) {
      setStreamUrl(null);
      setStatus("idle");
      return;
    }

    const abortCtrl = new AbortController();
    const signal = abortCtrl.signal;
    let detach: (() => void) | null = null;
    setStatus("connecting");
    setStreamUrl(null);

    connectWhep(
      whepUrl,
      (stream) => {
        if (signal.aborted) return;
        setStreamUrl(stream.toURL());
        setStatus("connected");
      },
      signal,
    )
      .then(({ pc, detachTrackListener }) => {
        detach = detachTrackListener;
        if (signal.aborted) {
          detachTrackListener();
          pc.close();
          return;
        }
        pcRef.current = pc;
      })
      .catch((err) => {
        if ((err as DOMException).name === "AbortError") return;
        console.error("[WHEP] connection failed", err);
        if (!signal.aborted) setStatus("error");
      });

    return () => {
      abortCtrl.abort();
      detach?.();
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [whepUrl]);

  return { streamUrl, status };
}
