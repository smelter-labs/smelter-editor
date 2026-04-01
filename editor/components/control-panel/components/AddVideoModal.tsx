'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
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
  getAudioDuration,
} from '@/app/actions/actions';
import { useIsMobileDevice } from '@/hooks/use-mobile';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import type { ChannelSuggestion, Input } from '@/lib/types';

// ── Types ────────────────────────────────────────────────────

type AssetItemMp4 = { kind: 'mp4'; fileName: string; durationMs?: number };
type AssetItemAudio = { kind: 'audio'; fileName: string; durationMs?: number };
type AssetItemImage = { kind: 'image'; fileName: string };
type AssetItemTwitch = { kind: 'twitch'; channel: ChannelSuggestion };
type AssetItemKick = { kind: 'kick'; channel: ChannelSuggestion };
type AssetItemHls = {
  kind: 'hls-saved';
  name: string;
  url: string;
  fileName: string;
};
type AssetItemAction = {
  kind: 'action';
  actionType:
    | 'text'
    | 'game'
    | 'hands'
    | 'camera'
    | 'screenshare'
    | 'hls'
    | 'upload-mp4'
    | 'upload-image'
    | 'upload-audio';
};
type AssetItemFolder = {
  kind: 'folder';
  name: string;
  mediaType: 'mp4' | 'picture' | 'audio';
};

type AssetItem =
  | AssetItemMp4
  | AssetItemAudio
  | AssetItemImage
  | AssetItemTwitch
  | AssetItemKick
  | AssetItemHls
  | AssetItemAction
  | AssetItemFolder;

const FILTER_TYPES = [
  'ALL',
  'STREAM',
  'HLS',
  'MP4',
  'AUDIO',
  'IMAGE',
  'TEXT',
  'GAME',
  'HANDS',
  'INPUT',
] as const;
type FilterType = (typeof FILTER_TYPES)[number];

const ACTION_CARDS: AssetItemAction[] = [
  { kind: 'action', actionType: 'upload-mp4' },
  { kind: 'action', actionType: 'upload-audio' },
  { kind: 'action', actionType: 'upload-image' },
  { kind: 'action', actionType: 'hls' },
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
    case 'audio':
      return `audio:${item.fileName}`;
    case 'image':
      return `image:${item.fileName}`;
    case 'twitch':
      return `twitch:${item.channel.streamId}`;
    case 'kick':
      return `kick:${item.channel.streamId}`;
    case 'hls-saved':
      return `hls-saved:${item.fileName}`;
    case 'action':
      return `action:${item.actionType}`;
    case 'folder':
      return `folder:${item.mediaType}:${item.name}`;
  }
}

function itemMatchesFilter(item: AssetItem, filter: FilterType): boolean {
  if (filter === 'ALL') return true;
  switch (filter) {
    case 'STREAM':
      return item.kind === 'twitch' || item.kind === 'kick';
    case 'HLS':
      return (
        item.kind === 'hls-saved' ||
        (item.kind === 'action' && item.actionType === 'hls')
      );
    case 'MP4':
      return (
        item.kind === 'mp4' ||
        (item.kind === 'folder' && item.mediaType === 'mp4') ||
        (item.kind === 'action' && item.actionType === 'upload-mp4')
      );
    case 'IMAGE':
      return (
        item.kind === 'image' ||
        (item.kind === 'folder' && item.mediaType === 'picture') ||
        (item.kind === 'action' && item.actionType === 'upload-image')
      );
    case 'AUDIO':
      return (
        item.kind === 'audio' ||
        (item.kind === 'folder' && item.mediaType === 'audio') ||
        (item.kind === 'action' && item.actionType === 'upload-audio')
      );
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
    case 'audio':
      return item.fileName;
    case 'image':
      return item.fileName;
    case 'twitch':
      return item.channel.displayName;
    case 'kick':
      return item.channel.displayName;
    case 'hls-saved':
      return item.name;
    case 'action':
      return ACTION_TYPE_LABELS[item.actionType];
    case 'folder':
      return item.name;
  }
}

const ACTION_TYPE_LABELS: Record<AssetItemAction['actionType'], string> = {
  'upload-mp4': 'UPLOAD MP4',
  'upload-audio': 'UPLOAD AUDIO',
  'upload-image': 'UPLOAD IMAGE',
  hls: 'NEW HLS STREAM',
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
    case 'audio':
      return 'AUDIO';
    case 'image':
      return 'IMG';
    case 'twitch':
      return 'TWITCH';
    case 'kick':
      return 'KICK';
    case 'hls-saved':
      return 'HLS';
    case 'action':
      return item.actionType.toUpperCase();
    case 'folder':
      return 'FOLDER';
  }
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ── Browse helpers ────────────────────────────────────────────

interface BrowseResult {
  files: string[];
  folders: string[];
}

async function browseAssets(
  type: 'mp4s' | 'pictures' | 'audios',
  folder: string,
): Promise<BrowseResult> {
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  const res = await fetch(`/api/suggestions/${type}/browse${qs}`);
  if (!res.ok) return { files: [], folders: [] };
  return res.json();
}

type UploadMediaType = 'mp4' | 'picture' | 'audio';

const UPLOAD_ROUTES: Record<UploadMediaType, string> = {
  mp4: '/api/upload/mp4',
  picture: '/api/upload/picture',
  audio: '/api/upload/audio',
};

const FOLDER_ROUTES: Record<UploadMediaType, string> = {
  mp4: '/api/upload/mp4/folder',
  picture: '/api/upload/picture/folder',
  audio: '/api/upload/audio/folder',
};

async function uploadFile(
  file: File,
  mediaType: UploadMediaType,
  folder: string,
): Promise<{ fileName: string; folder: string }> {
  const formData = new FormData();
  formData.append('file', file);
  if (folder) formData.append('folder', folder);

  const route = UPLOAD_ROUTES[mediaType];
  const res = await fetch(route, { method: 'POST', body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Upload failed');
  }
  return res.json();
}

async function createFolder(
  mediaType: UploadMediaType,
  folder: string,
): Promise<void> {
  const route = FOLDER_ROUTES[mediaType];
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folder }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || 'Failed to create folder');
  }
}

const MP4_ACCEPT = '.mp4,video/mp4';
const AUDIO_ACCEPT = '.wav,.mp3,audio/wav,audio/mpeg';
const PICTURE_ACCEPT = '.jpg,.jpeg,.png,.gif,.svg,.webp,image/*';

function detectMediaType(file: File): UploadMediaType | null {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'mp4') return 'mp4';
  if (['wav', 'mp3'].includes(ext)) return 'audio';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext))
    return 'picture';
  return null;
}

// ── Breadcrumb ───────────────────────────────────────────────

function FolderBreadcrumb({
  currentFolder,
  onNavigate,
}: {
  currentFolder: string;
  onNavigate: (folder: string) => void;
}) {
  const segments = currentFolder ? currentFolder.split('/') : [];

  return (
    <div className='flex items-center gap-1 px-5 py-1.5 bg-[#0e0e0e]/60 border-b border-[#3a494b]/20 font-mono text-[10px]'>
      <button
        onClick={() => onNavigate('')}
        className='text-[#00f3ff] hover:text-[#e3fdff] transition-colors cursor-pointer'>
        ROOT
      </button>
      {segments.map((seg, i) => {
        const pathUpTo = segments.slice(0, i + 1).join('/');
        const isLast = i === segments.length - 1;
        return (
          <span key={pathUpTo} className='flex items-center gap-1'>
            <span className='text-[#3a494b]'>/</span>
            {isLast ? (
              <span className='text-[#e3fdff]'>{seg}</span>
            ) : (
              <button
                onClick={() => onNavigate(pathUpTo)}
                className='text-[#00f3ff] hover:text-[#e3fdff] transition-colors cursor-pointer'>
                {seg}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
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

  const [mp4Folder, setMp4Folder] = useState('');
  const [pictureFolder, setPictureFolder] = useState('');
  const [audioFolder, setAudioFolder] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const showFolderBrowsing =
    filter === 'MP4' || filter === 'IMAGE' || filter === 'AUDIO';
  const activeFolderMediaType: UploadMediaType =
    filter === 'IMAGE' ? 'picture' : filter === 'AUDIO' ? 'audio' : 'mp4';
  const activeFolder =
    filter === 'IMAGE'
      ? pictureFolder
      : filter === 'AUDIO'
        ? audioFolder
        : filter === 'MP4'
          ? mp4Folder
          : '';

  const setActiveFolder = useCallback(
    (folder: string) => {
      if (filter === 'IMAGE') setPictureFolder(folder);
      else if (filter === 'AUDIO') setAudioFolder(folder);
      else if (filter === 'MP4') setMp4Folder(folder);
    },
    [filter],
  );

  const fetchItems = useCallback(async () => {
    setIsLoading(true);
    try {
      const [
        twitchRes,
        kickRes,
        mp4Browse,
        pictureBrowse,
        audioBrowse,
        mp4FlatRes,
        pictureFlatRes,
        audioFlatRes,
        hlsListRes,
      ] = await Promise.all([
        actions
          .getTwitchSuggestions()
          .catch(() => ({ twitch: [] as ChannelSuggestion[] })),
        actions
          .getKickSuggestions()
          .catch(() => ({ kick: [] as ChannelSuggestion[] })),
        browseAssets('mp4s', mp4Folder).catch(() => ({
          files: [] as string[],
          folders: [] as string[],
        })),
        browseAssets('pictures', pictureFolder).catch(() => ({
          files: [] as string[],
          folders: [] as string[],
        })),
        browseAssets('audios', audioFolder).catch(() => ({
          files: [] as string[],
          folders: [] as string[],
        })),
        actions.getMP4Suggestions().catch(() => ({ mp4s: [] as string[] })),
        actions
          .getPictureSuggestions()
          .catch(() => ({ pictures: [] as string[] })),
        actions
          .getAudioSuggestions()
          .catch(() => ({ audios: [] as string[] })),
        actions.hlsStreamStorage
          .list()
          .catch(() => ({ ok: false as const, error: 'failed' })),
      ]);

      const hlsSavedItems: AssetItemHls[] = [];
      if (hlsListRes.ok) {
        const loads = await Promise.all(
          hlsListRes.items.map((info) =>
            actions.hlsStreamStorage
              .load(info.fileName)
              .then((r) =>
                r.ok
                  ? {
                      kind: 'hls-saved' as const,
                      name: r.name,
                      url: r.data.url,
                      fileName: info.fileName,
                    }
                  : null,
              )
              .catch(() => null),
          ),
        );
        for (const item of loads) {
          if (item) hlsSavedItems.push(item);
        }
      }

      const mp4FolderItems: AssetItemFolder[] = mp4Browse.folders.map(
        (name) => ({ kind: 'folder', name, mediaType: 'mp4' }),
      );
      const mp4FileItems: AssetItemMp4[] = mp4Browse.files.map((f) => ({
        kind: 'mp4',
        fileName: mp4Folder ? `${mp4Folder}/${f}` : f,
      }));

      const picFolderItems: AssetItemFolder[] = pictureBrowse.folders.map(
        (name) => ({ kind: 'folder', name, mediaType: 'picture' }),
      );
      const picFileItems: AssetItemImage[] = pictureBrowse.files.map((f) => ({
        kind: 'image',
        fileName: pictureFolder ? `${pictureFolder}/${f}` : f,
      }));

      const audioFolderItems: AssetItemFolder[] = audioBrowse.folders.map(
        (name) => ({ kind: 'folder', name, mediaType: 'audio' }),
      );
      const audioFileItems: AssetItemAudio[] = audioBrowse.files.map((f) => ({
        kind: 'audio',
        fileName: audioFolder ? `${audioFolder}/${f}` : f,
      }));

      const fetched: AssetItem[] = [
        ...mp4FolderItems,
        ...picFolderItems,
        ...audioFolderItems,
        ...hlsSavedItems,
        ...twitchRes.twitch.map(
          (channel): AssetItemTwitch => ({ kind: 'twitch', channel }),
        ),
        ...kickRes.kick.map(
          (channel): AssetItemKick => ({ kind: 'kick', channel }),
        ),
        ...mp4FileItems,
        ...picFileItems,
        ...audioFileItems,
        ...ACTION_CARDS,
      ];

      setItems(fetched);

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
        if (item.kind === 'audio') {
          getAudioDuration(item.fileName)
            .then((durationMs) => {
              setItems((prev) =>
                prev.map((i) =>
                  i.kind === 'audio' && i.fileName === item.fileName
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
  }, [actions, mp4Folder, pictureFolder, audioFolder]);

  useEffect(() => {
    if (open) {
      fetchItems();
      setSelectedItem(null);
    }
  }, [open, fetchItems]);

  useEffect(() => {
    if (open) {
      setMp4Folder('');
      setPictureFolder('');
      setAudioFolder('');
      setFilter('ALL');
      setShowNewFolderInput(false);
    }
  }, [open]);

  const filteredItems = useMemo(
    () => items.filter((item) => itemMatchesFilter(item, filter)),
    [items, filter],
  );

  const handleDone = useCallback(async () => {
    await refreshState();
    onOpenChange(false);
  }, [refreshState, onOpenChange]);

  const handleFolderClick = useCallback(
    (folderItem: AssetItemFolder) => {
      const currentBase =
        folderItem.mediaType === 'mp4'
          ? mp4Folder
          : folderItem.mediaType === 'audio'
            ? audioFolder
            : pictureFolder;
      const newPath = currentBase
        ? `${currentBase}/${folderItem.name}`
        : folderItem.name;
      if (folderItem.mediaType === 'mp4') setMp4Folder(newPath);
      else if (folderItem.mediaType === 'audio') setAudioFolder(newPath);
      else setPictureFolder(newPath);
      setSelectedItem(null);
    },
    [mp4Folder, pictureFolder, audioFolder],
  );

  const handleUploadClick = useCallback(() => {
    if (!fileInputRef.current) return;
    if (filter === 'MP4') {
      fileInputRef.current.accept = MP4_ACCEPT;
    } else if (filter === 'AUDIO') {
      fileInputRef.current.accept = AUDIO_ACCEPT;
    } else if (filter === 'IMAGE') {
      fileInputRef.current.accept = PICTURE_ACCEPT;
    } else {
      fileInputRef.current.accept = `${MP4_ACCEPT},${AUDIO_ACCEPT},${PICTURE_ACCEPT}`;
    }
    fileInputRef.current.click();
  }, [filter]);

  const handleFileSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';

      const mediaType = detectMediaType(file);
      if (!mediaType) {
        toast.error('Unsupported file type.');
        return;
      }

      const folder =
        mediaType === 'mp4'
          ? mp4Folder
          : mediaType === 'audio'
            ? audioFolder
            : pictureFolder;

      setIsUploading(true);
      try {
        await uploadFile(file, mediaType, folder);
        toast.success(`Uploaded "${file.name}"`);
        await fetchItems();
      } catch (err: any) {
        toast.error(err?.message || 'Upload failed');
      } finally {
        setIsUploading(false);
      }
    },
    [mp4Folder, pictureFolder, audioFolder, fetchItems],
  );

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name) return;
    const base =
      activeFolderMediaType === 'mp4'
        ? mp4Folder
        : activeFolderMediaType === 'audio'
          ? audioFolder
          : pictureFolder;
    const fullPath = base ? `${base}/${name}` : name;
    try {
      await createFolder(activeFolderMediaType, fullPath);
      toast.success(`Folder "${name}" created`);
      setNewFolderName('');
      setShowNewFolderInput(false);
      await fetchItems();
    } catch (err: any) {
      toast.error(err?.message || 'Failed to create folder');
    }
  }, [
    newFolderName,
    activeFolderMediaType,
    mp4Folder,
    pictureFolder,
    fetchItems,
  ]);

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
              <div className='flex items-center gap-2'>
                {showFolderBrowsing && (
                  <>
                    <button
                      onClick={() => {
                        setShowNewFolderInput((v) => !v);
                        setNewFolderName('');
                      }}
                      title='New folder'
                      className='px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-[#1c1b1b] text-[#849495] hover:text-[#e3fdff] border border-[#3a494b]/20 transition-colors cursor-pointer'>
                      + FOLDER
                    </button>
                  </>
                )}
                <button
                  onClick={handleUploadClick}
                  disabled={isUploading}
                  title='Upload file'
                  className='px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-[#fe00fe]/20 text-[#fe00fe] hover:bg-[#fe00fe]/30 border border-[#fe00fe]/30 transition-colors cursor-pointer disabled:opacity-40'>
                  {isUploading ? 'UPLOADING...' : 'UPLOAD'}
                </button>
                <input
                  ref={fileInputRef}
                  type='file'
                  className='hidden'
                  onChange={handleFileSelected}
                />
                <span className='font-mono text-[10px] text-[#fe00fe]'>
                  [{filteredItems.length} FILES]
                </span>
              </div>
            </div>
            <div className='flex gap-1.5 flex-wrap'>
              {FILTER_TYPES.map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFilter(f);
                    setSelectedItem(null);
                    setShowNewFolderInput(false);
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
            {showNewFolderInput && (
              <div className='flex items-center gap-2 mt-2'>
                <input
                  type='text'
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateFolder();
                    if (e.key === 'Escape') setShowNewFolderInput(false);
                  }}
                  placeholder='Folder name...'
                  autoFocus
                  className='flex-1 bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] px-2 py-1 focus:border-[#00f3ff]/50 focus:outline-none'
                />
                <button
                  onClick={handleCreateFolder}
                  disabled={!newFolderName.trim()}
                  className='px-3 py-1 text-[10px] font-mono bg-[#00f3ff] text-black font-bold uppercase disabled:opacity-40 cursor-pointer'>
                  CREATE
                </button>
                <button
                  onClick={() => setShowNewFolderInput(false)}
                  className='px-2 py-1 text-[10px] font-mono text-[#849495] hover:text-[#e3fdff] cursor-pointer'>
                  CANCEL
                </button>
              </div>
            )}
          </div>

          {/* Breadcrumb */}
          {showFolderBrowsing && activeFolder && (
            <FolderBreadcrumb
              currentFolder={activeFolder}
              onNavigate={(f) => {
                setActiveFolder(f);
                setSelectedItem(null);
              }}
            />
          )}

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
                      onClick={() => {
                        if (item.kind === 'folder') {
                          handleFolderClick(item);
                        } else {
                          setSelectedItem(item);
                        }
                      }}
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
                    onUploadComplete={fetchItems}
                    currentMp4Folder={mp4Folder}
                    currentPictureFolder={pictureFolder}
                    currentAudioFolder={audioFolder}
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
    (item.kind === 'mp4' || item.kind === 'audio') && item.durationMs != null
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
      case 'audio':
        return 'AUDIO';
      case 'image': {
        const ext = item.fileName.split('.').pop()?.toUpperCase() ?? '';
        return ext;
      }
      case 'hls-saved': {
        try {
          return new URL(item.url).hostname;
        } catch {
          return 'HLS';
        }
      }
      case 'action':
        return 'ACTION';
      case 'folder':
        return item.mediaType === 'mp4'
          ? 'MP4 FOLDER'
          : item.mediaType === 'audio'
            ? 'AUDIO FOLDER'
            : 'IMAGE FOLDER';
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
  if (item.kind === 'audio') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#a855f7]/20 to-[#131313]'>
        <svg
          viewBox='0 0 24 24'
          className='w-10 h-10 opacity-50 group-hover:opacity-70 transition-opacity'
          fill='none'
          stroke='#a855f7'
          strokeWidth='1.5'>
          <path
            d='M9 18V5l12-2v13'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <circle cx='6' cy='18' r='3' />
          <circle cx='18' cy='16' r='3' />
        </svg>
      </div>
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
  if (item.kind === 'hls-saved') {
    return (
      <HlsThumbnailWithFallback fileName={item.fileName} name={item.name} />
    );
  }
  if (item.kind === 'twitch') {
    if (item.channel.thumbnailUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.channel.thumbnailUrl}
          alt={item.channel.displayName}
          className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
        />
      );
    }
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
    if (item.channel.thumbnailUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.channel.thumbnailUrl}
          alt={item.channel.displayName}
          className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
        />
      );
    }
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#53FC18]/15 to-[#131313]'>
        <span className='font-mono font-black text-xl text-[#53FC18]/50 tracking-tighter group-hover:text-[#53FC18]/70 transition-colors'>
          K
        </span>
      </div>
    );
  }
  if (item.kind === 'folder') {
    return (
      <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ffd700]/15 to-[#131313]'>
        <svg
          viewBox='0 0 64 52'
          className='w-12 h-10 opacity-50 group-hover:opacity-70 transition-opacity'>
          <path
            d='M4 8h20l4-6h28a4 4 0 0 1 4 4v38a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4z'
            fill='#ffd700'
            opacity='0.6'
          />
          <path
            d='M0 16h64v28a4 4 0 0 1-4 4H4a4 4 0 0 1-4-4V16z'
            fill='#ffd700'
            opacity='0.8'
          />
        </svg>
      </div>
    );
  }
  if (item.kind === 'action') {
    return <ActionThumbnail actionType={item.actionType} />;
  }
  return null;
}

function HlsFallbackIcon() {
  return (
    <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ff6b00]/15 to-[#131313]'>
      <svg viewBox='0 0 60 60' className='w-10 h-10 opacity-40'>
        <circle cx='30' cy='30' r='6' fill='#ff6b00' />
        <path
          d='M30 18 A12 12 0 0 1 42 30'
          stroke='#ff6b00'
          strokeWidth='2.5'
          fill='none'
          strokeLinecap='round'
        />
        <path
          d='M30 18 A12 12 0 0 0 18 30'
          stroke='#ff6b00'
          strokeWidth='2.5'
          fill='none'
          strokeLinecap='round'
        />
        <path
          d='M30 10 A20 20 0 0 1 50 30'
          stroke='#ff6b00'
          strokeWidth='2'
          fill='none'
          strokeLinecap='round'
          opacity='0.6'
        />
        <path
          d='M30 10 A20 20 0 0 0 10 30'
          stroke='#ff6b00'
          strokeWidth='2'
          fill='none'
          strokeLinecap='round'
          opacity='0.6'
        />
        <path
          d='M30 3 A27 27 0 0 1 57 30'
          stroke='#ff6b00'
          strokeWidth='1.5'
          fill='none'
          strokeLinecap='round'
          opacity='0.35'
        />
        <path
          d='M30 3 A27 27 0 0 0 3 30'
          stroke='#ff6b00'
          strokeWidth='1.5'
          fill='none'
          strokeLinecap='round'
          opacity='0.35'
        />
      </svg>
    </div>
  );
}

function HlsThumbnailWithFallback({
  fileName,
  name,
}: {
  fileName: string;
  name: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return <HlsFallbackIcon />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/api/hls-thumbnail/${encodeURIComponent(fileName)}`}
      alt={name}
      className='w-full h-full object-cover opacity-60 group-hover:scale-105 transition-transform duration-700'
      onError={() => setFailed(true)}
    />
  );
}

function ActionThumbnail({
  actionType,
}: {
  actionType: AssetItemAction['actionType'];
}) {
  switch (actionType) {
    case 'upload-mp4':
    case 'upload-image':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#fe00fe]/15 to-[#131313]'>
          <svg
            viewBox='0 0 24 24'
            className='w-10 h-10 opacity-40'
            fill='none'
            stroke='#fe00fe'
            strokeWidth='1.5'>
            <path
              d='M12 16V4m0 0l-4 4m4-4l4 4'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            <path
              d='M20 16v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          </svg>
        </div>
      );
    case 'upload-audio':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#a855f7]/15 to-[#131313]'>
          <svg
            viewBox='0 0 24 24'
            className='w-10 h-10 opacity-40'
            fill='none'
            stroke='#a855f7'
            strokeWidth='1.5'>
            <path
              d='M9 18V5l12-2v13'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
            <circle cx='6' cy='18' r='3' />
            <circle cx='18' cy='16' r='3' />
          </svg>
        </div>
      );
    case 'hls':
      return (
        <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#ff6b00]/15 to-[#131313]'>
          <svg viewBox='0 0 60 60' className='w-10 h-10 opacity-40'>
            <circle cx='30' cy='30' r='6' fill='#ff6b00' />
            <path
              d='M30 18 A12 12 0 0 1 42 30'
              stroke='#ff6b00'
              strokeWidth='2.5'
              fill='none'
              strokeLinecap='round'
            />
            <path
              d='M30 18 A12 12 0 0 0 18 30'
              stroke='#ff6b00'
              strokeWidth='2.5'
              fill='none'
              strokeLinecap='round'
            />
            <path
              d='M30 10 A20 20 0 0 1 50 30'
              stroke='#ff6b00'
              strokeWidth='2'
              fill='none'
              strokeLinecap='round'
              opacity='0.6'
            />
            <path
              d='M30 10 A20 20 0 0 0 10 30'
              stroke='#ff6b00'
              strokeWidth='2'
              fill='none'
              strokeLinecap='round'
              opacity='0.6'
            />
            <path
              d='M30 3 A27 27 0 0 1 57 30'
              stroke='#ff6b00'
              strokeWidth='1.5'
              fill='none'
              strokeLinecap='round'
              opacity='0.35'
            />
            <path
              d='M30 3 A27 27 0 0 0 3 30'
              stroke='#ff6b00'
              strokeWidth='1.5'
              fill='none'
              strokeLinecap='round'
              opacity='0.35'
            />
          </svg>
        </div>
      );
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
  onUploadComplete,
  currentMp4Folder,
  currentPictureFolder,
  currentAudioFolder,
}: {
  item: AssetItem;
  roomId: string;
  inputs: Input[];
  onDone: () => Promise<void>;
  whipCtx: ReturnType<typeof useWhipConnectionsContext>;
  onUploadComplete: () => Promise<void>;
  currentMp4Folder: string;
  currentPictureFolder: string;
  currentAudioFolder: string;
}) {
  switch (item.kind) {
    case 'mp4':
      return <Mp4Inspector item={item} roomId={roomId} onDone={onDone} />;
    case 'audio':
      return <AudioInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'image':
      return <ImageInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'twitch':
      return <TwitchInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'kick':
      return <KickInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'hls-saved':
      return <HlsSavedInspector item={item} roomId={roomId} onDone={onDone} />;
    case 'folder': {
      const contentLabel =
        item.mediaType === 'mp4'
          ? 'MP4 FILES'
          : item.mediaType === 'audio'
            ? 'AUDIO FILES'
            : 'IMAGES';
      return (
        <div className='space-y-3'>
          <PropRow label='TYPE' value='FOLDER' />
          <PropRow label='NAME' value={item.name} />
          <PropRow label='CONTENT' value={contentLabel} />
          <p className='font-mono text-[10px] text-[#849495]'>
            Click the card to enter this folder.
          </p>
        </div>
      );
    }
    case 'action':
      return (
        <ActionInspector
          item={item}
          roomId={roomId}
          inputs={inputs}
          onDone={onDone}
          whipCtx={whipCtx}
          onUploadComplete={onUploadComplete}
          currentMp4Folder={currentMp4Folder}
          currentPictureFolder={currentPictureFolder}
          currentAudioFolder={currentAudioFolder}
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

function AudioInspector({
  item,
  roomId,
  onDone,
}: {
  item: AssetItemAudio;
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addAudioInput } = useActions();
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addAudioInput(roomId, item.fileName);
      await onDone();
    } catch {
      toast.error('Failed to add audio input.');
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
      <PropRow label='TYPE' value='AUDIO' />
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
      {item.channel.thumbnailUrl && (
        <div className='relative aspect-video bg-black overflow-hidden border border-[#3a494b]/30'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.channel.thumbnailUrl}
            alt={item.channel.displayName}
            className='w-full h-full object-cover'
          />
          <div className='absolute inset-0 scanline opacity-20' />
        </div>
      )}
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
      {item.channel.thumbnailUrl && (
        <div className='relative aspect-video bg-black overflow-hidden border border-[#3a494b]/30'>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.channel.thumbnailUrl}
            alt={item.channel.displayName}
            className='w-full h-full object-cover'
          />
          <div className='absolute inset-0 scanline opacity-20' />
        </div>
      )}
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

// ── Action Inspector (text, game, eq, hands, camera, screenshare, upload) ──

function ActionInspector({
  item,
  roomId,
  inputs,
  onDone,
  whipCtx,
  onUploadComplete,
  currentMp4Folder,
  currentPictureFolder,
  currentAudioFolder,
}: {
  item: AssetItemAction;
  roomId: string;
  inputs: Input[];
  onDone: () => Promise<void>;
  whipCtx: ReturnType<typeof useWhipConnectionsContext>;
  onUploadComplete: () => Promise<void>;
  currentMp4Folder: string;
  currentPictureFolder: string;
  currentAudioFolder: string;
}) {
  switch (item.actionType) {
    case 'upload-mp4':
      return (
        <UploadInspector
          mediaType='mp4'
          currentFolder={currentMp4Folder}
          onUploadComplete={onUploadComplete}
        />
      );
    case 'upload-audio':
      return (
        <UploadInspector
          mediaType='audio'
          currentFolder={currentAudioFolder}
          onUploadComplete={onUploadComplete}
        />
      );
    case 'upload-image':
      return (
        <UploadInspector
          mediaType='picture'
          currentFolder={currentPictureFolder}
          onUploadComplete={onUploadComplete}
        />
      );
    case 'hls':
      return <HlsActionInspector roomId={roomId} onDone={onDone} />;
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

// ── Upload Inspector ─────────────────────────────────────────

function UploadInspector({
  mediaType,
  currentFolder,
  onUploadComplete,
}: {
  mediaType: UploadMediaType;
  currentFolder: string;
  onUploadComplete: () => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const accept =
    mediaType === 'mp4'
      ? MP4_ACCEPT
      : mediaType === 'audio'
        ? AUDIO_ACCEPT
        : PICTURE_ACCEPT;
  const label =
    mediaType === 'mp4' ? 'MP4' : mediaType === 'audio' ? 'AUDIO' : 'IMAGE';

  const doUpload = async (file: File) => {
    setUploading(true);
    try {
      await uploadFile(file, mediaType, currentFolder);
      toast.success(`Uploaded "${file.name}"`);
      await onUploadComplete();
    } catch (err: any) {
      toast.error(err?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) doUpload(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) doUpload(file);
  };

  return (
    <div className='space-y-3'>
      <PropRow label='TYPE' value={`UPLOAD_${label}`} />
      {currentFolder && <PropRow label='TARGET_FOLDER' value={currentFolder} />}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileRef.current?.click()}
        className={`border-2 border-dashed rounded p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors ${
          dragOver
            ? 'border-[#00f3ff] bg-[#00f3ff]/10'
            : 'border-[#3a494b]/40 hover:border-[#00f3ff]/40'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
        <svg
          viewBox='0 0 24 24'
          className='w-8 h-8 text-[#849495]'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.5'>
          <path
            d='M12 16V4m0 0l-4 4m4-4l4 4'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
          <path
            d='M20 16v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
        <span className='font-mono text-[10px] text-[#849495]'>
          {uploading ? 'UPLOADING...' : `DROP ${label} FILE OR CLICK`}
        </span>
      </div>
      <input
        ref={fileRef}
        type='file'
        accept={accept}
        className='hidden'
        onChange={handleFileChange}
      />
    </div>
  );
}

function HlsSavedInspector({
  item,
  roomId,
  onDone,
}: {
  item: AssetItemHls;
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addHlsInput, hlsStreamStorage } = useActions();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleAdd = async () => {
    setLoading(true);
    try {
      await addHlsInput(roomId, item.url);
      await onDone();
    } catch {
      toast.error('Failed to add HLS stream.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const result = await hlsStreamStorage.remove(item.fileName);
      if (result.ok) {
        toast.success('HLS stream removed from library.');
        await onDone();
      } else {
        toast.error('Failed to remove HLS stream.');
      }
    } catch {
      toast.error('Failed to remove HLS stream.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className='space-y-3'>
      <div className='relative aspect-video bg-black overflow-hidden border border-[#3a494b]/30'>
        <HlsThumbnailWithFallback fileName={item.fileName} name={item.name} />
        <div className='absolute inset-0 scanline opacity-20' />
      </div>
      <PropRow label='NAME' value={item.name} />
      <div className='space-y-1'>
        <span className='text-[10px] font-mono text-[#849495]'>URL</span>
        <p className='text-[10px] font-mono text-[#e3fdff] leading-tight break-all'>
          {item.url}
        </p>
      </div>
      <PropRow label='TYPE' value='HLS_STREAM' />
      <InitiateButton
        label='INITIATE_STREAM'
        onClick={handleAdd}
        loading={loading}
      />
      <button
        onClick={handleDelete}
        disabled={deleting}
        className='w-full py-1.5 bg-transparent border border-[#fe00fe]/40 text-[#fe00fe] font-mono text-[10px] uppercase tracking-widest hover:bg-[#fe00fe]/10 transition-colors disabled:opacity-40'>
        {deleting ? 'REMOVING...' : 'REMOVE_FROM_LIBRARY'}
      </button>
    </div>
  );
}

function HlsActionInspector({
  roomId,
  onDone,
}: {
  roomId: string;
  onDone: () => Promise<void>;
}) {
  const { addHlsInput, hlsStreamStorage } = useActions();
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [saveToLibrary, setSaveToLibrary] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleAdd = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      toast.error('Enter an HLS URL.');
      return;
    }
    setLoading(true);
    try {
      await addHlsInput(roomId, trimmed);
      if (saveToLibrary) {
        let streamName = name.trim();
        if (!streamName) {
          try {
            streamName = new URL(trimmed).hostname;
          } catch {
            streamName = trimmed.slice(0, 40);
          }
        }
        await hlsStreamStorage.save(streamName, { url: trimmed });
      }
      await onDone();
    } catch {
      toast.error('Failed to add HLS stream.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='space-y-3'>
      <PropRow label='TYPE' value='NEW_HLS_STREAM' />
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          STREAM_URL
        </span>
        <input
          type='text'
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className='w-full bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] px-2 py-1.5 focus:border-[#00f3ff]/50 focus:outline-none'
          placeholder='https://example.com/stream.m3u8'
        />
      </div>
      <div>
        <span className='text-[10px] font-mono text-[#849495] block mb-1'>
          STREAM_NAME
        </span>
        <input
          type='text'
          value={name}
          onChange={(e) => setName(e.target.value)}
          className='w-full bg-[#1c1b1b] border border-[#3a494b]/30 text-[#e3fdff] font-mono text-[11px] px-2 py-1.5 focus:border-[#00f3ff]/50 focus:outline-none'
          placeholder='(auto from hostname)'
        />
      </div>
      <label className='flex items-center gap-2 cursor-pointer'>
        <Checkbox
          checked={saveToLibrary}
          onCheckedChange={(checked) => setSaveToLibrary(!!checked)}
        />
        <span className='text-[10px] font-mono text-[#849495]'>
          SAVE_TO_LIBRARY
        </span>
      </label>
      <InitiateButton
        label='INITIATE_STREAM'
        onClick={handleAdd}
        loading={loading}
        disabled={!url.trim()}
      />
    </div>
  );
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
  'hls',
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
