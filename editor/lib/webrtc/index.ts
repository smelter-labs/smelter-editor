const DEBUG_ICE = false;

export type WhipCodec = 'h264' | 'vp8' | 'vp9' | 'auto';

const CODEC_MIME: Record<Exclude<WhipCodec, 'auto'>, RegExp> = {
  h264: /video\/H264/i,
  vp8: /video\/VP8/i,
  vp9: /video\/VP9/i,
};

export function buildIceServers(): RTCIceServer[] {
  const urls =
    process.env.NEXT_PUBLIC_TURN_URLS?.split(',')
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const username = process.env.NEXT_PUBLIC_TURN_USER;
  const credential = process.env.NEXT_PUBLIC_TURN_PASS;
  const servers: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (urls.length && username && credential) {
    servers.push({ urls, username, credential });
  }
  return servers;
}

export async function waitIceComplete(
  pc: RTCPeerConnection,
  timeoutMs = 2500,
): Promise<RTCSessionDescriptionInit | null> {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res(pc.localDescription);
    const t = setTimeout(() => res(pc.localDescription), timeoutMs);

    const handler = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        pc.removeEventListener('icegatheringstatechange', handler);
        res(pc.localDescription);
      }
    };
    pc.addEventListener('icegatheringstatechange', handler);
  });
}

export function setCodecPreference(
  transceiver: RTCRtpTransceiver,
  codec: WhipCodec = 'h264',
) {
  if (codec === 'auto') return;
  if (!RTCRtpSender?.getCapabilities || !('setCodecPreferences' in transceiver))
    return;

  const caps = RTCRtpSender.getCapabilities('video');
  if (!caps) return;

  const pattern = CODEC_MIME[codec];
  const preferred = caps.codecs.filter((c) => pattern.test(c.mimeType));
  // Rival video codecs must be EXCLUDED, not just deprioritized: the remote
  // answerer picks by its own registry order (smelter answers H264 whenever
  // the offer contains it), which silently defeats an explicit codec choice —
  // and a local-preference/answer mismatch can stall Chrome's encoder
  // outright. Keep only RTP infrastructure entries (rtx/red/fec) alongside.
  const infra = caps.codecs.filter(
    (c) => !/video\/(H264|H265|VP8|VP9|AV1)/i.test(c.mimeType),
  );

  let ordered = preferred;
  if (codec === 'h264' && !/Firefox/i.test(navigator.userAgent)) {
    const baseline = preferred.filter((c) =>
      /profile-level-id=42e01f/i.test(c.sdpFmtpLine ?? ''),
    );
    const others = preferred.filter(
      (c) => !/profile-level-id=42e01f/i.test(c.sdpFmtpLine ?? ''),
    );
    ordered = [...baseline, ...others];
  }

  if (ordered.length) {
    try {
      transceiver.setCodecPreferences([...ordered, ...infra]);
    } catch {}
  }
}

export function forceH264(transceiver: RTCRtpTransceiver) {
  setCodecPreference(transceiver, 'h264');
}

export function wireDebug(pc: RTCPeerConnection) {
  if (!DEBUG_ICE) return;
  pc.onicecandidate = (e) =>
    console.log('[ICE]', e.candidate?.candidate || 'gathering complete');
  pc.oniceconnectionstatechange = () =>
    console.log('[ICE state]', pc.iceConnectionState);
  pc.onconnectionstatechange = () =>
    console.log('[PC state]', pc.connectionState);
}
