'use client';

import {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { Input } from '@/app/actions/actions';
import type { InputWrapper } from '../hooks/use-control-panel-state';
import { SortableItem } from '@/components/control-panel/sortable-list/sortable-item';
import { SortableList } from '@/components/control-panel/sortable-list/sortable-list';
import LoadingSpinner from '@/components/ui/spinner';
import { useControlPanelContext } from '../contexts/control-panel-context';

type TimelinePanelProps = {
  inputWrappers: InputWrapper[];
  listVersion: number;
  showStreamsSpinner: boolean;
  updateOrder: (wrappers: InputWrapper[]) => Promise<void>;
  openFxInputId: string | null;
  onToggleFx: (inputId: string) => void;
  isSwapping?: boolean;
  selectedInputId: string | null;
  isGuest?: boolean;
  guestInputId?: string | null;
};

const TYPE_COLORS: Record<Input['type'], string> = {
  'twitch-channel': 'bg-purple-500',
  'kick-channel': 'bg-green-500',
  whip: 'bg-blue-500',
  'local-mp4': 'bg-orange-500',
  image: 'bg-yellow-500',
  'text-input': 'bg-pink-500',
};

const TRACK_COLORS: Record<Input['type'], string> = {
  'twitch-channel': 'bg-purple-500/30 border-l-purple-500',
  'kick-channel': 'bg-green-500/30 border-l-green-500',
  whip: 'bg-blue-500/30 border-l-blue-500',
  'local-mp4': 'bg-orange-500/30 border-l-orange-500',
  image: 'bg-yellow-500/30 border-l-yellow-500',
  'text-input': 'bg-pink-500/30 border-l-pink-500',
};

const TIME_MARKERS = ['00:00', '01:00', '02:00', '03:00', '04:00'];

const MIN_HEIGHT = 120;
const MAX_HEIGHT_VH = 0.6;
const DEFAULT_HEIGHT = 200;

export function TimelinePanel({
  inputWrappers,
  listVersion,
  showStreamsSpinner,
  updateOrder,
  openFxInputId,
  onToggleFx,
  isSwapping,
  selectedInputId,
  isGuest,
  guestInputId,
}: TimelinePanelProps) {
  const { inputs } = useControlPanelContext();

  const [panelHeight, setPanelHeight] = useState(DEFAULT_HEIGHT);
  const resizingRef = useRef(false);
  const startYRef = useRef(0);
  const startHeightRef = useRef(0);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    inputId: string;
    isMuted: boolean;
  } | null>(null);

  const [isWideScreen, setIsWideScreen] = useState(true);

  useEffect(() => {
    const checkWidth = () => setIsWideScreen(window.innerWidth >= 1600);
    checkWidth();
    window.addEventListener('resize', checkWidth);
    return () => window.removeEventListener('resize', checkWidth);
  }, []);

  const attachedInputIds = useMemo(() => {
    const ids = new Set<string>();
    for (const input of inputs) {
      for (const id of input.attachedInputIds || []) {
        ids.add(id);
      }
    }
    return ids;
  }, [inputs]);

  const visibleWrappers = useMemo(
    () => inputWrappers.filter((w) => !attachedInputIds.has(w.inputId)),
    [inputWrappers, attachedInputIds],
  );

  const handleResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      resizingRef.current = true;
      startYRef.current = e.clientY;
      startHeightRef.current = panelHeight;

      const handleMouseMove = (e: globalThis.MouseEvent) => {
        if (!resizingRef.current) return;
        const delta = startYRef.current - e.clientY;
        const maxHeight = window.innerHeight * MAX_HEIGHT_VH;
        const newHeight = Math.min(
          maxHeight,
          Math.max(MIN_HEIGHT, startHeightRef.current + delta),
        );
        setPanelHeight(newHeight);
      };

      const handleMouseUp = () => {
        resizingRef.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelHeight],
  );

  const handleTrackClick = useCallback((inputId: string) => {
    window.dispatchEvent(
      new CustomEvent('smelter:inputs:select', { detail: { inputId } }),
    );
  }, []);

  const handleContextMenu = useCallback(
    (e: ReactMouseEvent, inputId: string) => {
      e.preventDefault();
      const input = inputs.find((i) => i.inputId === inputId);
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        inputId,
        isMuted: input ? input.volume === 0 : false,
      });
    },
    [inputs],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  useEffect(() => {
    if (!contextMenu) return;

    const handleClick = () => closeContextMenu();
    const handleScroll = () => closeContextMenu();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('click', handleClick);
    window.addEventListener('scroll', handleScroll, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('click', handleClick);
      window.removeEventListener('scroll', handleScroll, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu, closeContextMenu]);

  const handleFx = useCallback(() => {
    if (contextMenu) onToggleFx(contextMenu.inputId);
    closeContextMenu();
  }, [contextMenu, onToggleFx, closeContextMenu]);

  const handleMuteToggle = useCallback(() => {
    if (contextMenu) {
      window.dispatchEvent(
        new CustomEvent('smelter:inputs:toggle-mute', {
          detail: { inputId: contextMenu.inputId },
        }),
      );
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  const handleDelete = useCallback(() => {
    if (contextMenu) {
      window.dispatchEvent(
        new CustomEvent('smelter:inputs:remove', {
          detail: { inputId: contextMenu.inputId },
        }),
      );
    }
    closeContextMenu();
  }, [contextMenu, closeContextMenu]);

  return (
    <div
      className='relative flex flex-col bg-neutral-950 border-t border-neutral-800'
      style={{ height: panelHeight }}>
      <div
        className='h-1 w-full cursor-ns-resize hover:bg-neutral-700 transition-colors shrink-0'
        onMouseDown={handleResizeStart}
      />

      <div className='flex shrink-0'>
        <div className='w-[180px] shrink-0 bg-neutral-900 flex items-center px-3'>
          <span className='text-[11px] text-neutral-500 uppercase tracking-wider font-medium'>
            Sources
          </span>
        </div>
        <div className='flex-1 h-7 bg-neutral-900 border-b border-neutral-800 flex items-end relative'>
          {TIME_MARKERS.map((label, i) => (
            <div
              key={label}
              className='absolute flex flex-col items-center'
              style={{ left: `${(i / (TIME_MARKERS.length - 1)) * 100}%` }}>
              <span className='text-[10px] text-neutral-600 font-mono -translate-x-1/2'>
                {label}
              </span>
              <div className='w-px h-1.5 bg-neutral-700 -translate-x-1/2' />
            </div>
          ))}
        </div>
      </div>

      <div className='flex-1 overflow-y-auto overflow-x-hidden relative'>
        {isSwapping && (
          <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm'>
            <div className='flex items-center gap-2 text-neutral-300 text-sm'>
              <svg
                className='animate-spin h-5 w-5'
                viewBox='0 0 24 24'
                fill='none'>
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                />
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z'
                />
              </svg>
              <span>Transitioning…</span>
            </div>
          </div>
        )}

        {showStreamsSpinner ? (
          <div className='flex items-center justify-center h-32'>
            <LoadingSpinner size='lg' variant='spinner' />
          </div>
        ) : (
          <SortableList
            items={visibleWrappers}
            resetVersion={listVersion}
            disableDrag={isGuest || !isWideScreen}
            renderItem={(item) => {
              const input = inputs.find((i) => i.inputId === item.inputId);
              if (!input) return null;
              const isSelected = selectedInputId === input.inputId;
              const isLive =
                input.sourceState === 'live' ||
                input.sourceState === 'always-live';

              return (
                <SortableItem
                  key={item.inputId}
                  id={item.id}
                  disableDrag={isGuest || !isWideScreen}>
                  <div
                    className='flex h-10 border-b border-neutral-800/50 cursor-pointer'
                    onClick={() => handleTrackClick(input.inputId)}
                    onContextMenu={(e) => handleContextMenu(e, input.inputId)}>
                    <div className='w-[180px] shrink-0 bg-neutral-900 flex items-center gap-2 px-3'>
                      <div
                        className={`w-2.5 h-2.5 rounded-full shrink-0 ${TYPE_COLORS[input.type]}`}
                      />
                      <span className='text-sm text-neutral-200 truncate flex-1'>
                        {input.title}
                      </span>
                      <div
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${isLive ? 'bg-green-500' : 'bg-neutral-500'}`}
                      />
                    </div>
                    <div className='flex-1 flex items-center px-1'>
                      <div
                        className={`w-full h-7 rounded-sm border-l-[3px] flex items-center pl-2 ${TRACK_COLORS[input.type]} ${isSelected ? 'ring-1 ring-blue-400/50' : ''}`}>
                        <span className='text-xs text-neutral-400 truncate'>
                          {input.title}
                        </span>
                      </div>
                    </div>
                  </div>
                </SortableItem>
              );
            }}
            onOrderChange={updateOrder}
          />
        )}
      </div>

      {contextMenu &&
        createPortal(
          <div
            className='fixed z-[9999] bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl py-1 min-w-[160px]'
            style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
              onClick={handleFx}>
              FX / Shaders
            </button>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer'
              onClick={handleMuteToggle}>
              {contextMenu.isMuted ? 'Unmute' : 'Mute'}
            </button>
            <button
              className='w-full text-left py-1.5 px-3 text-sm text-neutral-200 hover:bg-neutral-700 cursor-pointer text-red-400 hover:text-red-300'
              onClick={handleDelete}>
              Delete
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
