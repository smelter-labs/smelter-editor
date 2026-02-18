import { attachLocalPreview } from './preview';
import { createRotated90Stream } from './rotate-stream';
import {
  buildIceServers,
  forceH264,
  waitIceComplete,
  wireDebug,
} from './webRTC-helpers';
import { sendWhipOfferLocal } from './whip-api';

let rotateCleanup: (() => void) | null = null;

export function cleanupRotation() {
  rotateCleanup?.();
  rotateCleanup = null;
}

export async function startPublish(
  inputId: string,
  bearerToken: string,
  whipUrl: string,
  pcRef: React.MutableRefObject<RTCPeerConnection | null>,
  streamRef: React.MutableRefObject<MediaStream | null>,
  onDisconnected?: () => void,
  facingMode?: 'user' | 'environment',
  rotate90?: boolean,
): Promise<{ location: string | null }> {
  const rawStream = await navigator.mediaDevices.getUserMedia({
    video: facingMode ? { facingMode } : true,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });

  cleanupRotation();

  let stream: MediaStream;
  if (rotate90) {
    const rotated = createRotated90Stream(rawStream);
    stream = rotated.stream;
    rotateCleanup = rotated.cleanup;
  } else {
    stream = rawStream;
  }

  streamRef.current = rawStream;
  attachLocalPreview(rawStream);

  const pc = new RTCPeerConnection({
    iceServers: buildIceServers(),
    bundlePolicy: 'max-bundle',
  });
  pcRef.current = pc;
  wireDebug(pc);

  // Monitor connection state to detect disconnections
  pc.onconnectionstatechange = () => {
    if (
      pc.connectionState === 'failed' ||
      pc.connectionState === 'disconnected' ||
      pc.connectionState === 'closed'
    ) {
      if (onDisconnected) {
        onDisconnected();
      }
    }
  };

  pc.oniceconnectionstatechange = () => {
    if (
      pc.iceConnectionState === 'failed' ||
      pc.iceConnectionState === 'disconnected' ||
      pc.iceConnectionState === 'closed'
    ) {
      if (onDisconnected) {
        onDisconnected();
      }
    }
  };

  const vTrack = stream.getVideoTracks()[0];
  const aTrack = stream.getAudioTracks()[0];
  const vTx = pc.addTransceiver(vTrack, {
    direction: 'sendonly',
    sendEncodings: [{ maxBitrate: 1_200_000 }],
  });
  if (aTrack) pc.addTransceiver(aTrack, { direction: 'sendonly' });
  forceH264(vTx);

  await pc.setLocalDescription(await pc.createOffer());
  const offerDesc = await waitIceComplete(pc);
  if (!offerDesc?.sdp) throw new Error('No local SDP after ICE gathering');

  const { answer, location } = await sendWhipOfferLocal(
    inputId,
    bearerToken,
    whipUrl,
    offerDesc.sdp,
  );
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });

  return { location };
}
