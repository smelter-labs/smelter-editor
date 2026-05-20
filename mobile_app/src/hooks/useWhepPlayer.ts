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

async function connectWhep(
  whepUrl: string,
  onStream: (stream: MediaStream) => void,
  signal: AbortSignal,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: [] });

  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });

  const stream = new MediaStream(undefined);
  (pc as any).addEventListener("track", (event: any) => {
    const track = event.track ?? event.streams?.[0]?.getTracks?.()?.[0];
    if (track) stream.addTrack(track);
    // Notify once we have a video track so RTCView can start rendering
    if (stream.getVideoTracks().length > 0 && !signal.aborted) {
      onStream(stream);
    }
  });

  await pc.setLocalDescription(await pc.createOffer({}));
  await waitForIceGathering(pc);

  if (signal.aborted) {
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
    pc.close();
    throw new Error(`WHEP ${resp.status}: ${resp.statusText}`);
  }

  const answerSdp = await resp.text();
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: "answer", sdp: answerSdp }),
  );

  return pc;
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
    setStatus("connecting");
    setStreamUrl(null);

    connectWhep(
      whepUrl,
      (stream) => {
        setStreamUrl(stream.toURL());
        setStatus("connected");
      },
      abortCtrl.signal,
    )
      .then((pc) => {
        if (abortCtrl.signal.aborted) {
          pc.close();
          return;
        }
        pcRef.current = pc;
      })
      .catch((err) => {
        if ((err as DOMException).name === "AbortError") return;
        console.error("[WHEP] connection failed", err);
        setStatus("error");
      });

    return () => {
      abortCtrl.abort();
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [whepUrl]);

  return { streamUrl, status };
}
