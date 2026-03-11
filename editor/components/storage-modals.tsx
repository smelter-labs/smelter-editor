'use client';

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { SavedItemInfo, StorageClient } from '@/lib/storage-client';
import {
  HardDrive,
  Cloud,
  Trash2,
  Loader2,
  FileJson,
  ArrowLeft,
} from 'lucide-react';

// ── Shared helpers ───────────────────────────────────────────

function formatDate(savedAt: string) {
  try {
    return new Date(savedAt).toLocaleString();
  } catch {
    return savedAt;
  }
}

const btnBase =
  'flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left';

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className='flex items-center gap-1.5 text-xs text-neutral-500 hover:text-neutral-300 transition-colors self-start cursor-pointer'>
      <ArrowLeft className='w-3 h-3' />
      Back
    </button>
  );
}

// ── Remote item list ─────────────────────────────────────────

export function RemoteItemList({
  items,
  loadingFile,
  deletingFile,
  onLoad,
  onDelete,
}: {
  items: SavedItemInfo[];
  loadingFile: string | null;
  deletingFile: string | null;
  onLoad: (fileName: string) => void;
  onDelete: (fileName: string, e: React.MouseEvent) => void;
}) {
  return (
    <div className='flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1'>
      {items.map((item) => (
        <button
          key={item.fileName}
          onClick={() => onLoad(item.fileName)}
          disabled={!!loadingFile || !!deletingFile}
          className='flex items-center gap-3 w-full px-3 py-2.5 rounded-md border border-neutral-800 bg-neutral-900 hover:bg-neutral-800 hover:border-neutral-600 transition-all cursor-pointer text-left group disabled:opacity-50'>
          <FileJson className='w-4 h-4 text-neutral-500 shrink-0' />
          <div className='flex flex-col min-w-0 flex-1'>
            <span className='text-sm font-medium text-white truncate'>
              {item.name}
            </span>
            <span className='text-[11px] text-neutral-500'>
              {formatDate(item.savedAt)}
            </span>
          </div>
          {loadingFile === item.fileName ? (
            <Loader2 className='w-3.5 h-3.5 animate-spin text-neutral-400 shrink-0' />
          ) : (
            <button
              onClick={(e) => onDelete(item.fileName, e)}
              disabled={!!deletingFile}
              className='opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-900/30 transition-all cursor-pointer shrink-0'>
              {deletingFile === item.fileName ? (
                <Loader2 className='w-3.5 h-3.5 animate-spin text-neutral-400' />
              ) : (
                <Trash2 className='w-3.5 h-3.5 text-red-400' />
              )}
            </button>
          )}
        </button>
      ))}
    </div>
  );
}

// ── GenericSaveModal ─────────────────────────────────────────

export type SaveModalExtraOption = {
  id: string;
  icon: ReactNode;
  label: string;
  description: string;
  onClick: () => void;
};

type GenericSaveModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  namePlaceholder?: string;
  onSaveLocal?: () => void;
  onSaveRemote: (name: string) => Promise<string | null>;
  isExporting?: boolean;
  extraOptions?: SaveModalExtraOption[];
};

export function GenericSaveModal({
  open,
  onOpenChange,
  title,
  description,
  namePlaceholder = 'Name...',
  onSaveLocal,
  onSaveRemote,
  isExporting,
  extraOptions,
}: GenericSaveModalProps) {
  const [mode, setMode] = useState<'choose' | 'remote'>('choose');
  const [itemName, setItemName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setMode('choose');
      setItemName('');
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
    if (!itemName.trim()) return;
    setIsSaving(true);
    setError(null);
    const err = await onSaveRemote(itemName.trim());
    setIsSaving(false);
    if (err) {
      setError(err);
    } else {
      onOpenChange(false);
    }
  }, [itemName, onSaveRemote, onOpenChange]);

  const handleSaveLocal = useCallback(() => {
    onSaveLocal?.();
    onOpenChange(false);
  }, [onSaveLocal, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose' ? title : 'Save to Server'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose'
              ? (description ?? `Choose where to save.`)
              : `Enter a name.`}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className='flex flex-col gap-2'>
            {extraOptions?.map((opt) => (
              <button key={opt.id} onClick={opt.onClick} className={btnBase}>
                {opt.icon}
                <div className='flex flex-col min-w-0'>
                  <span className='text-sm font-medium text-white'>
                    {opt.label}
                  </span>
                  <span className='text-xs text-neutral-500'>
                    {opt.description}
                  </span>
                </div>
              </button>
            ))}
            {onSaveLocal && (
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
            )}
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
            <BackButton
              onClick={() => {
                setMode('choose');
                setError(null);
              }}
            />
            <input
              ref={inputRef}
              type='text'
              placeholder={namePlaceholder}
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveRemote();
              }}
              className='w-full px-3 py-2 rounded-md border border-neutral-700 bg-neutral-900 text-sm text-white placeholder:text-neutral-500 focus:outline-none focus:border-neutral-500 transition-colors'
            />
            {error && <p className='text-xs text-red-400'>{error}</p>}
            <Button
              onClick={handleSaveRemote}
              disabled={!itemName.trim() || isSaving}
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

// ── GenericLoadModal ─────────────────────────────────────────

type GenericLoadModalProps<T> = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  storage: StorageClient<T>;
  onLoadLocal?: () => void;
  onLoadRemote: (data: T) => void | Promise<void>;
  emptyMessage?: string;
  extraSections?: ReactNode;
};

export function GenericLoadModal<T>({
  open,
  onOpenChange,
  title,
  description,
  storage,
  onLoadLocal,
  onLoadRemote,
  emptyMessage = 'No saved items found.',
  extraSections,
}: GenericLoadModalProps<T>) {
  const [mode, setMode] = useState<'choose' | 'remote'>('choose');
  const [items, setItems] = useState<SavedItemInfo[]>([]);
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [loadingFile, setLoadingFile] = useState<string | null>(null);
  const [deletingFile, setDeletingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setMode('choose');
      setItems([]);
      setLoadingFile(null);
      setDeletingFile(null);
      setError(null);
    }
  }, [open]);

  const fetchItems = useCallback(async () => {
    setIsLoadingList(true);
    setError(null);
    const result = await storage.list();
    if (result.ok) {
      setItems(result.items);
    } else {
      setError(result.error);
    }
    setIsLoadingList(false);
  }, [storage]);

  const handleGoToRemote = useCallback(() => {
    setMode('remote');
    fetchItems();
  }, [fetchItems]);

  const handleLoadRemote = useCallback(
    async (fileName: string) => {
      setLoadingFile(fileName);
      setError(null);
      const result = await storage.load(fileName);
      if (result.ok) {
        await onLoadRemote(result.data);
        onOpenChange(false);
      } else {
        setError(result.error);
      }
      setLoadingFile(null);
    },
    [storage, onLoadRemote, onOpenChange],
  );

  const handleDelete = useCallback(
    async (fileName: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setDeletingFile(fileName);
      const result = await storage.remove(fileName);
      if (result.ok) {
        setItems((prev) => prev.filter((c) => c.fileName !== fileName));
      } else {
        setError(result.error);
      }
      setDeletingFile(null);
    },
    [storage],
  );

  const handleLoadLocal = useCallback(() => {
    onLoadLocal?.();
    onOpenChange(false);
  }, [onLoadLocal, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-sm'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'choose' ? title : 'Load from Server'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'choose'
              ? (description ?? 'Choose where to load from.')
              : 'Select an item to load.'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className='flex flex-col gap-2'>
            {onLoadLocal && (
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
            )}
            <button onClick={handleGoToRemote} className={btnBase}>
              <Cloud className='w-5 h-5 text-neutral-400 shrink-0' />
              <div className='flex flex-col min-w-0'>
                <span className='text-sm font-medium text-white'>
                  Load from server
                </span>
                <span className='text-xs text-neutral-500'>
                  Browse saved items
                </span>
              </div>
            </button>
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            <BackButton
              onClick={() => {
                setMode('choose');
                setError(null);
              }}
            />

            {error && <p className='text-xs text-red-400'>{error}</p>}

            {isLoadingList ? (
              <div className='flex items-center justify-center py-8'>
                <Loader2 className='w-5 h-5 animate-spin text-neutral-500' />
              </div>
            ) : items.length === 0 && !extraSections && !error ? (
              <div className='text-center py-8 text-sm text-neutral-500'>
                {emptyMessage}
              </div>
            ) : (
              <>
                {items.length > 0 && (
                  <RemoteItemList
                    items={items}
                    loadingFile={loadingFile}
                    deletingFile={deletingFile}
                    onLoad={handleLoadRemote}
                    onDelete={handleDelete}
                  />
                )}
                {extraSections}
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
