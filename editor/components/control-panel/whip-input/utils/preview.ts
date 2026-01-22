export function stopStream(s: MediaStream | null) {
  s?.getTracks().forEach((t) => {
    try {
      t.stop();
    } catch {}
  });
}

export function attachLocalPreview(stream: MediaStream | null) {
  const el = document.getElementById(
    'local-preview',
  ) as HTMLVideoElement | null;
  if (el) {
    if (stream) {
      el.srcObject = stream;
      el.play?.().catch(() => {});
    } else {
      el.srcObject = null;
      el.pause?.();
    }
  }
}

export function stopCameraAndConnection(
  pcRef: React.MutableRefObject<RTCPeerConnection | null>,
  streamRef: React.MutableRefObject<MediaStream | null>,
) {
  try {
    pcRef.current?.close();
  } catch {}
  stopStream(streamRef.current);
  attachLocalPreview(null);
  pcRef.current = null;
  streamRef.current = null;
}
