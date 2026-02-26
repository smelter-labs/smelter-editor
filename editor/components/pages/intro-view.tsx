'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { motion } from 'framer-motion';

import StatusLabel from '@/components/ui/status-label';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import {
  createNewRoom,
  RegisterInputOptions,
  getTwitchSuggestions,
  getKickSuggestions,
  getAllRooms,
  addTwitchInput,
  addKickInput,
  addMP4Input,
  addGameInput,
  addImageInput,
  addTextInput,
  updateInput,
  updateRoom,
  deleteRoom,
} from '@/app/actions/actions';
import { RESOLUTION_PRESETS, type ResolutionPreset } from '@/lib/resolution';
import Link from 'next/link';
import { staggerContainer } from '@/utils/animations';
import { parseRoomConfig, restoreTimelineToStorage } from '@/lib/room-config';
import {
  setPendingWhipInputs as setPendingWhipInputsAction,
  type PendingWhipInputData,
} from '@/app/actions/actions';
import { Upload, FolderDown, LogIn, UserPlus, Eye, Trash2 } from 'lucide-react';
import RecordingsList from '@/components/recordings-list';
import { toast } from 'react-toastify';
import { LoadConfigModal } from '@/components/control-panel/components/ConfigModals';
import type { RoomConfig } from '@/lib/room-config';

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

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
                const result = await addGameInput(roomId, inputConfig.title);
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

        for (const { inputId, configIndex } of createdInputIds) {
          const inputConfig = config.inputs[configIndex];
          try {
            await updateInput(roomId, inputId, {
              volume: inputConfig.volume,
              shaders: inputConfig.shaders,
              showTitle: inputConfig.showTitle,
              textColor: inputConfig.textColor,
              orientation: inputConfig.orientation,
              textMaxLines: inputConfig.textMaxLines,
              textScrollSpeed: inputConfig.textScrollSpeed,
              textScrollLoop: inputConfig.textScrollLoop,
              gameBackgroundColor: inputConfig.gameBackgroundColor,
              gameCellGap: inputConfig.gameCellGap,
              gameBoardBorderColor: inputConfig.gameBoardBorderColor,
              gameBoardBorderWidth: inputConfig.gameBoardBorderWidth,
              gameGridLineColor: inputConfig.gameGridLineColor,
              gameGridLineAlpha: inputConfig.gameGridLineAlpha,
            });
          } catch (err) {
            console.warn(`Failed to update input ${inputId}:`, err);
          }
        }

        const orderedCreatedIds = createdInputIds
          .slice()
          .sort((a, b) => a.configIndex - b.configIndex)
          .map(({ inputId }) => inputId);

        try {
          await updateRoom(roomId, {
            layout: config.layout,
            ...(orderedCreatedIds.length > 0
              ? { inputOrder: orderedCreatedIds }
              : {}),
            ...config.transitionSettings,
          });
        } catch (err) {
          console.warn('Failed to set layout or input order:', err);
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
              orientation: (inputConfig.orientation || 'horizontal') as
                | 'horizontal'
                | 'vertical',
              position: i,
            });
          }
        }

        if (config.timeline) {
          const indexToInputId = new Map<number, string>();
          for (const { inputId, configIndex } of createdInputIds) {
            indexToInputId.set(configIndex, inputId);
          }
          for (const pending of pendingWhipInputs) {
            indexToInputId.set(
              pending.position,
              `__pending-whip-${pending.position}__`,
            );
          }
          restoreTimelineToStorage(roomId, config.timeline, indexToInputId);
        }

        if (pendingWhipInputs.length > 0) {
          await setPendingWhipInputsAction(roomId, pendingWhipInputs);
          toast.info(
            `Room created. ${pendingWhipInputs.length} WHIP input(s) need to be connected manually.`,
          );
        } else {
          toast.success('Room created from configuration');
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
              <input
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
              <select
                value={selectedResolution}
                onChange={(e) =>
                  setSelectedResolution(e.target.value as ResolutionPreset)
                }
                className='w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded text-white text-sm focus:outline-none focus:border-neutral-500'
                disabled={loadingNew || loadingImport}>
                <optgroup label='Landscape'>
                  {Object.entries(RESOLUTION_PRESETS)
                    .filter(([key]) => !key.includes('vertical'))
                    .map(([key, { width, height }]) => (
                      <option key={key} value={key}>
                        {key.toUpperCase()} ({width}×{height})
                      </option>
                    ))}
                </optgroup>
                <optgroup label='Portrait'>
                  {Object.entries(RESOLUTION_PRESETS)
                    .filter(([key]) => key.includes('vertical'))
                    .map(([key, { width, height }]) => (
                      <option key={key} value={key}>
                        {key.replace('-vertical', '').toUpperCase()} Vertical (
                        {width}×{height})
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>
            <Button
              size='lg'
              variant='default'
              className='text-black font-medium w-full bg-white border-0 hover:bg-neutral-200 cursor-pointer'
              onClick={() => handleCreateRoom()}
              disabled={loadingNew || loadingImport}>
              Let&apos;s go!
              {loadingNew && <LoadingSpinner size='sm' variant='spinner' />}
            </Button>
            <Button
              size='lg'
              variant='default'
              className='font-medium w-full bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
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
            <input
              ref={fileInputRef}
              type='file'
              accept='.json,application/json'
              className='hidden'
              onChange={handleFileChange}
            />
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
            <Button
              size='lg'
              variant='default'
              className='font-medium w-full bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
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

          {!loadingRooms && rooms.filter((r) => r.isPublic).length > 0 && (
            <div className='mt-8 text-center'>
              <h3 className='text-lg font-semibold text-white mb-3'>
                Active Rooms
              </h3>
              <ul className='space-y-2'>
                {rooms
                  .filter((r) => r.isPublic)
                  .map((room) => (
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
                            className='bg-white text-black hover:bg-neutral-200 cursor-pointer flex-1 sm:flex-none'
                            title='Join'
                            onClick={() =>
                              router.push(getRoomRoute(room.roomId))
                            }>
                            <LogIn className='w-4 h-4' />
                          </Button>
                          <Button
                            size='sm'
                            variant='default'
                            className='bg-neutral-700 text-white hover:bg-neutral-600 cursor-pointer flex-1 sm:flex-none'
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
                            variant='default'
                            className='bg-neutral-800 text-neutral-300 hover:bg-neutral-700 cursor-pointer flex-1 sm:flex-none'
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
                            variant='default'
                            className='bg-red-900/50 text-red-400 hover:bg-red-900 cursor-pointer flex-1 sm:flex-none'
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
