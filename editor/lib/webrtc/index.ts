const DEBUG_ICE = false;

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

export function forceH264(transceiver: RTCRtpTransceiver) {
  if (
    !RTCRtpSender?.getCapabilities ||
    !('setCodecPreferences' in transceiver)
  ) {
    return;
  }
  const caps = RTCRtpSender.getCapabilities('video');
  const h264s =
    caps?.codecs.filter((c) => /video\/H264/i.test(c.mimeType)) ?? [];
  if (h264s.length && 'setCodecPreferences' in transceiver) {
    const isFF = /Firefox/i.test(navigator.userAgent);
    const prefer = isFF
      ? h264s
      : h264s.find((c) => /profile-level-id=42e01f/i.test(c.sdpFmtpLine || ''))
        ? [
            ...h264s.filter((c) =>
              /profile-level-id=42e01f/i.test(c.sdpFmtpLine || ''),
            ),
            ...h264s.filter(
              (c) => !/profile-level-id=42e01f/i.test(c.sdpFmtpLine || ''),
            ),
          ]
        : h264s;
    try {
      transceiver.setCodecPreferences(prefer);
    } catch {}
  }
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
