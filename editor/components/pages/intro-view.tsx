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
    addImageInput,
    addTextInput,
    updateInput,
    updateRoom,
} from '@/app/actions/actions';
import Link from 'next/link';
import { staggerContainer } from '@/utils/animations';
import { parseRoomConfig, savePendingWhipInputs, type StoredPendingWhipInput } from '@/lib/room-config';
import { Upload } from 'lucide-react';
import { toast } from 'react-toastify';

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
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Suggestions state
    const [twitchSuggestions, setTwitchSuggestions] = useState<any[]>([]);
    const [kickSuggestions, setKickSuggestions] = useState<any[]>([]);

    // Active rooms state
    type Room = { roomId: string; createdAt?: number; isPublic?: boolean };
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

    const handleCreateRoom = useCallback(async () => {
        setLoadingNew(true);
        try {
            let initInputs: RegisterInputOptions[] = [];
            const lowerPath = pathname.toLowerCase();
            if (lowerPath.includes('kick')) {
                // Use first two kick suggestions if available
                initInputs = (kickSuggestions.slice(0, 2) || []).map((s) => ({
                    type: 'kick-channel',
                    channelId: s.streamId,
                }));
            } else if (lowerPath.includes('twitch')) {
                // Use first two twitch suggestions if available
                initInputs = (twitchSuggestions.slice(0, 2) || []).map((s) => ({
                    type: 'twitch-channel',
                    channelId: s.streamId,
                }));
            } else {
                // No initial inputs
                initInputs = [];
            }
            const room = await createNewRoom(initInputs);
            let hash = '';
            if (typeof window !== 'undefined') {
                const h = (window.location.hash || '').toLowerCase();
                if (
                    h.includes('tour-main') ||
                    h.includes('tour-composing') ||
                    h.includes('tour-shaders')
                ) {
                    hash = h;
                }
            }
            router.push(getRoomRoute(room.roomId) + hash);
        } finally {
            setLoadingNew(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router, basePath, pathname, twitchSuggestions, kickSuggestions]);

    // Voice command: start new room
    useEffect(() => {
        const handleStartRoom = () => {
            if (!loadingNew && !loadingImport) {
                handleCreateRoom();
            }
        };
        window.addEventListener('smelter:voice:start-room', handleStartRoom);
        return () => {
            window.removeEventListener('smelter:voice:start-room', handleStartRoom);
        };
    }, [handleCreateRoom, loadingNew, loadingImport]);

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoadingImport(true);
        try {
            const text = await file.text();
            const config = parseRoomConfig(text);

            const room = await createNewRoom([], true);
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
                                const result = await addTwitchInput(roomId, inputConfig.channelId);
                                inputId = result.inputId;
                            }
                            break;
                        case 'kick-channel':
                            if (inputConfig.channelId) {
                                const result = await addKickInput(roomId, inputConfig.channelId);
                                inputId = result.inputId;
                            }
                            break;
                        case 'local-mp4':
                            if (inputConfig.mp4FileName) {
                                const result = await addMP4Input(roomId, inputConfig.mp4FileName);
                                inputId = result.inputId;
                            }
                            break;
                        case 'image':
                            if (inputConfig.imageId) {
                                const result = await addImageInput(roomId, inputConfig.imageId);
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
                if (inputConfig.shaders.length > 0 || inputConfig.showTitle !== undefined) {
                    try {
                        await updateInput(roomId, inputId, {
                            volume: inputConfig.volume,
                            shaders: inputConfig.shaders,
                            showTitle: inputConfig.showTitle,
                            textColor: inputConfig.textColor,
                        });
                    } catch (err) {
                        console.warn(`Failed to update input ${inputId}:`, err);
                    }
                }
            }

            try {
                await updateRoom(roomId, { layout: config.layout });
            } catch (err) {
                console.warn('Failed to set layout:', err);
            }

            const pendingWhipInputs: StoredPendingWhipInput[] = [];
            for (let i = 0; i < config.inputs.length; i++) {
                const inputConfig = config.inputs[i];
                if (inputConfig.type === 'whip') {
                    pendingWhipInputs.push({
                        id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
                        title: inputConfig.title,
                        config: inputConfig,
                        position: i,
                    });
                }
            }

            if (pendingWhipInputs.length > 0) {
                savePendingWhipInputs(roomId, pendingWhipInputs);
                toast.info(`Room created. ${pendingWhipInputs.length} WHIP input(s) need to be connected manually.`);
            } else {
                toast.success('Room created from configuration');
            }

            router.push(getRoomRoute(roomId));
        } catch (err: any) {
            console.error('Import failed:', err);
            toast.error(`Import failed: ${err?.message || err}`);
        } finally {
            setLoadingImport(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <motion.div
            variants={staggerContainer}
            className='h-screen flex flex-col p-2 py-4 md:p-4 bg-[#0a0a0a]'>
            <motion.div
                variants={staggerContainer}
                className='flex-1 flex justify-center min-h-0 h-full items-center'>
                <motion.div
                    className='border-1 rounded-none border-neutral-800 text-center justify-center items-center w-[600px] p-8'
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
                        <Button
                            size='lg'
                            variant='default'
                            className='text-black font-medium w-full bg-white border-0 hover:bg-neutral-200 cursor-pointer'
                            onClick={handleCreateRoom}
                            disabled={loadingNew || loadingImport}>
                            Let&apos;s go!
                            {loadingNew && <LoadingSpinner size='sm' variant='spinner' />}
                        </Button>
                        <Button
                                      size='lg'
                                      variant='default'
                                      className='font-medium w-full bg-neutral-800 hover:bg-neutral-700 text-white cursor-pointer'
                                      onClick={handleImportClick}
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
                                            <Link
                                                href={getRoomRoute(room.roomId)}
                                                className='flex items-center justify-between px-4 py-3 rounded-none bg-neutral-900 hover:bg-neutral-800 transition-colors text-white text-sm'>
                                                <span className='font-mono truncate'>
                                                    {room.roomId}
                                                </span>
                                                {room.createdAt && (
                                                    <span className='text-xs text-neutral-500 ml-4 whitespace-nowrap'>
                                                        {new Date(room.createdAt).toLocaleTimeString()} ·{' '}
                                                        {formatDuration(Date.now() - room.createdAt)}
                                                    </span>
                                                )}
                                            </Link>
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
