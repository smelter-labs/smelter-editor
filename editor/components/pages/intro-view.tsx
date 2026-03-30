'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

import StatusLabel from '@/components/ui/status-label';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import type { RegisterInputOptions, PendingWhipInputData } from '@/lib/types';
import {
  createNewRoom,
  getTwitchSuggestions,
  getKickSuggestions,
  getAllRooms,
  addTwitchInput,
  addKickInput,
  addMP4Input,
  addSnakeGameInput,
  addImageInput,
  addTextInput,
  updateInput,
  updateRoom,
  deleteRoom,
  hideInput,
} from '@/app/actions/actions';
import { RESOLUTION_PRESETS, type ResolutionPreset } from '@/lib/resolution';
import Link from 'next/link';
import { staggerContainer } from '@/utils/animations';
import {
  parseRoomConfig,
  restoreTimelineToStorage,
  computeTimelineStateAtZero,
  buildInputUpdateFromBlockSettings,
  saveOutputPlayerSettings,
} from '@/lib/room-config';
import { setPendingWhipInputs as setPendingWhipInputsAction } from '@/app/actions/actions';
import { Upload, FolderDown, LogIn, UserPlus, Eye, Trash2 } from 'lucide-react';
import RecordingsList from '@/components/recordings-list';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  SelectGroup,
  SelectLabel,
} from '@/components/ui/select';
import { LoadConfigModal } from '@/components/control-panel/components/ConfigModals';
import { ActionsProvider } from '@/components/control-panel/contexts/actions-context';
import { defaultActions } from '@/components/control-panel/contexts/default-actions';
import type { RoomConfig } from '@/lib/room-config';
import { formatDuration } from '@/lib/format-utils';

function getBasePath(pathname: string): string {
  // Remove trailing slash if present
  let path = pathname.replace(/\/$/, '');
  // Remove /room or /room/[roomId] if present
  if (path.endsWith('/room')) {
    path = path.slice(0, -'/room'.length);
  } else if (/\/room\/[^/]+$/.test(path)) {
    path = path.replace(/\/room\/[^/]+$/, '');
  }
  // Remove leading slash for consistency in push
  if (path.startsWith('/')) path = path.slice(1);
  return path;
}

export default function IntroView() {
  const router = useRouter();
  const pathname = usePathname();
  const [loadingNew, setLoadingNew] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [showRecordings, setShowRecordings] = useState(false);
  const [selectedResolution, setSelectedResolution] =
    useState<ResolutionPreset>('1440p');
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === 'undefined') return 'Mr Smelter';
    return localStorage.getItem('smelter-display-name') || 'Mr Smelter';
  });
  const handleSetDisplayName = useCallback((name: string) => {
    setDisplayName(name);
    try {
      localStorage.setItem('smelter-display-name', name);
    } catch {}
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Suggestions state
  const [twitchSuggestions, setTwitchSuggestions] = useState<any[]>([]);
  const [kickSuggestions, setKickSuggestions] = useState<any[]>([]);

  // Active rooms state
  type Room = {
    roomId: string;
    roomName?: { pl: string; en: string };
    createdAt?: number;
    isPublic?: boolean;
  };
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(true);

  // Load suggestions on mount
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [twitch, kick] = await Promise.all([
          getTwitchSuggestions(),
          getKickSuggestions(),
        ]);
        if (mounted) {
          setTwitchSuggestions(twitch.twitch || []);
          setKickSuggestions(kick.kick || []);
        }
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Load rooms on mount and refresh every 5s
  useEffect(() => {
    let mounted = true;
    const fetchRooms = async () => {
      try {
        const roomsData = await getAllRooms();
        if (mounted) {
          setRooms(roomsData.rooms || roomsData || []);
        }
      } catch (err) {
        // ignore
      } finally {
        if (mounted) setLoadingRooms(false);
      }
    };
    fetchRooms();
    const interval = setInterval(fetchRooms, 5000);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const basePath = getBasePath(pathname);

  const getRoomRoute = (roomId: string) => {
    // If basePath is empty, just 'room/roomId'
    // Otherwise, 'basePath/room/roomId'
    return basePath ? `${basePath}/room/${roomId}` : `room/${roomId}`;
  };

  const handleCreateRoom = useCallback(
    async (resolutionOverride?: ResolutionPreset) => {
      setLoadingNew(true);
      try {
        let initInputs: RegisterInputOptions[] = [];
        const lowerPath = pathname.toLowerCase();
        if (lowerPath.includes('kick')) {
          initInputs = (kickSuggestions.slice(0, 2) || []).map((s) => ({
            type: 'kick-channel',
            channelId: s.streamId,
          }));
        } else if (lowerPath.includes('twitch')) {
          initInputs = (twitchSuggestions.slice(0, 2) || []).map((s) => ({
            type: 'twitch-channel',
            channelId: s.streamId,
          }));
        } else {
          initInputs = [];
        }
        const room = await createNewRoom(
          initInputs,
          false,
          resolutionOverride ?? selectedResolution,
        );
        router.push(getRoomRoute(room.roomId));
      } finally {
        setLoadingNew(false);
      }
    },
    [
      router,
      basePath,
      pathname,
      twitchSuggestions,
      kickSuggestions,
      selectedResolution,
    ],
  );

  // Voice command: start new room
  useEffect(() => {
    const handleStartRoom = (e: Event) => {
      if (!loadingNew && !loadingImport) {
        const detail = (e as CustomEvent).detail;
        const resolution = detail?.vertical
          ? ('1440p-vertical' as ResolutionPreset)
          : undefined;
        handleCreateRoom(resolution);
      }
    };
    window.addEventListener('smelter:voice:start-room', handleStartRoom);
    return () => {
      window.removeEventListener('smelter:voice:start-room', handleStartRoom);
    };
  }, [handleCreateRoom, loadingNew, loadingImport]);

  const [showLoadModal, setShowLoadModal] = useState(false);

  const importConfig = useCallback(
    async (config: RoomConfig) => {
      setLoadingImport(true);
      try {
        const room = await createNewRoom([], true, config.resolution);
        const roomId = room.roomId;

        const createdInputIds: { inputId: string; configIndex: number }[] = [];

        for (let i = 0; i < config.inputs.length; i++) {
          const inputConfig = config.inputs[i];
          try {
            let inputId: string | null = null;

            if (inputConfig.type === 'whip') {
              continue;
            }

            switch (inputConfig.type) {
              case 'twitch-channel':
                if (inputConfig.channelId) {
                  const result = await addTwitchInput(
                    roomId,
                    inputConfig.channelId,
                  );
                  inputId = result.inputId;
                }
                break;
              case 'kick-channel':
                if (inputConfig.channelId) {
                  const result = await addKickInput(
                    roomId,
                    inputConfig.channelId,
                  );
                  inputId = result.inputId;
                }
                break;
              case 'local-mp4':
                if (inputConfig.mp4FileName) {
                  const result = await addMP4Input(
                    roomId,
                    inputConfig.mp4FileName,
                  );
                  inputId = result.inputId;
                }
                break;
              case 'image':
                if (inputConfig.imageId) {
                  const result = await addImageInput(
                    roomId,
                    inputConfig.imageId,
                  );
                  inputId = result.inputId;
                }
                break;
              case 'text-input':
                if (inputConfig.text) {
                  const result = await addTextInput(
                    roomId,
                    inputConfig.text,
                    inputConfig.textAlign || 'left',
                  );
                  inputId = result.inputId;
                }
                break;
              case 'game': {
                const result = await addSnakeGameInput(
                  roomId,
                  inputConfig.title,
                );
                inputId = result.inputId;
                break;
              }
            }

            if (inputId) {
              createdInputIds.push({ inputId, configIndex: i });
            }
          } catch (err) {
            console.warn(`Failed to add input ${inputConfig.title}:`, err);
          }
        }

        const configIndexToInputId = new Map<number, string>();
        for (const { inputId, configIndex } of createdInputIds) {
          configIndexToInputId.set(configIndex, inputId);
        }

        const pendingWhipInputs: PendingWhipInputData[] = [];
        for (let i = 0; i < config.inputs.length; i++) {
          const inputConfig = config.inputs[i];
          if (inputConfig.type === 'whip') {
            pendingWhipInputs.push({
              id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              title: inputConfig.title,
              volume: inputConfig.volume,
              showTitle: inputConfig.showTitle !== false,
              shaders: inputConfig.shaders || [],
              position: i,
            });
            configIndexToInputId.set(i, `__pending-whip-${i}__`);
          }
        }

        for (const { inputId, configIndex } of createdInputIds) {
          const inputConfig = config.inputs[configIndex];
          const attachedInputIds = inputConfig.attachedInputIndices
            ?.map((idx) => configIndexToInputId.get(idx))
            .filter((id): id is string => !!id);
          try {
            await updateInput(roomId, inputId, {
              volume: inputConfig.volume,
              shaders: inputConfig.shaders,
              showTitle: inputConfig.showTitle,
              textColor: inputConfig.textColor,
              textMaxLines: inputConfig.textMaxLines,
              textScrollSpeed: inputConfig.textScrollSpeed,
              textScrollLoop: inputConfig.textScrollLoop,
              textFontSize: inputConfig.textFontSize,
              borderColor: inputConfig.borderColor,
              borderWidth: inputConfig.borderWidth,
              gameBackgroundColor: inputConfig.gameBackgroundColor,
              gameCellGap: inputConfig.gameCellGap,
              gameBoardBorderColor: inputConfig.gameBoardBorderColor,
              gameBoardBorderWidth: inputConfig.gameBoardBorderWidth,
              gameGridLineColor: inputConfig.gameGridLineColor,
              gameGridLineAlpha: inputConfig.gameGridLineAlpha,
              snakeEventShaders: inputConfig.snakeEventShaders,
              snake1Shaders: inputConfig.snake1Shaders,
              snake2Shaders: inputConfig.snake2Shaders,
              absolutePosition: inputConfig.absolutePosition,
              absoluteTop: inputConfig.absoluteTop,
              absoluteLeft: inputConfig.absoluteLeft,
              absoluteWidth: inputConfig.absoluteWidth,
              absoluteHeight: inputConfig.absoluteHeight,
              absoluteTransitionDurationMs:
                inputConfig.absoluteTransitionDurationMs,
              absoluteTransitionEasing: inputConfig.absoluteTransitionEasing,
              cropTop: inputConfig.cropTop,
              cropLeft: inputConfig.cropLeft,
              cropRight: inputConfig.cropRight,
              cropBottom: inputConfig.cropBottom,
              attachedInputIds:
                attachedInputIds && attachedInputIds.length > 0
                  ? attachedInputIds
                  : undefined,
            });
          } catch (err) {
            console.warn(`Failed to update input ${inputId}:`, err);
          }
        }

        let timelineInputOrder: string[] | undefined;

        if (config.timeline) {
          const indexToInputId = new Map<number, string>();
          for (const { inputId, configIndex } of createdInputIds) {
            indexToInputId.set(configIndex, inputId);
          }

          const timelineState = computeTimelineStateAtZero(
            config.timeline,
            indexToInputId,
          );

          for (const pending of pendingWhipInputs) {
            indexToInputId.set(
              pending.position,
              `__pending-whip-${pending.position}__`,
            );
          }
          restoreTimelineToStorage(roomId, config.timeline, indexToInputId);

          for (const hiddenId of timelineState.hiddenInputIds) {
            try {
              await hideInput(roomId, hiddenId);
            } catch (err) {
              console.warn(`Failed to hide input ${hiddenId}:`, err);
            }
          }

          for (const [
            inputId,
            blockSettings,
          ] of timelineState.activeBlockSettings) {
            try {
              await updateInput(
                roomId,
                inputId,
                buildInputUpdateFromBlockSettings(blockSettings),
              );
            } catch (err) {
              console.warn(
                `Failed to apply block settings for ${inputId}:`,
                err,
              );
            }
          }

          if (timelineState.inputOrder.length > 0) {
            timelineInputOrder = timelineState.inputOrder;
          }
        }

        const orderedCreatedIds = createdInputIds
          .slice()
          .sort((a, b) => a.configIndex - b.configIndex)
          .map(({ inputId }) => inputId);

        const finalInputOrder =
          timelineInputOrder ??
          (orderedCreatedIds.length > 0 ? orderedCreatedIds : undefined);

        try {
          await updateRoom(roomId, {
            ...(finalInputOrder ? { inputOrder: finalInputOrder } : {}),
            ...config.transitionSettings,
          });
        } catch (err) {
          console.warn('Failed to set input order:', err);
        }

        if (pendingWhipInputs.length > 0) {
          await setPendingWhipInputsAction(roomId, pendingWhipInputs);
          toast.info(
            `Room created. ${pendingWhipInputs.length} WHIP input(s) need to be connected manually.`,
          );
        } else {
          toast.success('Room created from configuration');
        }

        if (config.outputPlayer) {
          saveOutputPlayerSettings(roomId, config.outputPlayer);
        }

        router.push(getRoomRoute(roomId));
      } catch (err: any) {
        console.error('Import failed:', err);
        toast.error(`Import failed: ${err?.message || err}`);
      } finally {
        setLoadingImport(false);
      }
    },
    [router, basePath, selectedResolution],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        const config = parseRoomConfig(text);
        await importConfig(config);
      } catch (err: any) {
        console.error('Import failed:', err);
        toast.error(`Import failed: ${err?.message || err}`);
        setLoadingImport(false);
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [importConfig],
  );

  return (
    <motion.div
      variants={staggerContainer}
      className='min-h-screen flex flex-col p-2 py-4 md:p-4 bg-[#0a0a0a] overflow-y-auto'>
      <motion.div
        variants={staggerContainer}
        className='flex-1 flex justify-center min-h-0 h-full items-start md:items-center w-full'>
        <motion.div
          className='border-1 rounded-none border-neutral-800 text-center justify-center items-center w-full max-w-[600px] p-4 sm:p-8'
          layout>
          <div>
            <StatusLabel />
          </div>

          <div className='text-white justify-center'>
            <h2 className='text-3xl font-bold w-full'>Try Live Demo</h2>
            <p className='text-sm line-clamp-3 mt-6'>
              Try our low-latency video toolkit – perfect for streaming,
              broadcasting and video conferencing.
            </p>
          </div>

          <div className='mt-6 flex flex-col gap-3'>
            <div className='flex flex-col gap-2'>
              <label className='text-xs text-neutral-400 text-left'>
                Display Name
              </label>
              <Input
                type='text'
                value={displayName}
                onChange={(e) => handleSetDisplayName(e.target.value)}
                placeholder='Mr Smelter'
                className='w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-neutral-500'
                disabled={loadingNew || loadingImport}
              />
            </div>
            <div className='flex flex-col gap-2'>
              <label className='text-xs text-neutral-400 text-left'>
                Output Resolution
              </label>
              <Select
                value={selectedResolution}
                onValueChange={(v) =>
                  setSelectedResolution(v as ResolutionPreset)
                }
                disabled={loadingNew || loadingImport}>
                <SelectTrigger className='w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-neutral-500 h-auto'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Landscape</SelectLabel>
                    {Object.entries(RESOLUTION_PRESETS)
                      .filter(([key]) => !key.includes('vertical'))
                      .map(([key, { width, height }]) => (
                        <SelectItem key={key} value={key}>
                          {key.toUpperCase()} ({width}×{height})
                        </SelectItem>
                      ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Portrait</SelectLabel>
                    {Object.entries(RESOLUTION_PRESETS)
                      .filter(([key]) => key.includes('vertical'))
                      .map(([key, { width, height }]) => (
                        <SelectItem key={key} value={key}>
                          {key.replace('-vertical', '').toUpperCase()} Vertical
                          ({width}×{height})
                        </SelectItem>
                      ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <Button
              size='lg'
              variant='default'
              className='w-full cursor-pointer'
              onClick={() => handleCreateRoom()}
              disabled={loadingNew || loadingImport}>
              Let&apos;s go!
              {loadingNew && <LoadingSpinner size='sm' variant='spinner' />}
            </Button>
            <Button
              size='lg'
              variant='outline'
              className='w-full cursor-pointer'
              onClick={() => setShowLoadModal(true)}
              disabled={loadingNew || loadingImport}>
              {loadingImport ? (
                <>
                  <LoadingSpinner size='sm' variant='spinner' />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className='w-4 h-4 mr-2' />
                  Load from configuration
                </>
              )}
            </Button>
            <Input
              ref={fileInputRef}
              type='file'
              accept='.json,application/json'
              className='hidden'
              onChange={handleFileChange}
            />
            <ActionsProvider actions={defaultActions}>
              <LoadConfigModal
                open={showLoadModal}
                onOpenChange={setShowLoadModal}
                onLoadLocal={() => {
                  setShowLoadModal(false);
                  fileInputRef.current?.click();
                }}
                onLoadRemote={importConfig}
                isImporting={loadingImport}
              />
            </ActionsProvider>
            <Button
              size='lg'
              variant='outline'
              className='w-full cursor-pointer'
              onClick={() => setShowRecordings(true)}
              disabled={loadingNew || loadingImport}>
              <FolderDown className='w-4 h-4 mr-2' />
              Recordings
            </Button>
            <RecordingsList
              open={showRecordings}
              onClose={() => setShowRecordings(false)}
            />
          </div>

          {!loadingRooms && rooms.length > 0 && (
            <div className='mt-8 text-center'>
              <h3 className='text-lg font-semibold text-white mb-3'>
                Active Rooms
              </h3>
              <ul className='space-y-2'>
                {rooms.map((room) => (
                  <li key={room.roomId}>
                    <div className='flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between px-4 py-3 rounded-none bg-neutral-900 text-white text-sm'>
                      <div className='flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-center sm:gap-3'>
                        <span className='font-mono truncate max-w-full'>
                          {room.roomName
                            ? `${room.roomName.pl} / ${room.roomName.en}`
                            : room.roomId}
                        </span>
                        {room.createdAt && (
                          <span className='text-xs text-neutral-500'>
                            {new Date(room.createdAt).toLocaleTimeString()} ·{' '}
                            {formatDuration(Date.now() - room.createdAt)}
                          </span>
                        )}
                      </div>
                      <div className='flex w-full gap-1 sm:w-auto sm:ml-4 shrink-0'>
                        <Button
                          size='sm'
                          variant='default'
                          className='cursor-pointer flex-1 sm:flex-none'
                          title='Join'
                          onClick={() =>
                            router.push(getRoomRoute(room.roomId))
                          }>
                          <LogIn className='w-4 h-4' />
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          className='cursor-pointer flex-1 sm:flex-none'
                          title='Join as Guest'
                          onClick={() =>
                            router.push(
                              getRoomRoute(room.roomId) + '?guest=true',
                            )
                          }>
                          <UserPlus className='w-4 h-4' />
                        </Button>
                        <Button
                          size='sm'
                          variant='secondary'
                          className='cursor-pointer flex-1 sm:flex-none'
                          title='Spectate'
                          onClick={() =>
                            window.open(
                              `/room-preview/${room.roomId}`,
                              '_blank',
                            )
                          }>
                          <Eye className='w-4 h-4' />
                        </Button>
                        <Button
                          size='sm'
                          variant='destructive'
                          className='cursor-pointer flex-1 sm:flex-none'
                          title='Delete Room'
                          onClick={async () => {
                            try {
                              await deleteRoom(room.roomId);
                              setRooms((prev) =>
                                prev.filter((r) => r.roomId !== room.roomId),
                              );
                            } catch (err) {
                              console.error('Failed to delete room:', err);
                            }
                          }}>
                          <Trash2 className='w-4 h-4' />
                        </Button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

function getRoomIdFromUserEntry(urlOrId: string): string {
  try {
    const url = new URL(urlOrId);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : urlOrId;
  } catch {
    return urlOrId;
  }
}
