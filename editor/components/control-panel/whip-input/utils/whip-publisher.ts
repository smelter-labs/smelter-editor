import { attachLocalPreview } from './preview';
import { createRotatedStream, createRotated90Stream } from './rotate-stream';
import {
  buildIceServers,
  forceH264,
  waitIceComplete,
  wireDebug,
} from './webRTC-helpers';
import { sendWhipOfferLocal } from './whip-api';

export type RotationAngle = 0 | 90 | 180 | 270;

let rotateCleanup: (() => void) | null = null;
let currentRotation: RotationAngle = 0;

export function cleanupRotation() {
  rotateCleanup?.();
  rotateCleanup = null;
  currentRotation = 0;
}

export function getCurrentRotation(): RotationAngle {
  return currentRotation;
}

/**
 * Rotate by another 90° CW on an active WHIP connection by replacing the video track.
 * Returns the new rotation angle.
 */
export async function rotateBy90(
  pcRef: React.MutableRefObject<RTCPeerConnection | null>,
  streamRef: React.MutableRefObject<MediaStream | null>,
): Promise<RotationAngle> {
  const pc = pcRef.current;
  const rawStream = streamRef.current;
  if (!pc || !rawStream) return currentRotation;

  const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
  if (!sender) return currentRotation;

  // Clean up previous rotation canvas
  rotateCleanup?.();
  rotateCleanup = null;

  const newAngle = ((currentRotation + 90) % 360) as RotationAngle;

  let newTrack: MediaStreamTrack;
  if (newAngle === 0) {
    newTrack = rawStream.getVideoTracks()[0];
  } else {
    const rotated = createRotatedStream(rawStream, newAngle);
    rotateCleanup = rotated.cleanup;
    newTrack = rotated.stream.getVideoTracks()[0];
  }

  await sender.replaceTrack(newTrack);
  currentRotation = newAngle;
  return newAngle;
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
    currentRotation = 90;
  } else {
    stream = rawStream;
    currentRotation = 0;
  }

  streamRef.current = rawStream;
  attachLocalPreview(rawStream);

  const pc = new RTCPeerConnection({
    iceServers: buildIceServers(),
    bundlePolicy: 'max-bundle',
  });
  pcRef.current = pc;
  wireDebug(pc);

  // Monitor connection state to detect disconnections.
  // Mobile browsers transiently report "disconnected" when the network
  // briefly flaps (e.g. screen off, cell handover). Only treat "failed" and
  // "closed" as terminal; for "disconnected" wait a grace period before
  // firing, and cancel if the connection recovers.
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const DISCONNECT_GRACE_MS = 15_000;

  const clearDisconnectTimer = () => {
    if (disconnectTimer) {
      clearTimeout(disconnectTimer);
      disconnectTimer = null;
    }
  };

  pc.onconnectionstatechange = () => {
    const state = pc.connectionState;
    if (state === 'connected') {
      clearDisconnectTimer();
    } else if (state === 'failed' || state === 'closed') {
      clearDisconnectTimer();
      onDisconnected?.();
    } else if (state === 'disconnected' && !disconnectTimer) {
      disconnectTimer = setTimeout(() => {
        disconnectTimer = null;
        if (pc.connectionState !== 'connected') {
          onDisconnected?.();
        }
      }, DISCONNECT_GRACE_MS);
    }
  };

  pc.oniceconnectionstatechange = () => {
    const state = pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') {
      clearDisconnectTimer();
    } else if (state === 'failed' || state === 'closed') {
      clearDisconnectTimer();
      onDisconnected?.();
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
