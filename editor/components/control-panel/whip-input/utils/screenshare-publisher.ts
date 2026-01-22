import { attachLocalPreview } from './preview';
import {
  buildIceServers,
  forceH264,
  waitIceComplete,
  wireDebug,
} from './webRTC-helpers';
import { sendWhipOfferLocal } from './whip-api';

export async function startScreensharePublish(
  inputId: string,
  bearerToken: string,
  whipUrl: string,
  pcRef: React.MutableRefObject<RTCPeerConnection | null>,
  streamRef: React.MutableRefObject<MediaStream | null>,
  onDisconnected?: () => void,
): Promise<{ location: string | null }> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      displaySurface: 'monitor',
    } as any,
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  streamRef.current = stream;
  attachLocalPreview(stream);

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
