import type { Input, Layout, ShaderConfig } from '@/app/actions/actions';

export type RoomConfigInput = {
  type: Input['type'];
  title: string;
  description: string;
  volume: number;
  showTitle?: boolean;
  shaders: ShaderConfig[];
  channelId?: string;
  imageId?: string;
  mp4FileName?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  textColor?: string;
  needsConnection?: boolean;
  orientation?: 'horizontal' | 'vertical';
  textMaxLines?: number;
  textScrollSpeed?: number;
  textScrollLoop?: boolean;
  textFontSize?: number;
  attachedInputIndices?: number[];
};

function extractMp4FileName(title: string): string | undefined {
  const match = title.match(/^\[MP4\]\s*(.+)$/);
  if (match) {
    const name = match[1].trim();
    return name.toLowerCase().replace(/\s+/g, '_') + '.mp4';
  }
  return undefined;
}

export type RoomConfigTransitionSettings = {
  swapDurationMs?: number;
  swapOutgoingEnabled?: boolean;
  swapFadeInDurationMs?: number;
  swapFadeOutDurationMs?: number;
  newsStripFadeDuringSwap?: boolean;
};

export type RoomConfig = {
  version: 1;
  layout: Layout;
  inputs: RoomConfigInput[];
  resolution?: { width: number; height: number };
  transitionSettings?: RoomConfigTransitionSettings;
  exportedAt: string;
};

export function exportRoomConfig(
  inputs: Input[],
  layout: Layout,
  resolution?: { width: number; height: number },
  transitionSettings?: RoomConfigTransitionSettings,
): RoomConfig {
  const inputIdToIndex = new Map<string, number>();
  inputs.forEach((input, idx) => inputIdToIndex.set(input.inputId, idx));

  return {
    version: 1,
    layout,
    resolution,
    transitionSettings,
    inputs: inputs.map((input) => ({
      type: input.type,
      title: input.title,
      description: input.description,
      volume: input.volume,
      showTitle: input.showTitle,
      shaders: input.shaders,
      channelId: input.channelId,
      imageId: input.imageId,
      mp4FileName:
        input.type === 'local-mp4'
          ? extractMp4FileName(input.title)
          : undefined,
      text: input.text,
      textAlign: input.textAlign,
      textColor: input.textColor,
      needsConnection: input.type === 'whip',
      orientation: input.orientation,
      textMaxLines: input.textMaxLines,
      textScrollSpeed: input.textScrollSpeed,
      textScrollLoop: input.textScrollLoop,
      textFontSize: input.textFontSize,
      attachedInputIndices: input.attachedInputIds
        ?.map((id) => inputIdToIndex.get(id))
        .filter((idx): idx is number => idx !== undefined),
    })),
    exportedAt: new Date().toISOString(),
  };
}

export function downloadRoomConfig(config: RoomConfig, filename?: string) {
  const json = JSON.stringify(config, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `room-config-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseRoomConfig(json: string): RoomConfig {
  const config = JSON.parse(json);
  if (config.version !== 1) {
    throw new Error(`Unsupported config version: ${config.version}`);
  }
  if (!config.layout || !Array.isArray(config.inputs)) {
    throw new Error('Invalid config format');
  }
  return config as RoomConfig;
}

const PENDING_WHIP_STORAGE_KEY = 'smelter-pending-whip-inputs';

export type StoredPendingWhipInput = {
  id: string;
  title: string;
  config: RoomConfigInput;
  position: number;
};

export function savePendingWhipInputs(
  roomId: string,
  inputs: StoredPendingWhipInput[],
) {
  if (typeof window === 'undefined') return;
  const key = `${PENDING_WHIP_STORAGE_KEY}-${roomId}`;
  try {
    if (inputs.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(inputs));
    }
  } catch (e) {
    console.warn('Failed to save pending WHIP inputs:', e);
  }
}

export function loadPendingWhipInputs(
  roomId: string,
): StoredPendingWhipInput[] {
  if (typeof window === 'undefined') return [];
  const key = `${PENDING_WHIP_STORAGE_KEY}-${roomId}`;
  try {
    const data = localStorage.getItem(key);
    if (data) {
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load pending WHIP inputs:', e);
  }
  return [];
}
