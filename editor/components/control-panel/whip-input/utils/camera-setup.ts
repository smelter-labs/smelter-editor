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
  const portrait = settings.orientation === 'portrait';
  const idealW = portrait ? height : width;
  const idealH = portrait ? width : height;

  const constraints: MediaTrackConstraints = {
    width: { ideal: idealW },
    height: { ideal: idealH },
    aspectRatio: { ideal: idealW / idealH },
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

export function orientationToInputOrientation(
  o: CameraOrientation,
): 'horizontal' | 'vertical' {
  return o === 'portrait' ? 'vertical' : 'horizontal';
}
