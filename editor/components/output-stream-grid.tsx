'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

type OutputStreamGridProps = {
  whepUrl: string;
  cols?: number;
  rows?: number;
  gapPx?: number;
};

export default function OutputStreamGrid({
  whepUrl,
  cols = 6,
  rows = 4,
  gapPx = 8,
}: OutputStreamGridProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([]);
  const count = cols * rows;

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const s = await connectLite(whepUrl);
        if (!mounted) return;
        setStream(s);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, [whepUrl]);

  useEffect(() => {
    if (!stream) return;
    // Attach the same stream to all tiles
    for (const vid of videoRefs.current) {
      if (!vid) continue;
      if (vid.srcObject !== stream) {
        vid.srcObject = stream;
        // Mute to avoid audio multiplicity
        vid.muted = true;
        // Best-effort autoplay
        void vid.play().catch(() => {});
      }
    }
  }, [stream, count]);

  const items = useMemo(() => {
    return new Array(count).fill(0).map((_, i) => i);
  }, [count]);

  return (
    <div
      className='w-full'
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gap: gapPx,
      }}>
      {items.map((i) => (
        <div
          key={i}
          className='relative bg-black rounded overflow-hidden aspect-video border-[#414154] border'>
          <video
            ref={(el) => {
              videoRefs.current[i] = el;
            }}
            className='w-full h-full object-cover bg-black'
            playsInline
            autoPlay
            muted
          />
        </div>
      ))}
    </div>
  );
}

async function connectLite(endpointUrl: string): Promise<MediaStream> {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    bundlePolicy: 'max-bundle',
  });

  const tracksPromise = new Promise<{
    video: MediaStreamTrack;
    audio: MediaStreamTrack;
  }>((res) => {
    let videoTrack: undefined | MediaStreamTrack;
    let audioTrack: undefined | MediaStreamTrack;
    pc.ontrack = (ev: RTCTrackEvent) => {
      if (ev.track.kind === 'video') {
        videoTrack = ev.track;
      }
      if (ev.track.kind === 'audio') {
        audioTrack = ev.track;
      }
      if (videoTrack && audioTrack) {
        res({ video: videoTrack, audio: audioTrack });
      }
    };
  });

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  await establishWhipConnectionLite(pc, endpointUrl);

  const tracks = await tracksPromise;
  const stream = new MediaStream();
  stream.addTrack(tracks.video);
  stream.addTrack(tracks.audio);
  return stream;
}

async function establishWhipConnectionLite(
  pc: RTCPeerConnection,
  endpoint: string,
  token?: string,
): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());
  const offer = await gatherICECandidatesLite(pc);
  if (!offer) throw Error('failed to gather ICE candidates for offer');
  const { sdp: sdpAnswer, location } = await postSdpOfferLite(
    endpoint,
    offer.sdp!,
    token,
  );
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp: sdpAnswer }),
  );
  return location ?? endpoint;
}

async function gatherICECandidatesLite(
  peerConnection: RTCPeerConnection,
): Promise<RTCSessionDescription | null> {
  return new Promise<RTCSessionDescription | null>((res) => {
    setTimeout(function () {
      res(peerConnection.localDescription);
    }, 2000);
    peerConnection.onicegatheringstatechange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        res(peerConnection.localDescription);
      }
    };
  });
}

async function postSdpOfferLite(
  endpoint: string,
  sdpOffer: string,
  token?: string,
): Promise<{ sdp: string; location: string }> {
  const response = await fetch(endpoint, {
    method: 'POST',
    mode: 'cors',
    headers: {
      'content-type': 'application/sdp',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: sdpOffer,
  });
  if (response.status === 201) {
    return {
      sdp: await response.text(),
      location: getLocationFromHeaderLite(response.headers, endpoint),
    };
  } else {
    const errorMessage = await response.text();
    throw new Error(errorMessage);
  }
}

function getLocationFromHeaderLite(headers: Headers, endpoint: string): string {
  const locationHeader = headers.get('Location');
  if (!locationHeader) {
    return endpoint;
  }
  return new URL(locationHeader, endpoint).toString();
}
