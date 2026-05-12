export type ResolutionPreset = '480p' | '720p' | '1080p';
export type CameraOrientation = 'portrait' | 'landscape';

export const RESOLUTION_PRESETS: Record<
  ResolutionPreset,
  { width: number; height: number }
> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

export type GuestCameraSettings = {
  facingMode: 'user' | 'environment';
  deviceId?: string;
  resolution: ResolutionPreset;
  orientation: CameraOrientation;
  mirror: boolean;
};

export type StreamNativeResolution = {
  orientation: CameraOrientation;
  nativeWidth: number;
  nativeHeight: number;
};

export function detectDefaultOrientation(): CameraOrientation {
  if (typeof window === 'undefined') return 'landscape';
  try {
    const type = window.screen?.orientation?.type;
    if (type) return type.startsWith('portrait') ? 'portrait' : 'landscape';
  } catch {}
  try {
    if (window.matchMedia('(orientation: portrait)').matches) return 'portrait';
  } catch {}
  return 'landscape';
}

export function buildVideoConstraints(
  settings: GuestCameraSettings,
): MediaTrackConstraints {
  const { width, height } = RESOLUTION_PRESETS[settings.resolution];

  const constraints: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    aspectRatio: { ideal: width / height },
  };

  if (settings.deviceId) {
    constraints.deviceId = { exact: settings.deviceId };
  } else {
    constraints.facingMode = settings.facingMode;
  }

  return constraints;
}

export async function acquireUserMediaForSettings(
  settings: GuestCameraSettings,
): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: buildVideoConstraints(settings),
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
}

export async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    return [];
  }
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  } catch {
    return [];
  }
}

export function detectStreamOrientation(
  stream: MediaStream,
): CameraOrientation {
  return getStreamNativeResolution(stream).orientation;
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getFallbackNativeResolution(
  settings?: GuestCameraSettings,
): StreamNativeResolution {
  const orientation = settings?.orientation ?? 'landscape';
  const { width, height } = RESOLUTION_PRESETS[settings?.resolution ?? '720p'];

  return orientation === 'portrait'
    ? { orientation, nativeWidth: height, nativeHeight: width }
    : { orientation, nativeWidth: width, nativeHeight: height };
}

export function getStreamNativeResolution(
  stream: MediaStream,
  fallbackSettings?: GuestCameraSettings,
): StreamNativeResolution {
  const fallback = getFallbackNativeResolution(fallbackSettings);
  const track = stream.getVideoTracks()[0];
  if (!track) return fallback;
  const settings = track.getSettings();
  const width = isPositiveFiniteNumber(settings.width)
    ? Math.round(settings.width)
    : fallback.nativeWidth;
  const height = isPositiveFiniteNumber(settings.height)
    ? Math.round(settings.height)
    : fallback.nativeHeight;

  return {
    orientation: height > width ? 'portrait' : 'landscape',
    nativeWidth: width,
    nativeHeight: height,
  };
}

/**
 * Aligns reported width/height with the user's chosen portrait/landscape so
 * server layout metadata matches intent when mobile exposes pre-rotation dimensions.
 */
export function alignNativeResolutionToCameraOrientation(
  raw: StreamNativeResolution,
  semantic: CameraOrientation,
): StreamNativeResolution {
  const landscapePixels = raw.nativeWidth >= raw.nativeHeight;
  const wantLandscape = semantic === 'landscape';

  if (landscapePixels === wantLandscape) {
    return { ...raw, orientation: semantic };
  }

  return {
    orientation: semantic,
    nativeWidth: raw.nativeHeight,
    nativeHeight: raw.nativeWidth,
  };
}

export function orientationToInputOrientation(
  o: CameraOrientation,
): 'horizontal' | 'vertical' {
  return o === 'portrait' ? 'vertical' : 'horizontal';
}
