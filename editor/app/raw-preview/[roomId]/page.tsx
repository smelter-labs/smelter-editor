'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';

import { getRoomInfo, type RoomState } from '@/app/actions/actions';
import { buildIceServers } from '@/components/control-panel/whip-input/utils/webRTC-helpers';

export default function RawPreviewPage() {
  const router = useRouter();
  const { roomId } = useParams();
  const [whepUrl, setWhepUrl] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    let mounted = true;
    const fetchState = async () => {
      if (!roomId) {
        if (mounted) router.replace('/');
        return;
      }

      const state = await getRoomInfo(roomId as string);
      if (!mounted) return;

      if (state === 'not-found') {
        router.replace('/');
        return;
      }

      setWhepUrl(state.whepUrl);
    };
    void fetchState();
    return () => {
      mounted = false;
    };
  }, [roomId, router]);

  useEffect(() => {
    if (!whepUrl) return;

    connect(whepUrl).then((stream) => {
      const vid = videoRef.current;
      if (vid && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().catch(() => {});
      }
    });
  }, [whepUrl]);

  return (
    <div className='fixed inset-0 bg-black'>
      <video
        ref={videoRef}
        className='w-full h-full object-contain'
        autoPlay
        playsInline
        muted={false}
      />
    </div>
  );
}

async function connect(endpointUrl: string): Promise<MediaStream> {
  const pc = new RTCPeerConnection({
    iceServers: buildIceServers(),
    bundlePolicy: 'max-bundle',
  });

  const tracksPromise = new Promise<{
    video: MediaStreamTrack;
    audio: MediaStreamTrack;
  }>((res) => {
    let videoTrack: undefined | MediaStreamTrack;
    let audioTrack: undefined | MediaStreamTrack;
    pc.ontrack = (ev: RTCTrackEvent) => {
      if (ev.track.kind === 'video') videoTrack = ev.track;
      if (ev.track.kind === 'audio') audioTrack = ev.track;
      if (videoTrack && audioTrack)
        res({ video: videoTrack, audio: audioTrack });
    };
  });

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const gathered = await new Promise<RTCSessionDescription | null>((res) => {
    setTimeout(() => res(pc.localDescription), 2000);
    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete') res(pc.localDescription);
    };
  });

  if (!gathered?.sdp) throw new Error('Failed to gather ICE candidates');

  const response = await fetch(endpointUrl, {
    method: 'POST',
    mode: 'cors',
    headers: { 'content-type': 'application/sdp' },
    body: gathered.sdp,
  });

  if (response.status !== 201) {
    throw new Error(await response.text());
  }

  const sdpAnswer = await response.text();
  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp: sdpAnswer }),
  );

  const tracks = await tracksPromise;
  const stream = new MediaStream();
  stream.addTrack(tracks.video);
  stream.addTrack(tracks.audio);
  return stream;
}
