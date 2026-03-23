'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
} from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useControlPanelContext } from '../contexts/control-panel-context';
import { useWhipConnectionsContext } from '../contexts/whip-connections-context';
import { useActions } from '../contexts/actions-context';
import { loadUserName, saveUserName } from '../whip-input/utils/whip-storage';
import { stopCameraAndConnection } from '../whip-input/utils/preview';
import {
  loadWhipSession,
  saveWhipSession,
  saveLastWhipInputId,
} from '../whip-input/utils/whip-storage';
import { startPublish } from '../whip-input/utils/whip-publisher';
import { startScreensharePublish } from '../whip-input/utils/screenshare-publisher';
import {
  addHandsInput,
  getMp4Duration,
} from '@/app/actions/actions';
import { useIsMobileDevice } from '@/hooks/use-mobile';
import { toast } from 'sonner';
import type { ChannelSuggestion, Input } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────

type AssetItemMp4 = { kind: 'mp4'; fileName: string; durationMs?: number };
type AssetItemImage = { kind: 'image'; fileName: string };
type AssetItemTwitch = { kind: 'twitch'; channel: ChannelSuggestion };
type AssetItemKick = { kind: 'kick'; channel: ChannelSuggestion };
type AssetItemAction = {
  kind: 'action';
  actionType:
    | 'text'
    | 'game'
    | 'hands'
    | 'camera'
    | 'screenshare';
};

type AssetItem =
  | AssetItemMp4
  | AssetItemImage
  | AssetItemTwitch
  | AssetItemKick
  | AssetItemAction;

const FILTER_TYPES = [
  'ALL',
  'STREAM',
  'MP4',
  'IMAGE',
  'TEXT',
  'GAME',
  'HANDS',
  'INPUT',
] as const;
type FilterType = (typeof FILTER_TYPES)[number];

const ACTION_CARDS: AssetItemAction[] = [
  { kind: 'action', actionType: 'text' },
  { kind: 'action', actionType: 'game' },
  { kind: 'action', actionType: 'hands' },
  { kind: 'action', actionType: 'camera' },
  { kind: 'action', actionType: 'screenshare' },
];

function itemKey(item: AssetItem): string {
  switch (item.kind) {
    case 'mp4':
      return `mp4:${item.fileName}`;
    case 'image':
      return `image:${item.fileName}`;
    case 'twitch':
      return `twitch:${item.channel.streamId}`;
    case 'kick':
      return `kick:${item.channel.streamId}`;
    case 'action':
      return `action:${item.actionType}`;
  }
}

function itemMatchesFilter(item: AssetItem, filter: FilterType): boolean {
  if (filter === 'ALL') return true;
  switch (filter) {
    case 'STREAM':
      return item.kind === 'twitch' || item.kind === 'kick';
    case 'MP4':
      return item.kind === 'mp4';
    case 'IMAGE':
      return item.kind === 'image';
    case 'TEXT':
      return item.kind === 'action' && item.actionType === 'text';
    case 'GAME':
      return item.kind === 'action' && item.actionType === 'game';
    case 'HANDS':
      return item.kind === 'action' && item.actionType === 'hands';
    case 'INPUT':
      return (
        item.kind === 'action' &&
        (item.actionType === 'camera' || item.actionType === 'screenshare')
      );
  }
}

function itemLabel(item: AssetItem): string {
  switch (item.kind) {
    case 'mp4':
      return item.fileName;
    case 'image':
      return item.fileName;
    case 'twitch':
      return item.channel.displayName;
    case 'kick':
      return item.channel.displayName;
    case 'action':
      return ACTION_TYPE_LABELS[item.actionType];
  }
}

const ACTION_TYPE_LABELS: Record<AssetItemAction['actionType'], string> = {
  text: 'TEXT INPUT',
  game: 'SNAKE GAME',
  hands: 'HAND TRACKING',
  camera: 'CAMERA',
  screenshare: 'SCREENSHARE',
};

function typeBadge(item: AssetItem): string {
  switch (item.kind) {
    case 'mp4':
      return 'MP4';
    case 'image':
      return 'IMG';
    case 'twitch':
      return 'TWITCH';
    case 'kick':
      return 'KICK';
    case 'action':
      return item.actionType.toUpperCase();
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Main Modal ───────────────────────────────────────────────

export function AddVideoModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { roomId, refreshState, inputs } = useControlPanelContext();
  const whipCtx = useWhipConnectionsContext();
  const actions = useActions();

  const [filter, setFilter] = useState<FilterType>('ALL');
  const [selectedItem, setSelectedItem] = useState<AssetItem | null>(null);
  const [items, setItems] = useState<AssetItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const [twitchRes, kickRes, mp4Res, pictureRes] = await Promise.all([
        actions
          .getTwitchSuggestions()
          .catch(() => ({ twitch: [] as ChannelSuggestion[] })),
        actions
          .getKickSuggestions()
          .catch(() => ({ kick: [] as ChannelSuggestion[] })),
        actions.getMP4Suggestions().catch(() => ({ mp4s: [] as string[] })),
        actions
          .getPictureSuggestions()
          .catch(() => ({ pictures: [] as string[] })),
      ]);

      const fetched: AssetItem[] = [
        ...twitchRes.twitch.map(
          (channel): AssetItemTwitch => ({ kind: 'twitch', channel }),
        ),
        ...kickRes.kick.map(
          (channel): AssetItemKick => ({ kind: 'kick', channel }),
        ),
        ...mp4Res.mp4s.map(
          (fileName): AssetItemMp4 => ({ kind: 'mp4', fileName }),
        ),
        ...pictureRes.pictures.map(
          (fileName): AssetItemImage => ({ kind: 'image', fileName }),
        ),
        ...ACTION_CARDS,
      ];

      setItems(fetched);

      // Lazy-load MP4 durations in background
      for (const item of fetched) {
        if (item.kind === 'mp4') {
          getMp4Duration(item.fileName)
            .then((durationMs) => {
              setItems((prev) =>
                prev.map((i) =>
                  i.kind === 'mp4' && i.fileName === item.fileName
                    ? { ...i, durationMs }
                    : i,
                ),
              );
            })
            .catch(() => {});
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, [actions]);

  useEffect(() => {
    if (open) {
      fetchItems();
      setSelectedItem(null);
      setFilter('ALL');
    }
  }, [open, fetchItems]);

  const filteredItems = useMemo(
    () => items.filter((item) => itemMatchesFilter(item, filter)),
    [items, filter],
  );

  const handleDone = useCallback(async () => {
    await refreshState();
    onOpenChange(false);
  }, [refreshState, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-[1100px] w-[95vw] max-h-[85vh] h-[85vh] bg-[#131313]/95 backdrop-blur-sm border border-[#3a494b]/30 p-0 gap-0 overflow-hidden [&>button]:text-[#849495] [&>button]:hover:text-[#e3fdff]'>
        <div className='flex flex-col h-full'>
          {/* Header + Filter */}
          <div className='px-5 pt-5 pb-3 border-b border-[#3a494b]/20'>
            <div className='flex items-center justify-between mb-3 pr-6'>
              <h2 className='font-headline font-bold text-sm tracking-widest text-[#00f3ff] uppercase'>
                ACTIVE_ASSET_REPOSITORY
              </h2>
              <span className='font-mono text-[10px] text-[#fe00fe]'>
                [{filteredItems.length} FILES]
              </span>
            </div>
            <div className='flex gap-1.5 flex-wrap'>
              {FILTER_TYPES.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f);
                    setSelectedItem(null);
                  }}
                  className={`px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                    filter === f
                      ? 'bg-[#00f3ff] text-black font-bold'
                      : 'bg-[#1c1b1b] text-[#849495] hover:text-[#e3fdff] border border-[#3a494b]/20'
                  }`}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          {/* Body: Grid + Inspector */}
          <div className='flex flex-1 min-h-0'>
            {/* Left: Asset Grid */}
            <div className='flex-1 overflow-y-auto p-4'>
              {isLoading ? (
                <div className='flex items-center justify-center h-40'>
                  <span className='font-mono text-xs text-[#849495] animate-pulse'>
                    SCANNING_ASSETS...
                  </span>
                </div>
              ) : filteredItems.length === 0 ? (
                <div className='flex items-center justify-center h-40'>
                  <span className='font-mono text-xs text-[#849495]'>
                    NO_ASSETS_FOUND
                  </span>
                </div>
              ) : (
                <div className='grid grid-cols-2 lg:grid-cols-3 gap-3'>
                  {filteredItems.map((item) => (
                    <AssetCard
                      key={itemKey(item)}
                      item={item}
                      isSelected={
                        selectedItem !== null &&
                        itemKey(selectedItem) === itemKey(item)
                      }
                      onClick={() => setSelectedItem(item)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Right: Property Inspector */}
            <div className='w-80 border-l border-[#3a494b]/20 bg-[#0e0e0e] flex flex-col overflow-y-auto'>
              <div className='flex items-center gap-2 px-5 pt-5 pb-4'>
                <span className='text-[#fe00fe] text-sm'>&#9881;</span>
                <h3 className='font-headline font-bold text-[11px] tracking-widest uppercase text-[#e3fdff]'>
                  Property_Inspector
                </h3>
              </div>
              <div className='flex-1 px-5 pb-5'>
                {selectedItem ? (
                  <PropertyInspector
                    item={selectedItem}
                    roomId={roomId}
                    inputs={inputs}
                    onDone={handleDone}
                    whipCtx={whipCtx}
                  />
                ) : (
                  <div className='flex items-center justify-center h-32'>
                    <span className='font-mono text-[10px] text-[#849495]'>
                      SELECT_ASSET_TO_INSPECT
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Asset Card ───────────────────────────────────────────────

function AssetCard({
  item,
  isSelected,
  onClick,
}: {
  item: AssetItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const badge = typeBadge(item);
  const label = itemLabel(item);

  const durationBadge =
    item.kind === 'mp4' && item.durationMs != null
      ? formatDuration(item.durationMs)
      : null;

  const subtitle = (() => {
    switch (item.kind) {
      case 'twitch':
        return item.channel.category || item.channel.title;
      case 'kick':
        return item.channel.category || item.channel.title;
      case 'mp4': {
        const ext = item.fileName.split('.').pop()?.toUpperCase() ?? '';
        return ext;
      }
      case 'image': {
        const ext = item.fileName.split('.').pop()?.toUpperCase() ?? '';
        return ext;
      }
      case 'action':
        return 'ACTION';
      default:
        return '';
    }
  })();

  return (
    <button
      onClick={onClick}
      className={`text-left bg-[#1c1b1b] border border-[#3a494b]/30 hover:border-[#00f3ff]/60 group transition-all cursor-pointer ${
        isSelected ? 'border-l-2 border-l-[#fe00fe] neon-glow-secondary' : ''
      }`}>
      <div className='relative aspect-video bg-black overflow-hidden'>
        <AssetThumbnail item={item} />
        <div className='absolute inset-0 scanline opacity-30' />
        <div className='absolute top-1.5 left-1.5 px-1 bg-black/80 text-[10px] font-mono text-[#00f3ff] border border-[#00f3ff]/30'>
          {badge}
        </div>
        {durationBadge && (
          <div className='absolute bottom-1.5 right-1.5 px-1 bg-black/80 text-[10px] font-mono text-[#fe00fe]'>
            {durationBadge}
          </div>
        )}
      </div>
      <div className='p-2 border-t border-[#3a494b]/20'>
        <div className='font-mono text-[11px] text-[#e3fdff] mb-0.5 truncate'>
          {label}
        </div>
        {subtitle && (
          <div className='font-mono text-[10px] text-[#849495] truncate'>
            {subtitle}
          </div>
        )}
      </div>
    </button>
  );
}

// ── Thumbnail renderers ──────────────────────────────────────

function AssetThumbnail({ item }: { item: AssetItem }) {
  if (item.kind === 'mp4') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/mp4-thumbnail/${encodeURIComponent(item.fileName)}`}
        alt={item.fileName}
        className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
      />
    );
  }
  if (item.kind === 'image') {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/pictures/${encodeURIComponent(item.fileName)}`}
        alt={item.fileName}
        className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
      />
    );
  }
  if (item.kind === 'twitch') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#9146FF]/20 to-[#131313]'>
        <svg
          viewBox='0 0 256 268'
          className='w-10 h-10 opacity-50 group-hover:opacity-70 transition-opacity'
          fill='none'>
          <path
            d='M17.458 0L0 46.556v185.262h63.983V268h46.175l36.2-36.182h54.3L256 176.73V0H17.458zm23.395 23.395h192.17v138.89l-40.645 40.644h-63.983l-36.183 36.183v-36.183H40.853V23.395zm77.29 40.072v77.29h23.396v-77.29h-23.395zm63.984 0v77.29h23.395v-77.29h-23.395z'
            fill='#9146FF'
          />
        </svg>
      </div>
    );
  }
  if (item.kind === 'kick') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#53FC18]/15 to-[#131313]'>
        <span className='font-mono font-black text-xl text-[#53FC18]/50 tracking-tighter group-hover:text-[#53FC18]/70 transition-colors'>
          K
        </span>
      </div>
    );
  }
  if (item.kind === 'action') {
    return <ActionThumbnail actionType={item.actionType} />;
  }
  return null;
}

function ActionThumbnail({
  actionType,
}: {
  actionType: AssetItemAction['actionType'];
}) {
  switch (actionType) {
    case 'text':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#00f3ff]/10 to-[#131313]'>
          <svg viewBox='0 0 80 50' className='w-16 h-10 opacity-40'>
            <rect x='8' y='10' width='64' height='2' rx='1' fill='#00f3ff' />
            <rect x='8' y='18' width='50' height='2' rx='1' fill='#00f3ff' />
            <rect x='8' y='26' width='58' height='2' rx='1' fill='#00f3ff' />
            <rect x='8' y='34' width='30' height='2' rx='1' fill='#00f3ff' />
            <text
              x='40'
              y='48'
              textAnchor='middle'
              fill='#00f3ff'
              fontSize='8'
              fontFamily='monospace'
              opacity='0.6'>
              Aa
            </text>
          </svg>
        </div>
      );
    case 'game':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#fe00fe]/10 to-[#131313]'>
          <svg viewBox='0 0 80 50' className='w-16 h-10 opacity-40'>
            {/* grid */}
            {[0, 1, 2, 3, 4, 5, 6, 7].map((c) =>
              [0, 1, 2, 3, 4].map((r) => (
                <rect
                  key={`${c}-${r}`}
                  x={5 + c * 9}
                  y={5 + r * 9}
                  width='8'
                  height='8'
                  rx='1'
                  fill='#1c1b1b'
                  stroke='#3a494b'
                  strokeWidth='0.5'
                />
              )),
            )}
            {/* snake path */}
            <rect x='23' y='14' width='8' height='8' rx='1' fill='#53FC18' />
            <rect x='32' y='14' width='8' height='8' rx='1' fill='#53FC18' />
            <rect x='41' y='14' width='8' height='8' rx='1' fill='#53FC18' />
            <rect
              x='41'
              y='23'
              width='8'
              height='8'
              rx='1'
              fill='#53FC18'
              opacity='0.7'
            />
            <rect
              x='41'
              y='32'
              width='8'
              height='8'
              rx='1'
              fill='#53FC18'
              opacity='0.5'
            />
            {/* apple */}
            <rect x='59' y='32' width='8' height='8' rx='1' fill='#fe00fe' />
          </svg>
        </div>
      );
    case 'hands':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#fe00fe]/10 to-[#131313]'>
          <svg viewBox='0 0 60 70' className='w-10 h-12 opacity-35'>
            <path
              d='M30 5 L30 25 M22 8 L22 22 M14 12 L14 22 M38 8 L38 22 M46 12 L46 22 M14 22 Q14 30 18 35 L18 50 Q18 58 24 62 L36 62 Q42 58 42 50 L42 35 Q46 30 46 22'
              stroke='#fe00fe'
              strokeWidth='2.5'
              fill='none'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            {/* joint dots */}
            {[
              [30, 25],
              [22, 22],
              [14, 22],
              [38, 22],
              [46, 22],
            ].map(([x, y], i) => (
              <circle key={i} cx={x} cy={y} r='2' fill='#00f3ff' />
            ))}
          </svg>
        </div>
      );
    case 'camera':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#00f3ff]/10 to-[#131313]'>
          <svg viewBox='0 0 60 60' className='w-10 h-10 opacity-35'>
            <circle
              cx='30'
              cy='30'
              r='22'
              stroke='#00f3ff'
              strokeWidth='2'
              fill='none'
            />
            <circle
              cx='30'
              cy='30'
              r='14'
              stroke='#00f3ff'
              strokeWidth='1.5'
              fill='none'
              opacity='0.6'
            />
            <circle cx='30' cy='30' r='4' fill='#00f3ff' opacity='0.8' />
            <line
              x1='30'
              y1='2'
              x2='30'
              y2='12'
              stroke='#00f3ff'
              strokeWidth='1'
              opacity='0.4'
            />
            <line
              x1='30'
              y1='48'
              x2='30'
              y2='58'
              stroke='#00f3ff'
              strokeWidth='1'
              opacity='0.4'
            />
            <line
              x1='2'
              y1='30'
              x2='12'
              y2='30'
              stroke='#00f3ff'
              strokeWidth='1'
              opacity='0.4'
            />
            <line
              x1='48'
              y1='30'
              x2='58'
              y2='30'
              stroke='#00f3ff'
              strokeWidth='1'
              opacity='0.4'
            />
          </svg>
        </div>
      );
    case 'screenshare':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#00f3ff]/10 to-[#131313]'>
          <svg viewBox='0 0 64 50' className='w-12 h-9 opacity-35'>
            <rect
              x='4'
              y='2'
              width='56'
              height='36'
              rx='2'
              stroke='#00f3ff'
              strokeWidth='2'
              fill='none'
            />
            <line
              x1='24'
              y1='38'
              x2='24'
              y2='46'
              stroke='#00f3ff'
              strokeWidth='2'
            />
            <line
              x1='40'
              y1='38'
              x2='40'
              y2='46'
              stroke='#00f3ff'
              strokeWidth='2'
            />
            <line
              x1='18'
              y1='46'
              x2='46'
              y2='46'
              stroke='#00f3ff'
              strokeWidth='2'
              strokeLinecap='round'
            />
            <polygon points='32,10 40,22 24,22' fill='#00f3ff' opacity='0.6' />
          </svg>
        </div>
      );
  }
}

// ── Property Inspector ───────────────────────────────────────

function PropertyInspector({
  item,
  roomId,
  inputs,
  onDone,
  whipCtx,
}: {
  item: AssetItem;
  roomId: string;
  inputs: Input[];
  onDone: () => Promise<void>;
  whipCtx: ReturnType<typeof useWhipConnectionsContext>;
}) {
  switch (item.kind) {
    case 'mp4':
      return <Mp4Inspector item={item} roomId={roomId} onDone={onDone} />;
    case 'image':
      return <ImageInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'twitch':
      return <TwitchInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'kick':
      return <KickInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'action':
      return (
        <ActionInspector
          item={item}
          roomId={roomId}
          inputs={inputs}
          onDone={onDone}
          whipCtx={whipCtx}
        />
      );
  }
}

// ── Shared UI pieces ─────────────────────────────────────────

function PropRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between text-[10px] font-mono tracking-tight'>
      <span className='text-[#849495]'>{label}</span>
      <span className='text-[#00f3ff] truncate ml-2 text-right max-w-[140px]'>
        {value}
      </span>
    </div>
  );
}

function InitiateButton({
  label,
  onClick,
  disabled,
  loading,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className='w-full mt-4 py-2 bg-[#00f3ff] text-black font-mono text-[11px] font-bold uppercase tracking-widest hover:neon-glow-primary transition-all disabled:opacity-40 disabled:cursor-not-allowed'>
      {loading ? 'PROCESSING...' : label}
    </button>
  );
}

// ── Type-specific Inspectors ─────────────────────────────────

function Mp4Inspector({
  item,
  roomId,
  onDone,
}: {
  item: AssetItemMp4;
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addMP4Input } = useActions();
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addMP4Input(roomId, item.fileName);
      await onDone();
    } catch {
      toast.error('Failed to add MP4 input.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <PropRow label='FILENAME' value={item.fileName} />
      {item.durationMs != null && (
        <PropRow label='DURATION' value={formatDuration(item.durationMs)} />
      )}
      <PropRow
        label='FORMAT'
        value={item.fileName.split('.').pop()?.toUpperCase() ?? 'MP4'}
      />
      <InitiateButton
        label='INITIATE_FEED'
        onClick={handleAdd}
        loading={loading}
      />
    </div>
  );
}

function ImageInspector({
  item,
  roomId,
  onDone,
}: {
  item: AssetItemImage;
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addImageInput } = useActions();
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addImageInput(roomId, item.fileName);
      await onDone();
    } catch {
      toast.error('Failed to add image input.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <PropRow label='FILENAME' value={item.fileName} />
      <PropRow
        label='FORMAT'
        value={item.fileName.split('.').pop()?.toUpperCase() ?? 'IMG'}
      />
      {/* Thumbnail preview */}
      <div className='relative aspect-video bg-black overflow-hidden border border-[#3a494b]/30'>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/pictures/${encodeURIComponent(item.fileName)}`}
          alt={item.fileName}
          className='w-full h-full object-contain'
        />
        <div className='absolute inset-0 scanline opacity-20' />
      </div>
      <InitiateButton
        label='INITIATE_FEED'
        onClick={handleAdd}
        loading={loading}
      />
    </div>
  );
}

function TwitchInspector({
  item,
  roomId,
  onDone,
}: {
  item: AssetItemTwitch;
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addTwitchInput } = useActions();
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addTwitchInput(roomId, item.channel.streamId);
      await onDone();
    } catch {
      toast.error(`Failed to add "${item.channel.displayName}" stream.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <PropRow label='CHANNEL' value={item.channel.displayName} />
      <PropRow label='STREAM_ID' value={item.channel.streamId} />
      {item.channel.title && (
        <div className='space-y-1'>
          <span className='text-[10px] font-mono text-[#849495]'>TITLE</span>
          <p className='text-[10px] font-mono text-[#e3fdff] leading-tight break-words'>
            {item.channel.title}
          </p>
        </div>
      )}
      {item.channel.category && (
        <PropRow label='CATEGORY' value={item.channel.category} />
      )}
      <PropRow label='PLATFORM' value='TWITCH.TV' />
      <InitiateButton
        label='INITIATE_STREAM'
        onClick={handleAdd}
        loading={loading}
      />
    </div>
  );
}

function KickInspector({
  item,
  roomId,
  onDone,
}: {
  item: AssetItemKick;
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addKickInput } = useActions();
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addKickInput(roomId, item.channel.streamId);
      await onDone();
    } catch {
      toast.error(`Failed to add "${item.channel.displayName}" stream.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <PropRow label='CHANNEL' value={item.channel.displayName} />
      <PropRow label='STREAM_ID' value={item.channel.streamId} />
      {item.channel.title && (
        <div className='space-y-1'>
          <span className='text-[10px] font-mono text-[#849495]'>TITLE</span>
          <p className='text-[10px] font-mono text-[#e3fdff] leading-tight break-words'>
            {item.channel.title}
          </p>
        </div>
      )}
      {item.channel.category && (
        <PropRow label='CATEGORY' value={item.channel.category} />
      )}
      <PropRow label='PLATFORM' value='KICK.COM' />
      <InitiateButton
        label='INITIATE_STREAM'
        onClick={handleAdd}
        loading={loading}
      />
    </div>
  );
}

// ── Action Inspector (text, game, eq, hands, camera, screenshare) ──

function ActionInspector({
  item,
  roomId,
  inputs,
  onDone,
  whipCtx,
}: {
  item: AssetItemAction;
  roomId: string;
  inputs: Input[];
  onDone: () => Promise<void>;
  whipCtx: ReturnType<typeof useWhipConnectionsContext>;
}) {
  switch (item.actionType) {
    case 'text':
      return <TextActionInspector roomId={roomId} onDone={onDone} />;
    case 'game':
      return <GameActionInspector roomId={roomId} onDone={onDone} />;
    case 'hands':
      return (
        <HandsActionInspector roomId={roomId} inputs={inputs} onDone={onDone} />
      );
    case 'camera':
      return (
        <WhipActionInspector
          kind='camera'
          roomId={roomId}
          onDone={onDone}
          pcRef={whipCtx.cameraPcRef}
          streamRef={whipCtx.cameraStreamRef}
          setActiveWhipInputId={whipCtx.setActiveCameraInputId}
          setIsWhipActive={whipCtx.setIsCameraActive}
        />
      );
    case 'screenshare':
      return (
        <WhipActionInspector
          kind='screenshare'
          roomId={roomId}
          onDone={onDone}
          pcRef={whipCtx.screensharePcRef}
          streamRef={whipCtx.screenshareStreamRef}
          setActiveWhipInputId={whipCtx.setActiveScreenshareInputId}
          setIsWhipActive={whipCtx.setIsScreenshareActive}
        />
      );
  }
}

function TextActionInspector({
  roomId,
  onDone,
}: {
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addTextInput } = useActions();
  const [text, setText] = useState('');
  const [align, setAlign] = useState<'left' | 'center' | 'right'>('left');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!text.trim()) {
      toast.error('Enter text content.');
      return;
    }
    setLoading(true);
    try {
      await addTextInput(roomId, text, align);
      await onDone();
    } catch {
      toast.error('Failed to add text input.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          TEXT_CONTENT
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          className='w-full bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] p-2 resize-none focus:border-[#00f3ff]/50 focus:outline-none'
          placeholder='Enter text...'
        />
      </div>
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          ALIGNMENT
        </span>
        <div className='grid grid-cols-3 gap-0'>
          {(['left', 'center', 'right'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAlign(a)}
              className={`py-1.5 text-[10px] font-mono uppercase ${
                align === a
                  ? 'bg-[#00f3ff] text-black font-bold'
                  : 'bg-[#1c1b1b] border border-[#3a494b]/20 text-[#849495] hover:text-[#00f3ff]'
              }`}>
              {a}
            </button>
          ))}
        </div>
      </div>
      <InitiateButton
        label='INITIATE_TEXT'
        onClick={handleAdd}
        loading={loading}
      />
    </div>
  );
}

function GameActionInspector({
  roomId,
  onDone,
}: {
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addSnakeGameInput } = useActions();
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addSnakeGameInput(roomId, title || undefined);
      await onDone();
    } catch {
      toast.error('Failed to add game input.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          GAME_TITLE
        </span>
        <input
          type='text'
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className='w-full bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] px-2 py-1.5 focus:border-[#00f3ff]/50 focus:outline-none'
          placeholder='Snake Game'
        />
      </div>
      <PropRow label='TYPE' value='SNAKE_GAME' />
      <InitiateButton
        label='INITIATE_GAME'
        onClick={handleAdd}
        loading={loading}
      />
    </div>
  );
}

const VIDEO_TYPES = new Set([
  'local-mp4',
  'twitch-channel',
  'kick-channel',
  'whip',
]);

function HandsActionInspector({
  roomId,
  inputs,
  onDone,
}: {
  roomId: string;
  inputs: Input[];
  onDone: () => Promise<void>;
}) {
  const videoInputs = inputs.filter(
    (i) => VIDEO_TYPES.has(i.type) && i.status === 'connected',
  );
  const [selectedInputId, setSelectedInputId] = useState(
    videoInputs[0]?.inputId ?? '',
  );
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    if (!selectedInputId) {
      toast.error('Select a video input source.');
      return;
    }
    setLoading(true);
    try {
      await addHandsInput(roomId, selectedInputId);
      await onDone();
    } catch {
      toast.error('Failed to add hand tracking input.');
    } finally {
      setLoading(false);
    }
  };

  if (videoInputs.length === 0) {
    return (
      <div className='space-y-3'>
        <PropRow label='TYPE' value='HAND_TRACKING' />
        <p className='font-mono text-[10px] text-[#849495]'>
          No connected video inputs. Add a video source first.
        </p>
      </div>
    );
  }

  return (
    <div className='space-y-3'>
      <PropRow label='TYPE' value='HAND_TRACKING' />
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          SOURCE_INPUT
        </span>
        <select
          value={selectedInputId}
          onChange={(e) => setSelectedInputId(e.target.value)}
          className='w-full bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] px-2 py-1.5 focus:border-[#00f3ff]/50 focus:outline-none'>
          {videoInputs.map((input) => (
            <option key={input.inputId} value={input.inputId}>
              {input.title}
            </option>
          ))}
        </select>
      </div>
      <InitiateButton
        label='INITIATE_TRACKING'
        onClick={handleAdd}
        loading={loading}
        disabled={!selectedInputId}
      />
    </div>
  );
}

// ── WHIP (Camera / Screenshare) Inspector ────────────────────

function WhipActionInspector({
  kind,
  roomId,
  onDone,
  pcRef,
  streamRef,
  setActiveWhipInputId,
  setIsWhipActive,
}: {
  kind: 'camera' | 'screenshare';
  roomId: string;
  onDone: () => Promise<void>;
  pcRef: MutableRefObject<RTCPeerConnection | null>;
  streamRef: MutableRefObject<MediaStream | null>;
  setActiveWhipInputId: (id: string | null) => void;
  setIsWhipActive: (active: boolean) => void;
}) {
  const { addCameraInput } = useActions();
  const isMobileDevice = useIsMobileDevice();

  const [userName, setUserNameLocal] = useState<string>(() => {
    const saved = loadUserName(roomId);
    if (saved) {
      return kind === 'screenshare'
        ? saved
            .replace(/\s+Camera$/i, ' Screenshare')
            .replace(/^User\s+/i, 'Screenshare ')
        : saved;
    }
    if (typeof window !== 'undefined') {
      const storedName = localStorage.getItem('smelter-display-name');
      if (storedName)
        return `${storedName} ${kind === 'camera' ? 'Camera' : 'Screenshare'}`;
    }
    return `User ${Math.floor(1000 + Math.random() * 9000)}`;
  });
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    const cleanedName = userName.trim();
    if (!cleanedName) {
      toast.error('Please enter a username.');
      return;
    }
    setLoading(true);
    try {
      const response = await addCameraInput(roomId, cleanedName);
      setActiveWhipInputId(response.inputId);
      setIsWhipActive(false);

      const onDisconnected = () => {
        stopCameraAndConnection(pcRef, streamRef);
        setIsWhipActive(false);
      };

      let location: string | null;
      if (kind === 'camera') {
        const result = await startPublish(
          response.inputId,
          response.bearerToken,
          response.whipUrl,
          pcRef,
          streamRef,
          onDisconnected,
          isMobileDevice ? facingMode : undefined,
          false,
        );
        location = result.location;
      } else {
        const result = await startScreensharePublish(
          response.inputId,
          response.bearerToken,
          response.whipUrl,
          pcRef,
          streamRef,
          onDisconnected,
        );
        location = result.location;
      }

      setIsWhipActive(true);
      saveWhipSession({
        roomId,
        inputId: response.inputId,
        bearerToken: response.bearerToken,
        location,
        ts: Date.now(),
      });
      saveLastWhipInputId(roomId, response.inputId);
      saveUserName(roomId, cleanedName);
      await onDone();
    } catch (e: any) {
      console.error(`${kind} add failed:`, e);
      toast.error(`Failed to add ${kind}: ${e?.message || e}`);
      stopCameraAndConnection(pcRef, streamRef);
      setActiveWhipInputId(null);
      setIsWhipActive(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <PropRow
        label='TYPE'
        value={kind === 'camera' ? 'WHIP_CAMERA' : 'WHIP_SCREENSHARE'}
      />
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          USERNAME
        </span>
        <input
          type='text'
          value={userName}
          onChange={(e) => setUserNameLocal(e.target.value)}
          className='w-full bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] px-2 py-1.5 focus:border-[#00f3ff]/50 focus:outline-none'
          placeholder='Enter a username'
        />
      </div>
      {kind === 'camera' && isMobileDevice && (
        <div>
          <span className='text-[10px] font-mono text-[#849495] block mb-1'>
            CAMERA_FACING
          </span>
          <div className='grid grid-cols-2 gap-0'>
            {(['user', 'environment'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => setFacingMode(mode)}
                className={`py-1.5 text-[10px] font-mono uppercase ${
                  facingMode === mode
                    ? 'bg-[#00f3ff] text-black font-bold'
                    : 'bg-[#1c1b1b] border border-[#3a494b]/20 text-[#849495] hover:text-[#00f3ff]'
                }`}>
                {mode === 'user' ? 'FRONT' : 'BACK'}
              </button>
            ))}
          </div>
        </div>
      )}
      <InitiateButton
        label='CONNECT_FEED'
        onClick={handleAdd}
        loading={loading}
        disabled={!userName.trim()}
      />
    </div>
  );
}
