'use client';

import { RefObject, useEffect, useRef, useState, useCallback } from 'react';

import { useIsMobileDevice } from '@/hooks/use-mobile';
import {
  Play as PlayIcon,
  Pause as PauseIcon,
  Volume2 as VolumeIcon,
  VolumeX as MutedIcon,
  Maximize2 as FullscreenIcon,
  Minimize2 as MinimizeIcon,
  RotateCcw as ReplayIcon,
} from 'lucide-react';
import { buildIceServers } from '@/components/control-panel/whip-input/utils/webRTC-helpers';

function LoadingSpinner() {
  return (
    <div className='absolute inset-0 flex items-center justify-center z-20 pointer-events-none'>
      <div className='animate-spin rounded-full h-14 w-14 border-t-4 border-b-4 border-neutral-400 border-opacity-60'></div>
    </div>
  );
}

export type OutputResolution = {
  width: number;
  height: number;
};

export default function OutputStream({
  whepUrl,
  videoRef,
  resolution,
}: {
  whepUrl: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  resolution?: OutputResolution;
}) {
  const aspectRatio = resolution
    ? `${resolution.width}/${resolution.height}`
    : '16/9';
  const isVertical = resolution ? resolution.height > resolution.width : false;
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const isMobile = useIsMobileDevice();

  useEffect(() => {
    connect(whepUrl).then((stream) => {
      const vid = videoRef.current;
      if (vid && vid.srcObject !== stream) {
        vid.srcObject = stream;
        vid.play().then(
          () => setPlaying(true),
          () => setPlaying(false),
        );
      }
    });
  }, [whepUrl, videoRef]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;

    const onTimeUpdate = () => setCurrent(vid.currentTime);
    const onLoadedMetadata = () => {
      setDuration(vid.duration || 0);
      setVideoLoaded(true);
      setPlaying(!vid.paused && !vid.ended);
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolumeChange = () => {
      setMuted(vid.muted || vid.volume === 0);
      setVolume(vid.volume);
    };

    vid.addEventListener('timeupdate', onTimeUpdate);
    vid.addEventListener('loadedmetadata', onLoadedMetadata);
    vid.addEventListener('play', onPlay);
    vid.addEventListener('pause', onPause);
    vid.addEventListener('volumechange', onVolumeChange);

    setMuted(vid.muted || vid.volume === 0);
    setVolume(vid.volume);
    setPlaying(!vid.paused && !vid.ended);

    return () => {
      vid.removeEventListener('timeupdate', onTimeUpdate);
      vid.removeEventListener('loadedmetadata', onLoadedMetadata);
      vid.removeEventListener('play', onPlay);
      vid.removeEventListener('pause', onPause);
      vid.removeEventListener('volumechange', onVolumeChange);
    };
  }, [videoRef.current]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const vid = videoRef.current;
      if (!vid) {
        setIsFullscreen(false);
        return;
      }
      let isNowFullscreen = false;
      if (document.fullscreenElement === vid) {
        isNowFullscreen = true;
      } else if ((document as any).webkitFullscreenElement === vid) {
        isNowFullscreen = true;
      } else if ((document as any).mozFullScreenElement === vid) {
        isNowFullscreen = true;
      } else if ((document as any).msFullscreenElement === vid) {
        isNowFullscreen = true;
      }
      setIsFullscreen(isNowFullscreen);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener(
      'webkitfullscreenchange',
      handleFullscreenChange as EventListener,
    );
    document.addEventListener(
      'mozfullscreenchange',
      handleFullscreenChange as EventListener,
    );
    document.addEventListener(
      'MSFullscreenChange',
      handleFullscreenChange as EventListener,
    );

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        handleFullscreenChange as EventListener,
      );
      document.removeEventListener(
        'mozfullscreenchange',
        handleFullscreenChange as EventListener,
      );
      document.removeEventListener(
        'MSFullscreenChange',
        handleFullscreenChange as EventListener,
      );
    };
  }, [videoRef]);

  const handlePlayPause = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused || vid.ended) {
      vid.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      vid.pause();
    }
  };

  const handleVolumeChange = (v: number) => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.volume = v;
    setVolume(v);
    if (v === 0) {
      vid.muted = true;
      setMuted(true);
    } else {
      vid.muted = false;
      setMuted(false);
    }
  };

  const handleMuteToggle = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.muted = !vid.muted;
    setMuted(vid.muted);
  };

  const handleSeek = (value: number) => {
    const vid = videoRef.current;
    if (!vid || !isFinite(vid.duration)) return;
    vid.currentTime = value;
    setCurrent(value);
  };

  const handleFullscreen = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (
      !document.fullscreenElement &&
      !(document as any).webkitFullscreenElement &&
      !(document as any).mozFullScreenElement &&
      !(document as any).msFullscreenElement
    ) {
      if (vid.requestFullscreen) {
        vid.requestFullscreen();
      } else if ((vid as any).webkitRequestFullscreen) {
        (vid as any).webkitRequestFullscreen();
      } else if ((vid as any).mozRequestFullScreen) {
        (vid as any).mozRequestFullScreen();
      } else if ((vid as any).msRequestFullscreen) {
        (vid as any).msRequestFullscreen();
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      } else if ((document as any).webkitExitFullscreen) {
        (document as any).webkitExitFullscreen();
      } else if ((document as any).mozCancelFullScreen) {
        (document as any).mozCancelFullScreen();
      } else if ((document as any).msExitFullscreen) {
        (document as any).msExitFullscreen();
      }
    }
  };

  const handleReplay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = 0;
    vid.play();
  };

  const formatTime = (s: number) => {
    if (!isFinite(s)) return '--:--';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const controlBar =
    'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-black/20 flex items-center px-4 py-3 gap-3 z-10';
  const button =
    'group hover:bg-white/10 p-2 rounded-none transition cursor-pointer text-white outline-none';
  const slider =
    'h-1.5 rounded-none bg-gray-300 dark:bg-neutral-800 appearance-none transition w-full accent-neutral-400';

  const maxWidth = isVertical ? 600 : 1920;
  const maxHeight = isVertical ? 1080 : 1080;

  return (
    <div
      className='relative w-full h-full bg-black rounded-none overflow-hidden border-[#2a2a2a] border-4'
      style={{
        aspectRatio,
        maxWidth,
        maxHeight,
        margin: isVertical ? '0 auto' : undefined,
      }}>
      {!videoLoaded && (
        <>
          <img src='/video-bg-placeholder.png' alt='Video placeholder' />
          <div className='absolute inset-0 w-full h-full'>
            <LoadingSpinner />
          </div>
        </>
      )}
      <video
        id='videoPlayer'
        data-tour='video-player-container'
        ref={videoRef}
        className='w-full h-full rounded-none object-contain pointer-events-auto select-none bg-black'
        autoPlay
        autoFocus
        playsInline
        controls={isMobile}
        style={{ width: '100%', height: '100%', background: 'black' }}
        tabIndex={-1}
      />
      {videoLoaded && !isMobile && (
        <div
          className={controlBar + ' flex-row justify-between'}
          style={{ userSelect: 'none' }}>
          <div className='flex items-center gap-3'>
            <button
              className={button}
              onClick={handlePlayPause}
              aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? (
                <PauseIcon className='w-6 h-6' />
              ) : (
                <PlayIcon className='w-6 h-6' />
              )}
            </button>

            <span className='text-xs text-white w-12 text-right tabular-nums font-mono mr-1'>
              {formatTime(current)}
            </span>
          </div>
          <div className='flex items-center gap-2 ml-auto'>
            <button
              className={button + ' ml-2'}
              onClick={handleMuteToggle}
              aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted ? (
                <MutedIcon className='w-5 h-5' />
              ) : (
                <VolumeIcon className='w-5 h-5' />
              )}
            </button>
            <input
              type='range'
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className={slider + ' w-24'}
              aria-label='Volume'
              disabled={muted}
              style={{ marginLeft: 2, marginRight: 8, width: '120px' }}
            />

            <button
              className={button}
              onClick={handleFullscreen}
              aria-label={isFullscreen ? 'Minimize video' : 'Fullscreen video'}>
              {isFullscreen ? (
                <MinimizeIcon className='w-5 h-5' />
              ) : (
                <FullscreenIcon className='w-5 h-5' />
              )}
            </button>
          </div>
        </div>
      )}
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

  await establishWhipConnection(pc, endpointUrl);

  const tracks = await tracksPromise;

  const stream = new MediaStream();
  stream.addTrack(tracks.video);
  stream.addTrack(tracks.audio);
  return stream;
}

async function establishWhipConnection(
  pc: RTCPeerConnection,
  endpoint: string,
  token?: string,
): Promise<string> {
  await pc.setLocalDescription(await pc.createOffer());

  const offer = await gatherICECandidates(pc);
  if (!offer) {
    throw Error('failed to gather ICE candidates for offer');
  }

  const { sdp: sdpAnswer, location } = await postSdpOffer(
    endpoint,
    offer.sdp,
    token,
  );

  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: 'answer', sdp: sdpAnswer }),
  );
  return location ?? endpoint;
}

async function gatherICECandidates(
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
  } else {
    const errorMessage = await response.text();
    throw new Error(errorMessage);
  }
}

function getLocationFromHeader(headers: Headers, endpoint: string): string {
  const locationHeader = headers.get('Location');
  if (!locationHeader) {
    return endpoint;
  }
  return new URL(locationHeader, endpoint).toString();
}
