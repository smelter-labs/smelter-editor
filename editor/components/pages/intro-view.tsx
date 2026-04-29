'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';

import StatusLabel from '@/components/ui/status-label';
import { Button } from '@/components/ui/button';
import LoadingSpinner from '@/components/ui/spinner';
import type { RegisterInputOptions } from '@/lib/types';
import {
  createNewRoom,
  getTwitchSuggestions,
  getKickSuggestions,
  getAllRooms,
  deleteRoom,
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
import { streamImportConfig } from '@/lib/import-config-stream';
import {
  listPresentationConfigs,
  loadPresentationConfig,
} from '@/app/actions/actions';
import {
  Upload,
  FolderDown,
  LogIn,
  UserPlus,
  Eye,
  Trash2,
  Presentation,
  RotateCcw,
  X,
  Settings,
} from 'lucide-react';
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
import {
  ImportProgressDialog,
  type ImportProgressState,
} from '@/components/control-panel/components/import-progress-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ActionsProvider } from '@/components/control-panel/contexts/actions-context';
import { defaultActions } from '@/components/control-panel/contexts/default-actions';
import type { RoomConfig, PresentationConfig } from '@/lib/room-config';
import type { SavedItemInfo } from '@/lib/storage-client';
import { formatDuration } from '@/lib/format-utils';
import {
  loadCrashRecoveryConfig,
  clearCrashRecoveryConfig,
  type CrashRecoveryData,
} from '@/lib/crash-recovery';
import { SettingsModal } from '@/components/settings-modal';
import { SERVER_PRESETS, getEffectiveClientServerUrl } from '@/lib/server-url';

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
  const searchParams = useSearchParams();
  const [loadingNew, setLoadingNew] = useState(false);
  const [loadingImport, setLoadingImport] = useState(false);
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);
  const [showRecordings, setShowRecordings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
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
  const [crashRecovery, setCrashRecovery] = useState<CrashRecoveryData | null>(
    null,
  );

  useEffect(() => {
    setCrashRecovery(loadCrashRecoveryConfig());
  }, []);

  useEffect(() => {
    setCurrentServerUrl(getEffectiveClientServerUrl());
  }, []);

  const handleRecoveryDismiss = useCallback(() => {
    clearCrashRecoveryConfig();
    setCrashRecovery(null);
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const centeredContentRef = useRef<HTMLDivElement>(null);
  const [desktopIntroOffset, setDesktopIntroOffset] = useState<number | null>(
    null,
  );
  const [currentServerUrl, setCurrentServerUrl] = useState<string | null>(null);

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
  const [deletingRoomIds, setDeletingRoomIds] = useState<Set<string>>(
    () => new Set(),
  );

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

  useEffect(() => {
    const updateDesktopIntroOffset = () => {
      if (typeof window === 'undefined') {
        return;
      }

      if (window.innerWidth < 768) {
        setDesktopIntroOffset(null);
        return;
      }

      const contentHeight =
        centeredContentRef.current?.getBoundingClientRect().height ?? 0;
      const nextOffset = Math.max((window.innerHeight - contentHeight) / 2, 16);
      setDesktopIntroOffset(nextOffset);
    };

    updateDesktopIntroOffset();

    const currentContent = centeredContentRef.current;
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => updateDesktopIntroOffset());

    if (currentContent && resizeObserver) {
      resizeObserver.observe(currentContent);
    }

    window.addEventListener('resize', updateDesktopIntroOffset);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateDesktopIntroOffset);
    };
  }, []);

  const basePath = getBasePath(pathname);

  const getRoomRoute = useCallback(
    (roomId: string) => {
      // If basePath is empty, just 'room/roomId'
      // Otherwise, 'basePath/room/roomId'
      return basePath ? `${basePath}/room/${roomId}` : `room/${roomId}`;
    },
    [basePath],
  );

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
      getRoomRoute,
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

  // Showcase / presentation mode
  const [showcaseConfigs, setShowcaseConfigs] = useState<SavedItemInfo[]>([]);
  const [loadingShowcase, setLoadingShowcase] = useState(false);
  const [showShowcasePicker, setShowShowcasePicker] = useState(false);

  useEffect(() => {
    let mounted = true;
    listPresentationConfigs().then((result) => {
      if (mounted && result.ok) {
        setShowcaseConfigs(result.items);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const [showLoadModal, setShowLoadModal] = useState(false);

  const importConfig = useCallback(
    async (
      config: RoomConfig,
      showcaseWelcome?: {
        before: string;
        after: string;
        farewellTitle?: string;
        farewellDescription?: string;
      },
    ) => {
      setLoadingImport(true);
      setImportProgress({ phase: 'Creating room', current: 0, total: 1 });

      try {
        const room = await createNewRoom([], true, config.resolution);
        const roomId = room.roomId;

        if (showcaseWelcome) {
          try {
            sessionStorage.setItem(
              `showcase-welcome-${roomId}`,
              JSON.stringify(showcaseWelcome),
            );
          } catch {}
        }

        let timelineAtZero:
          | {
              hiddenInputIds: number[];
              blockSettingsEntries: [number, Record<string, unknown>][];
            }
          | undefined;

        if (config.timeline) {
          const tempIndexMap = new Map<number, string>();
          config.inputs.forEach((_, idx) =>
            tempIndexMap.set(idx, `__temp_${idx}__`),
          );
          const atZero = computeTimelineStateAtZero(
            config.timeline,
            tempIndexMap,
          );

          const hiddenIndices: number[] = [];
          for (const hiddenId of atZero.hiddenInputIds) {
            const match = hiddenId.match(/^__temp_(\d+)__$/);
            if (match) hiddenIndices.push(Number(match[1]));
          }

          const blockEntries: [number, Record<string, unknown>][] = [];
          for (const [tempId, bs] of atZero.activeBlockSettings) {
            const match = tempId.match(/^__temp_(\d+)__$/);
            if (match) {
              blockEntries.push([
                Number(match[1]),
                buildInputUpdateFromBlockSettings(bs) as Record<
                  string,
                  unknown
                >,
              ]);
            }
          }

          if (hiddenIndices.length > 0 || blockEntries.length > 0) {
            timelineAtZero = {
              hiddenInputIds: hiddenIndices,
              blockSettingsEntries: blockEntries,
            };
          }
        }

        const result = await streamImportConfig(
          roomId,
          { config, oldInputIds: [], timelineAtZero },
          {
            onProgress: (event) => {
              setImportProgress({
                phase: event.phase,
                current: event.current,
                total: event.total,
              });
            },
          },
        );

        if (result.errors.length > 0) {
          console.warn('[import-config] Errors:', result.errors);
        }

        if (config.timeline) {
          const indexToInputId = new Map<number, string>();
          for (const [idx, inputId] of Object.entries(result.indexToInputId)) {
            indexToInputId.set(Number(idx), inputId);
          }
          for (const pw of result.pendingWhipData) {
            indexToInputId.set(pw.position, `__pending-whip-${pw.position}__`);
          }
          restoreTimelineToStorage(roomId, config.timeline, indexToInputId);
        }

        if (result.pendingWhipData.length > 0) {
          toast.info(
            `Room created. ${result.pendingWhipData.length} WHIP input(s) need to be connected manually.`,
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
        setImportProgress(null);
        setLoadingImport(false);
      }
    },
    [getRoomRoute, router],
  );

  const handleRecoveryRestore = useCallback(async () => {
    if (!crashRecovery) return;
    clearCrashRecoveryConfig();
    setCrashRecovery(null);
    await importConfig(crashRecovery.config);
  }, [crashRecovery, importConfig]);

  const autoRestoreTriggeredRef = useRef(false);
  useEffect(() => {
    if (autoRestoreTriggeredRef.current) return;
    if (searchParams.get('restore') !== 'true') return;
    if (!crashRecovery) return;
    autoRestoreTriggeredRef.current = true;
    handleRecoveryRestore();
  }, [searchParams, crashRecovery, handleRecoveryRestore]);

  const handleStartShowcase = useCallback(
    async (configItem: SavedItemInfo) => {
      setLoadingShowcase(true);
      try {
        const result = await loadPresentationConfig(configItem.fileName);
        if (!result.ok) {
          toast.error(`Failed to load presentation config: ${result.error}`);
          return;
        }
        const presentation = result.data as PresentationConfig;
        await importConfig(presentation.roomConfig, {
          before: presentation.welcomeTextBefore || '',
          after: presentation.welcomeTextAfter || '',
          farewellTitle: presentation.farewellTitle || '',
          farewellDescription: presentation.farewellDescription || '',
        });
      } catch (err: any) {
        console.error('Showcase start failed:', err);
        toast.error(`Showcase start failed: ${err?.message || err}`);
      } finally {
        setLoadingShowcase(false);
      }
    },
    [importConfig],
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

  const currentServerLabel = (() => {
    if (!currentServerUrl) {
      return 'Loading...';
    }

    const normalized = currentServerUrl.replace(/\/$/, '');
    const preset = SERVER_PRESETS.find(
      (item) => item.url && item.url.replace(/\/$/, '') === normalized,
    );
    if (preset) {
      return preset.label;
    }

    try {
      return new URL(normalized).host;
    } catch {
      return normalized;
    }
  })();

  return (
    <motion.div
      variants={staggerContainer}
      className='min-h-screen flex flex-col p-2 py-4 md:p-4 bg-[#0a0a0a] overflow-y-auto'>
      <motion.div
        variants={staggerContainer}
        className='flex justify-center w-full min-h-0'
        style={
          desktopIntroOffset === null
            ? undefined
            : {
                paddingTop: desktopIntroOffset,
                paddingBottom: 16,
              }
        }>
        <motion.div
          className='border-1 rounded-none border-neutral-800 text-center justify-center items-center w-full max-w-[600px] p-4 sm:p-8'
          layout>
          <div className='flex justify-end'>
            <div className='inline-flex items-center gap-2'>
              <span
                className='inline-flex max-w-[280px] items-center gap-1 rounded border border-neutral-800 bg-neutral-950 px-2 py-1 text-[11px] text-neutral-300'
                title={
                  currentServerUrl
                    ? `Current server: ${currentServerUrl}`
                    : 'Loading current server...'
                }>
                <span className='text-neutral-500'>Server</span>
                <span className='truncate'>{currentServerLabel}</span>
              </span>
              <button
                type='button'
                onClick={() => setShowSettings(true)}
                className='inline-flex items-center justify-center rounded border border-neutral-700 bg-neutral-900 p-2 text-neutral-300 transition-colors hover:text-white hover:border-neutral-500 cursor-pointer'
                aria-label='Open server settings'>
                <Settings className='w-4 h-4' />
              </button>
            </div>
          </div>
          <div ref={centeredContentRef}>
            {crashRecovery && (
              <div className='mb-4 border border-amber-700/50 bg-amber-950/30 rounded p-4 text-left'>
                <div className='flex items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <p className='text-sm font-medium text-amber-200'>
                      Your previous session was interrupted
                    </p>
                    <p className='text-xs text-neutral-400 mt-1'>
                      {crashRecovery.config.inputs.length} input(s) &middot;
                      saved{' '}
                      {formatDuration(
                        Date.now() - new Date(crashRecovery.savedAt).getTime(),
                      )}{' '}
                      ago
                    </p>
                  </div>
                  <button
                    onClick={handleRecoveryDismiss}
                    className='text-neutral-500 hover:text-neutral-300 shrink-0 cursor-pointer'>
                    <X className='w-4 h-4' />
                  </button>
                </div>
                <div className='flex gap-2 mt-3'>
                  <Button
                    size='sm'
                    variant='default'
                    className='cursor-pointer'
                    disabled={loadingNew || loadingImport}
                    onClick={handleRecoveryRestore}>
                    {loadingImport ? (
                      <LoadingSpinner size='sm' variant='spinner' />
                    ) : (
                      <RotateCcw className='w-3.5 h-3.5 mr-1.5' />
                    )}
                    Restore session
                  </Button>
                </div>
              </div>
            )}

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
                            {key.replace('-vertical', '').toUpperCase()}{' '}
                            Vertical ({width}×{height})
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
              <Button
                size='lg'
                variant='default'
                className='w-full cursor-pointer text-lg py-6 font-bold'
                onClick={() => {
                  if (showcaseConfigs.length === 0) {
                    return;
                  }
                  if (showcaseConfigs.length === 1) {
                    handleStartShowcase(showcaseConfigs[0]);
                  } else {
                    setShowShowcasePicker(true);
                  }
                }}
                disabled={
                  loadingNew ||
                  loadingImport ||
                  loadingShowcase ||
                  showcaseConfigs.length === 0
                }>
                {loadingShowcase ? (
                  <LoadingSpinner size='sm' variant='spinner' />
                ) : (
                  <>
                    <Presentation className='w-5 h-5 mr-2' />
                    Start Showcase
                  </>
                )}
              </Button>
              <Button
                size='lg'
                variant='default'
                className='w-full cursor-pointer'
                onClick={() => handleCreateRoom()}
                disabled={loadingNew || loadingImport || loadingShowcase}>
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
                />
              </ActionsProvider>
              <ImportProgressDialog progress={importProgress} />
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
              <SettingsModal
                open={showSettings}
                onOpenChange={setShowSettings}
              />
            </div>
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
                          disabled={deletingRoomIds.has(room.roomId)}
                          onClick={async () => {
                            if (deletingRoomIds.has(room.roomId)) return;
                            setDeletingRoomIds((prev) => {
                              const next = new Set(prev);
                              next.add(room.roomId);
                              return next;
                            });
                            try {
                              await deleteRoom(room.roomId);
                              setRooms((prev) =>
                                prev.filter((r) => r.roomId !== room.roomId),
                              );
                            } catch (err) {
                              console.error('Failed to delete room:', err);
                            } finally {
                              setDeletingRoomIds((prev) => {
                                const next = new Set(prev);
                                next.delete(room.roomId);
                                return next;
                              });
                            }
                          }}>
                          {deletingRoomIds.has(room.roomId) ? (
                            <LoadingSpinner size='sm' variant='spinner' />
                          ) : (
                            <Trash2 className='w-4 h-4' />
                          )}
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
      <Dialog open={showShowcasePicker} onOpenChange={setShowShowcasePicker}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Select Presentation</DialogTitle>
          </DialogHeader>
          <div className='space-y-2'>
            {showcaseConfigs.map((item) => (
              <button
                key={item.fileName}
                onClick={() => {
                  setShowShowcasePicker(false);
                  handleStartShowcase(item);
                }}
                disabled={loadingShowcase}
                className='w-full flex items-center justify-between bg-neutral-900 hover:bg-neutral-800 rounded px-4 py-3 text-left transition-colors cursor-pointer'>
                <div className='min-w-0'>
                  <span className='text-sm text-white font-medium block truncate'>
                    {item.name}
                  </span>
                  <span className='text-xs text-neutral-500'>
                    {new Date(item.savedAt).toLocaleString()}
                  </span>
                </div>
                <Presentation className='w-4 h-4 text-neutral-400 shrink-0 ml-3' />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
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
