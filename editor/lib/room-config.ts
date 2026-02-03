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
};

function extractMp4FileName(title: string): string | undefined {
  const match = title.match(/^\[MP4\]\s*(.+)$/);
  if (match) {
    const name = match[1].trim();
    return name.toLowerCase().replace(/\s+/g, '_') + '.mp4';
  }
  return undefined;
}

export type RoomConfig = {
  version: 1;
  layout: Layout;
  inputs: RoomConfigInput[];
  exportedAt: string;
};

export function exportRoomConfig(inputs: Input[], layout: Layout): RoomConfig {
  return {
    version: 1,
    layout,
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
  try {
    sessionStorage.setItem(
      `${PENDING_WHIP_STORAGE_KEY}-${roomId}`,
      JSON.stringify(inputs),
    );
  } catch (e) {
    console.warn('Failed to save pending WHIP inputs:', e);
  }
}

export function loadPendingWhipInputs(
  roomId: string,
): StoredPendingWhipInput[] {
  if (typeof window === 'undefined') return [];
  try {
    const data = sessionStorage.getItem(
      `${PENDING_WHIP_STORAGE_KEY}-${roomId}`,
    );
    if (data) {
      sessionStorage.removeItem(`${PENDING_WHIP_STORAGE_KEY}-${roomId}`);
      return JSON.parse(data);
    }
  } catch (e) {
    console.warn('Failed to load pending WHIP inputs:', e);
  }
  return [];
}
