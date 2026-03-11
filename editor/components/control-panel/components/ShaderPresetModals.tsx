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
import type { ShaderConfig } from '@/lib/types';
import type { SavedItemInfo } from '@/lib/storage-client';
import { useActions } from '../contexts/actions-context';
import { SNAKE_SHADER_PRESETS } from '@/lib/snake-shader-presets';
import { RemoteItemList } from '@/components/storage-modals';
import {
  HardDrive,
  Cloud,
  Loader2,
  FileJson,
  ArrowLeft,
  Replace,
  ListPlus,
  Pencil,
} from 'lucide-react';

type SaveShaderPresetModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shaders: ShaderConfig[];
  existingPreset?: { fileName: string; name: string } | null;
};

export function SaveShaderPresetModal({
  open,
  onOpenChange,
  shaders,
  existingPreset,
}: SaveShaderPresetModalProps) {
  const { shaderPresetStorage } = useActions();
  const [mode, setMode] = useState<'choose' | 'remote' | 'update'>('choose');
  const [presetName, setPresetName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMode('choose');
      setPresetName('');
      setIsSaving(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (mode === 'remote' && inputRef.current) {
      inputRef.current.focus();
    }
    if (mode === 'update' && existingPreset) {
      setPresetName(existingPreset.name);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [mode, existingPreset]);

  const handleSaveLocal = useCallback(() => {
    const name = `shader-preset-${Date.now()}`;
    const blob = new Blob([JSON.stringify({ name, shaders }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onOpenChange(false);
  }, [shaders, onOpenChange]);

  const handleSaveRemote = useCallback(async () => {
    if (!presetName.trim()) return;
    setIsSaving(true);
    setError(null);
    const result = await shaderPresetStorage.save(presetName.trim(), shaders);
    setIsSaving(false);
    if (result.ok) {
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }, [presetName, shaders, shaderPresetStorage, onOpenChange]);

  const handleUpdate = useCallback(async () => {
    if (!existingPreset || !presetName.trim()) return;
    setIsSaving(true);
    setError(null);
    const result = await shaderPresetStorage.update(
      existingPreset.fileName,
      presetName.trim(),
      shaders,
    );
    setIsSaving(false);
    if (result.ok) {
      onOpenChange(false);
    } else {
      setError(result.error);
    }
  }, [existingPreset, presetName, shaders, shaderPresetStorage, onOpenChange]);

  const btnBase =
    'flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left';

  const showNameInput = mode === 'remote' || mode === 'update';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose'
              ? 'Save Shader Preset'
              : mode === 'update'
                ? 'Update Preset'
                : 'Save to Server'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose'
              ? 'Choose where to save your shader preset.'
              : mode === 'update'
                ? 'Update the name and save current shader values.'
                : 'Enter a name for this shader preset.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className='flex flex-col gap-2'>
            {existingPreset && (
              <button onClick={() => setMode('update')} className={btnBase}>
                <Pencil className='w-5 h-5 text-neutral-400 shrink-0' />
                <div className='flex flex-col min-w-0'>
                  <span className='text-sm font-medium text-white'>
                    Update &quot;{existingPreset.name}&quot;
                  </span>
                  <span className='text-xs text-neutral-500'>
                    Overwrite the existing preset
                  </span>
                </div>
              </button>
            )}
            <button onClick={handleSaveLocal} className={btnBase}>
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
              placeholder='Preset name...'
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  mode === 'update' ? handleUpdate() : handleSaveRemote();
                }
              }}
              className='w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors'
            />
            {error && <p className='text-xs text-red-400'>{error}</p>}
            <Button
              onClick={mode === 'update' ? handleUpdate : handleSaveRemote}
              disabled={!presetName.trim() || isSaving}
              className='w-full'>
              {isSaving ? (
                <>
                  <Loader2 className='w-4 h-4 animate-spin' />
                  Saving...
                </>
              ) : (
                <>
                  <Cloud className='w-4 h-4' />
                  {mode === 'update' ? 'Update' : 'Save'}
                </>
              )}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

type LoadShaderPresetModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (shaders: ShaderConfig[], mode: 'replace' | 'append') => void;
};

export function LoadShaderPresetModal({
  open,
  onOpenChange,
  onApply,
}: LoadShaderPresetModalProps) {
  const { shaderPresetStorage } = useActions();
  const [mode, setMode] = useState<'choose' | 'remote' | 'apply'>('choose');
  const [items, setItems] = useState<SavedItemInfo[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingShaders, setPendingShaders] = useState<ShaderConfig[] | null>(
    null,
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMode('choose');
      setItems([]);
      setLoadingFile(null);
      setDeletingFile(null);
      setError(null);
      setPendingShaders(null);
    }
  }, [open]);

  const fetchPresets = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    const result = await shaderPresetStorage.list();
    if (result.ok) {
      setItems(result.items);
    } else {
      setError(result.error);
    }
    setIsLoadingList(false);
  }, [shaderPresetStorage]);

  const handleGoToRemote = useCallback(() => {
    setMode('remote');
    fetchPresets();
  }, [fetchPresets]);

  const handleLoadRemote = useCallback(
    async (fileName: string) => {
      setLoadingFile(fileName);
      setError(null);
      const result = await shaderPresetStorage.load(fileName);
      if (result.ok) {
        setPendingShaders(result.data);
        setMode('apply');
      } else {
        setError(result.error);
      }
      setLoadingFile(null);
    },
    [shaderPresetStorage],
  );

  const handleLoadBuiltIn = useCallback((shaders: ShaderConfig[]) => {
    setPendingShaders(shaders);
    setMode('apply');
  }, []);

  const handleDelete = useCallback(
    async (fileName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeletingFile(fileName);
      const result = await shaderPresetStorage.remove(fileName);
      if (result.ok) {
        setItems((prev) => prev.filter((p) => p.fileName !== fileName));
      } else {
        setError(result.error);
      }
      setDeletingFile(null);
    },
    [shaderPresetStorage],
  );

  const handleLoadLocal = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          if (!parsed.shaders || !Array.isArray(parsed.shaders)) {
            setError('Invalid shader preset file: missing shaders array');
            return;
          }
          setPendingShaders(parsed.shaders);
          setMode('apply');
        } catch {
          setError('Failed to parse JSON file');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    },
    [],
  );

  const handleApply = useCallback(
    (applyMode: 'replace' | 'append') => {
      if (pendingShaders) {
        onApply(pendingShaders, applyMode);
        onOpenChange(false);
      }
    },
    [pendingShaders, onApply, onOpenChange],
  );

  const btnBase =
    'flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose'
              ? 'Load Shader Preset'
              : mode === 'apply'
                ? 'Apply Preset'
                : 'Load from Server'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose'
              ? 'Choose where to load your shader preset from.'
              : mode === 'apply'
                ? 'How should this preset be applied?'
                : 'Select a shader preset to load.'}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type='file'
          accept='.json'
          className='hidden'
          onChange={handleFileSelected}
        />

        {mode === 'choose' ? (
          <div className='flex flex-col gap-2'>
            <button onClick={handleLoadLocal} className={btnBase}>
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
                  Browse saved presets
                </span>
              </div>
            </button>
          </div>
        ) : mode === 'apply' ? (
          <div className='flex flex-col gap-2'>
            <button
              onClick={() => {
                setPendingShaders(null);
                setMode('choose');
              }}
              className='flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors self-start cursor-pointer'>
              <ArrowLeft className='w-3 h-3' />
              Back
            </button>
            <button onClick={() => handleApply('replace')} className={btnBase}>
              <Replace className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Replace existing shaders
                </span>
                <span className='text-xs text-neutral-500'>
                  Remove current shaders and apply preset
                </span>
              </div>
            </button>
            <button onClick={() => handleApply('append')} className={btnBase}>
              <ListPlus className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Append to existing shaders
                </span>
                <span className='text-xs text-neutral-500'>
                  Keep current shaders and add preset shaders
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
            ) : (
              <div className='flex flex-col gap-1.5 max-h-80 overflow-y-auto pr-1'>
                {items.length > 0 && (
                  <>
                    <div className='text-[11px] text-neutral-500 uppercase tracking-wider font-semibold px-1 pt-1'>
                      Custom
                    </div>
                    <RemoteItemList
                      items={items}
                      loadingFile={loadingFile}
                      deletingFile={deletingFile}
                      onLoad={handleLoadRemote}
                      onDelete={handleDelete}
                    />
                  </>
                )}

                <div className='text-[11px] text-neutral-500 uppercase tracking-wider font-semibold px-1 pt-2'>
                  Built-in
                </div>
                {SNAKE_SHADER_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => handleLoadBuiltIn(preset.shaders)}
                    className='flex items-center gap-3 w-full px-3 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left'>
                    <FileJson className='w-4 h-4 text-neutral-500 shrink-0' />
                    <div className='flex flex-col min-w-0 flex-1'>
                      <span className='text-sm font-medium text-white truncate'>
                        {preset.name}
                      </span>
                      <span className='text-[11px] text-neutral-500'>
                        Built-in preset
                      </span>
                    </div>
                  </button>
                ))}

                {items.length === 0 &&
                  SNAKE_SHADER_PRESETS.length === 0 &&
                  !error && (
                    <div className='text-center py-8 text-sm text-neutral-500'>
                      No shader presets found.
                    </div>
                  )}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
