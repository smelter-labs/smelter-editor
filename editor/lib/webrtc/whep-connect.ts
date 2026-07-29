import {
  getEffectiveClientServerUrl,
  rewriteLoopbackUrlForClient,
} from '@/lib/server-url';
import { buildIceServers } from './index';

const AUDIO_TRACK_WAIT_MS = 2000;
const ICE_GATHER_TIMEOUT_MS = 2000;

export type WhepConnection = {
  stream: MediaStream;
  close: () => void;
};

type ConnectWhepOptions = {
  iceServers?: RTCIceServer[];
  token?: string;
};

/**
 * Connect to a WHEP endpoint and return a MediaStream with video + audio tracks.
 * Adds tracks to the stream as they arrive; waits briefly for audio after video.
 */
export async function connectWhep(
  endpointUrl: string,
  options?: ConnectWhepOptions,
): Promise<WhepConnection> {
  endpointUrl = rewriteLoopbackUrlForClient(
    endpointUrl,
    getEffectiveClientServerUrl(),
  );

  const pc = new RTCPeerConnection({
    iceServers: options?.iceServers ?? buildIceServers(),
    bundlePolicy: 'max-bundle',
  });

  const stream = new MediaStream();
  let videoReceived = false;
  let audioWaitTimer: ReturnType<typeof setTimeout> | null = null;
  let resolveReady: () => void;
  const readyPromise = new Promise<void>((res) => {
    resolveReady = res;
  });

  const clearAudioWait = () => {
    if (audioWaitTimer) {
      clearTimeout(audioWaitTimer);
      audioWaitTimer = null;
    }
  };

  const markReady = () => {
    if (!videoReceived) return;
    clearAudioWait();
    resolveReady();
  };

  pc.ontrack = (ev: RTCTrackEvent) => {
    stream.addTrack(ev.track);
    if (ev.track.kind === 'video') {
      videoReceived = true;
      if (stream.getAudioTracks().length > 0) {
        markReady();
      } else {
        audioWaitTimer = setTimeout(markReady, AUDIO_TRACK_WAIT_MS);
      }
    } else if (ev.track.kind === 'audio' && videoReceived) {
      markReady();
    }
  };

  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  try {
    await pc.setLocalDescription(await pc.createOffer());
    const offer = await gatherIceCandidates(pc);
    if (!offer?.sdp) {
      throw new Error('failed to gather ICE candidates for offer');
    }

    const { sdp: sdpAnswer } = await postSdpOffer(
      endpointUrl,
      offer.sdp,
      options?.token,
    );

    await pc.setRemoteDescription(
      new RTCSessionDescription({ type: 'answer', sdp: sdpAnswer }),
    );

    await readyPromise;

    if (process.env.NODE_ENV === 'development') {
      console.log(
        `[whep] connected audioTracks=${stream.getAudioTracks().length} endpoint=${endpointUrl}`,
      );
    }
  } catch (err) {
    clearAudioWait();
    pc.close();
    stream.getTracks().forEach((track) => track.stop());
    throw err;
  }

  return {
    stream,
    close: () => {
      clearAudioWait();
      stream.getTracks().forEach((track) => track.stop());
      pc.close();
    },
  };
}

async function gatherIceCandidates(
  peerConnection: RTCPeerConnection,
): Promise<RTCSessionDescription | null> {
  return new Promise<RTCSessionDescription | null>((res) => {
    const timeout = setTimeout(() => {
      try {
        res(peerConnection.localDescription);
      } catch {
        res(null);
      }
    }, ICE_GATHER_TIMEOUT_MS);

    peerConnection.onicegatheringstatechange = () => {
      if (peerConnection.iceGatheringState === 'complete') {
        clearTimeout(timeout);
        try {
          res(peerConnection.localDescription);
        } catch {
          res(null);
        }
      }
    };
  });
}

async function postSdpOffer(
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
      location: getLocationFromHeader(response.headers, endpoint),
    };
  }

  throw new Error(await response.text());
}

function getLocationFromHeader(headers: Headers, endpoint: string): string {
  const locationHeader = headers.get('Location');
  if (!locationHeader) {
    return endpoint;
  }
  return new URL(locationHeader, endpoint).toString();
}
