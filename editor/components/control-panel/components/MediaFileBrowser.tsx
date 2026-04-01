'use client';

import { useEffect, useMemo, useState } from 'react';
import { getAudioDuration, getMp4Duration } from '@/app/actions/actions';

type MediaBrowserType = 'mp4' | 'audio';

type MediaFileItem = {
  fileName: string;
  durationMs?: number;
};

interface BrowseResult {
  files: string[];
  folders: string[];
}

export interface MediaFileBrowserProps {
  mediaType: MediaBrowserType;
  onSelect: (fileName: string) => void;
  disabled?: boolean;
  selectedFile?: string;
  className?: string;
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

async function browseAssets(
  type: 'mp4s' | 'audios',
  folder: string,
): Promise<BrowseResult> {
  const qs = folder ? `?folder=${encodeURIComponent(folder)}` : '';
  const res = await fetch(`/api/suggestions/${type}/browse${qs}`);
  if (!res.ok) {
    return { files: [], folders: [] };
  }
  return res.json();
}

function FolderBreadcrumb({
  currentFolder,
  onNavigate,
}: {
  currentFolder: string;
  onNavigate: (folder: string) => void;
}) {
  const segments = currentFolder ? currentFolder.split('/') : [];

  return (
    <div className='flex items-center gap-1 px-3 py-2 bg-[#0e0e0e]/60 border border-[#3a494b]/20 font-mono text-[10px] rounded-sm'>
      <button
        type='button'
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
                type='button'
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

function AudioThumbnail() {
  return (
    <div className='w-full h-full flex items-center justify-center bg-gradient-to-br from-[#a855f7]/20 to-[#131313]'>
      <svg
        viewBox='0 0 24 24'
        className='w-10 h-10 opacity-50'
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

export function MediaFileBrowser({
  mediaType,
  onSelect,
  disabled = false,
  selectedFile,
  className,
}: MediaFileBrowserProps) {
  const [folder, setFolder] = useState('');
  const [folders, setFolders] = useState<string[]>([]);
  const [files, setFiles] = useState<MediaFileItem[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const result = await browseAssets(
          mediaType === 'mp4' ? 'mp4s' : 'audios',
          folder,
        );

        if (cancelled) return;

        setFolders(result.folders);
        const baseFiles = result.files.map((fileName) => ({
          fileName: folder ? `${folder}/${fileName}` : fileName,
        }));
        setFiles(baseFiles);

        for (const item of baseFiles) {
          const durationPromise =
            mediaType === 'mp4'
              ? getMp4Duration(item.fileName)
              : getAudioDuration(item.fileName);

          durationPromise
            .then((durationMs) => {
              if (cancelled) return;
              setFiles((prev) =>
                prev.map((file) =>
                  file.fileName === item.fileName
                    ? { ...file, durationMs }
                    : file,
                ),
              );
            })
            .catch(() => {});
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [folder, mediaType]);

  const emptyLabel = useMemo(
    () => (mediaType === 'mp4' ? 'No MP4 files found' : 'No audio files found'),
    [mediaType],
  );

  return (
    <div className={className}>
      <div className='space-y-3'>
        {folder && (
          <FolderBreadcrumb currentFolder={folder} onNavigate={setFolder} />
        )}

        {loading ? (
          <div className='flex items-center justify-center h-40 border border-[#3a494b]/20 rounded-sm bg-[#0a0a0a]'>
            <span className='font-mono text-xs text-[#849495] animate-pulse'>
              SCANNING_FILES...
            </span>
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className='flex items-center justify-center h-40 border border-[#3a494b]/20 rounded-sm bg-[#0a0a0a]'>
            <span className='font-mono text-xs text-[#849495]'>
              {emptyLabel}
            </span>
          </div>
        ) : (
          <div className='grid grid-cols-2 gap-3 max-h-[360px] overflow-y-auto pr-1'>
            {folders.map((name) => (
              <button
                key={`folder:${name}`}
                type='button'
                disabled={disabled}
                onClick={() =>
                  setFolder((prev) => (prev ? `${prev}/${name}` : name))
                }
                className='text-left bg-[#1c1b1b] border border-[#3a494b]/30 hover:border-[#00f3ff]/60 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'>
                <div className='relative aspect-video bg-gradient-to-br from-[#ffd700]/15 to-[#131313] flex items-center justify-center'>
                  <svg viewBox='0 0 64 52' className='w-12 h-10 opacity-50'>
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
                <div className='p-2 border-t border-[#3a494b]/20'>
                  <div className='font-mono text-[11px] text-[#e3fdff] truncate'>
                    {name}
                  </div>
                  <div className='font-mono text-[10px] text-[#849495]'>
                    FOLDER
                  </div>
                </div>
              </button>
            ))}

            {files.map((file) => {
              const isSelected = selectedFile === file.fileName;
              return (
                <button
                  key={file.fileName}
                  type='button'
                  disabled={disabled}
                  onClick={() => onSelect(file.fileName)}
                  className={`text-left bg-[#1c1b1b] border border-[#3a494b]/30 hover:border-[#00f3ff]/60 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                    isSelected
                      ? 'border-l-2 border-l-[#fe00fe] neon-glow-secondary'
                      : ''
                  }`}>
                  <div className='relative aspect-video bg-black overflow-hidden'>
                    {mediaType === 'mp4' ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/mp4-thumbnail?fileName=${encodeURIComponent(file.fileName)}`}
                        alt={file.fileName}
                        className='w-full h-full object-cover opacity-60'
                      />
                    ) : (
                      <AudioThumbnail />
                    )}
                    <div className='absolute inset-0 scanline opacity-30' />
                    <div className='absolute top-1.5 left-1.5 px-1 bg-black/80 text-[10px] font-mono text-[#00f3ff] border border-[#00f3ff]/30'>
                      {mediaType === 'mp4' ? 'MP4' : 'AUDIO'}
                    </div>
                    {file.durationMs != null && (
                      <div className='absolute bottom-1.5 right-1.5 px-1 bg-black/80 text-[10px] font-mono text-[#fe00fe]'>
                        {formatDuration(file.durationMs)}
                      </div>
                    )}
                  </div>
                  <div className='p-2 border-t border-[#3a494b]/20'>
                    <div className='font-mono text-[11px] text-[#e3fdff] truncate'>
                      {file.fileName}
                    </div>
                    <div className='font-mono text-[10px] text-[#849495]'>
                      {mediaType === 'mp4'
                        ? (file.fileName.split('.').pop()?.toUpperCase() ??
                          'MP4')
                        : 'AUDIO'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
