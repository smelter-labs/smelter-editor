'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  listRemoteConfigs,
  loadRemoteConfig,
  deleteRemoteConfig,
  type SavedConfigInfo,
} from '@/app/actions/actions';
import type { RoomConfig } from '@/lib/room-config';
import {
  HardDrive,
  Cloud,
  Trash2,
  Loader2,
  FileJson,
  ArrowLeft,
} from 'lucide-react';

type SaveConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaveLocal: () => void;
  onSaveRemote: (name: string) => Promise<string | null>;
  isExporting: boolean;
};

export function SaveConfigModal({
  open,
  onOpenChange,
  onSaveLocal,
  onSaveRemote,
  isExporting,
}: SaveConfigModalProps) {
  const [mode, setMode] = useState<'choose' | 'remote'>('choose');
  const [configName, setConfigName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMode('choose');
      setConfigName('');
      setIsSaving(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (mode === 'remote' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [mode]);

  const handleSaveRemote = useCallback(async () => {
    if (!configName.trim()) return;
    setIsSaving(true);
    setError(null);
    const err = await onSaveRemote(configName.trim());
    setIsSaving(false);
    if (err) {
      setError(err);
    } else {
      onOpenChange(false);
    }
  }, [configName, onSaveRemote, onOpenChange]);

  const handleSaveLocal = useCallback(() => {
    onSaveLocal();
    onOpenChange(false);
  }, [onSaveLocal, onOpenChange]);

  const btnBase =
    'flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose' ? 'Save Configuration' : 'Save to Server'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose'
              ? 'Choose where to save your room configuration.'
              : 'Enter a name for this configuration.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className='flex flex-col gap-2'>
            <button
              onClick={handleSaveLocal}
              disabled={isExporting}
              className={btnBase}>
              <HardDrive className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Save to file
                </span>
                <span className='text-xs text-neutral-500'>
                  Download as JSON file
                </span>
              </div>
            </button>
            <button onClick={() => setMode('remote')} className={btnBase}>
              <Cloud className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Save to server
                </span>
                <span className='text-xs text-neutral-500'>
                  Store on server for later use
                </span>
              </div>
            </button>
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            <button
              onClick={() => {
                setMode('choose');
                setError(null);
              }}
              className='flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors self-start cursor-pointer'>
              <ArrowLeft className='w-3 h-3' />
              Back
            </button>
            <input
              ref={inputRef}
              type='text'
              placeholder='Configuration name...'
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRemote();
              }}
              className='w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors'
            />
            {error && <p className='text-xs text-red-400'>{error}</p>}
            <Button
              onClick={handleSaveRemote}
              disabled={!configName.trim() || isSaving}
              className='w-full'>
              {isSaving ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  Saving...
                </>
              ) : (
                <>
                  <Cloud className='w-4 h-4' />
                  Save
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type LoadConfigModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoadLocal: () => void;
  onLoadRemote: (config: RoomConfig) => Promise<void>;
  isImporting: boolean;
};

export function LoadConfigModal({
  open,
  onOpenChange,
  onLoadLocal,
  onLoadRemote,
  isImporting,
}: LoadConfigModalProps) {
  const [mode, setMode] = useState<'choose' | 'remote'>('choose');
  const [configs, setConfigs] = useState<SavedConfigInfo[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode('choose');
      setConfigs([]);
      setLoadingFile(null);
      setDeletingFile(null);
      setError(null);
    }
  }, [open]);

  const fetchConfigs = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    const result = await listRemoteConfigs();
    if (result.ok) {
      setConfigs(result.configs);
    } else {
      setError(result.error);
    }
    setIsLoadingList(false);
  }, []);

  const handleGoToRemote = useCallback(() => {
    setMode('remote');
    fetchConfigs();
  }, [fetchConfigs]);

  const handleLoadRemote = useCallback(
    async (fileName: string) => {
      setLoadingFile(fileName);
      setError(null);
      const result = await loadRemoteConfig(fileName);
      if (result.ok) {
        await onLoadRemote(result.config as RoomConfig);
        onOpenChange(false);
      } else {
        setError(result.error);
      }
      setLoadingFile(null);
    },
    [onLoadRemote, onOpenChange],
  );

  const handleDelete = useCallback(
    async (fileName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeletingFile(fileName);
      const result = await deleteRemoteConfig(fileName);
      if (result.ok) {
        setConfigs((prev) => prev.filter((c) => c.fileName !== fileName));
      } else {
        setError(result.error);
      }
      setDeletingFile(null);
    },
    [],
  );

  const handleLoadLocal = useCallback(() => {
    onLoadLocal();
    onOpenChange(false);
  }, [onLoadLocal, onOpenChange]);

  const btnBase =
    'flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left';

  const formatDate = (savedAt: string) => {
    try {
      return new Date(savedAt).toLocaleString();
    } catch {
      return savedAt;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose' ? 'Load Configuration' : 'Load from Server'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose'
              ? 'Choose where to load your room configuration from.'
              : 'Select a saved configuration to load.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className='flex flex-col gap-2'>
            <button
              onClick={handleLoadLocal}
              disabled={isImporting}
              className={btnBase}>
              <HardDrive className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Load from file
                </span>
                <span className='text-xs text-neutral-500'>
                  Import from a JSON file
                </span>
              </div>
            </button>
            <button onClick={handleGoToRemote} className={btnBase}>
              <Cloud className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Load from server
                </span>
                <span className='text-xs text-neutral-500'>
                  Browse saved configurations
                </span>
              </div>
            </button>
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            <button
              onClick={() => {
                setMode('choose');
                setError(null);
              }}
              className='flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors self-start cursor-pointer'>
              <ArrowLeft className='w-3 h-3' />
              Back
            </button>

            {error && <p className='text-xs text-red-400'>{error}</p>}

            {isLoadingList ? (
              <div className='flex items-center justify-center py-8'>
                <Loader2 className='w-5 h-5 animate-spin text-neutral-500' />
              </div>
            ) : configs.length === 0 && !error ? (
              <div className='text-center py-8 text-sm text-neutral-500'>
                No saved configurations found.
              </div>
            ) : (
              <div className='flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1'>
                {configs.map((cfg) => (
                  <button
                    key={cfg.fileName}
                    onClick={() => handleLoadRemote(cfg.fileName)}
                    disabled={!!loadingFile || !!deletingFile}
                    className='flex items-center gap-3 w-full px-3 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left group disabled:opacity-50'>
                    <FileJson className='w-4 h-4 text-neutral-500 shrink-0' />
                    <div className='flex flex-col min-w-0 flex-1'>
                      <span className='text-sm font-medium text-white truncate'>
                        {cfg.name}
                      </span>
                      <span className='text-[11px] text-neutral-500'>
                        {formatDate(cfg.savedAt)}
                      </span>
                    </div>
                    {loadingFile === cfg.fileName ? (
                      <Loader2 className='w-3.5 h-3.5 animate-spin text-neutral-400 shrink-0' />
                    ) : (
                      <button
                        onClick={(e) => handleDelete(cfg.fileName, e)}
                        disabled={!!deletingFile}
                        className='opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-900/30 transition-all cursor-pointer shrink-0'>
                        {deletingFile === cfg.fileName ? (
                          <Loader2 className='w-3.5 h-3.5 animate-spin text-neutral-400' />
                        ) : (
                          <Trash2 className='w-3.5 h-3.5 text-red-400' />
                        )}
                      </button>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
