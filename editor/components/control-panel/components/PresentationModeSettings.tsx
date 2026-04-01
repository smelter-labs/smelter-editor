'use client';

import { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import LoadingSpinner from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Trash2, Download, Check } from 'lucide-react';
import type { RoomState } from '@/lib/types';
import {
  exportRoomConfig,
  resolveRoomConfigTimelineState,
  loadOutputPlayerSettings,
  type RoomConfig,
  type PresentationConfig,
} from '@/lib/room-config';
import {
  savePresentationConfig,
  listPresentationConfigs,
  loadPresentationConfig,
  deletePresentationConfig,
  listRemoteConfigs,
  loadRemoteConfig,
} from '@/app/actions/actions';
import type { SavedItemInfo } from '@/lib/storage-client';
import { useControlPanelContext } from '../contexts/control-panel-context';
import type { TimelineState } from '../hooks/use-timeline-state';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';

type PresentationModeSettingsProps = {
  roomState: RoomState;
  getTimelineStateForConfig: () => TimelineState | null;
};

export function PresentationModeSettings({
  roomState,
  getTimelineStateForConfig,
}: PresentationModeSettingsProps) {
  const { roomId } = useControlPanelContext();

  const [welcomeTextBefore, setWelcomeTextBefore] = useState('');
  const [welcomeTextAfter, setWelcomeTextAfter] = useState('');
  const [configName, setConfigName] = useState('');
  const [roomConfigSource, setRoomConfigSource] = useState<
    'current' | 'saved'
  >('current');
  const [savedConfigs, setSavedConfigs] = useState<SavedItemInfo[]>([]);
  const [selectedConfigFile, setSelectedConfigFile] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  const [presentationConfigs, setPresentationConfigs] = useState<
    SavedItemInfo[]
  >([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [loadingConfigFile, setLoadingConfigFile] = useState<string | null>(
    null,
  );

  const fetchPresentationConfigs = useCallback(async () => {
    const result = await listPresentationConfigs();
    if (result.ok) {
      setPresentationConfigs(result.items);
    }
  }, []);

  useEffect(() => {
    setIsLoadingList(true);
    Promise.all([
      fetchPresentationConfigs(),
      listRemoteConfigs().then((r) => {
        if (r.ok) setSavedConfigs(r.items);
      }),
    ]).finally(() => setIsLoadingList(false));
  }, [fetchPresentationConfigs]);

  const buildCurrentRoomConfig = useCallback((): RoomConfig => {
    const timelineState = resolveRoomConfigTimelineState(
      roomId,
      getTimelineStateForConfig(),
    );
    const outputPlayer = loadOutputPlayerSettings(roomId) ?? undefined;
    return exportRoomConfig(
      roomState.inputs,
      roomState.layout,
      roomState.resolution,
      {
        swapDurationMs: roomState.swapDurationMs,
        swapOutgoingEnabled: roomState.swapOutgoingEnabled,
        swapFadeInDurationMs: roomState.swapFadeInDurationMs,
        swapFadeOutDurationMs: roomState.swapFadeOutDurationMs,
        newsStripFadeDuringSwap: roomState.newsStripFadeDuringSwap,
        newsStripEnabled: roomState.newsStripEnabled,
      },
      timelineState ?? undefined,
      outputPlayer,
      {
        viewportTop: roomState.viewportTop,
        viewportLeft: roomState.viewportLeft,
        viewportWidth: roomState.viewportWidth,
        viewportHeight: roomState.viewportHeight,
        viewportTransitionDurationMs: roomState.viewportTransitionDurationMs,
        viewportTransitionEasing: roomState.viewportTransitionEasing,
      },
      roomState.outputShaders,
    );
  }, [getTimelineStateForConfig, roomState, roomId]);

  const handleSave = useCallback(async () => {
    const name = configName.trim();
    if (!name) {
      toast.error('Please enter a name for the presentation config');
      return;
    }

    setIsSaving(true);
    try {
      let roomConfig: RoomConfig;

      if (roomConfigSource === 'current') {
        roomConfig = buildCurrentRoomConfig();
      } else {
        if (!selectedConfigFile) {
          toast.error('Please select a saved config');
          setIsSaving(false);
          return;
        }
        const loaded = await loadRemoteConfig(selectedConfigFile);
        if (!loaded.ok) {
          toast.error(`Failed to load config: ${loaded.error}`);
          setIsSaving(false);
          return;
        }
        roomConfig = loaded.data as RoomConfig;
      }

      const presentationConfig: PresentationConfig = {
        roomConfig,
        welcomeTextBefore,
        welcomeTextAfter,
      };

      const result = await savePresentationConfig(name, presentationConfig);
      if (result.ok) {
        toast.success('Presentation config saved');
        setConfigName('');
        await fetchPresentationConfigs();
      } else {
        toast.error(`Save failed: ${result.error}`);
      }
    } catch (e: any) {
      toast.error(`Save failed: ${e?.message || e}`);
    } finally {
      setIsSaving(false);
    }
  }, [
    configName,
    roomConfigSource,
    selectedConfigFile,
    welcomeTextBefore,
    welcomeTextAfter,
    buildCurrentRoomConfig,
    fetchPresentationConfigs,
  ]);

  const handleLoadConfig = useCallback(
    async (fileName: string) => {
      setLoadingConfigFile(fileName);
      try {
        const result = await loadPresentationConfig(fileName);
        if (!result.ok) {
          toast.error(`Load failed: ${result.error}`);
          return;
        }
        const config = result.data as PresentationConfig;
        setWelcomeTextBefore(config.welcomeTextBefore || '');
        setWelcomeTextAfter(config.welcomeTextAfter || '');
        toast.success('Loaded presentation config settings');
      } catch (e: any) {
        toast.error(`Load failed: ${e?.message || e}`);
      } finally {
        setLoadingConfigFile(null);
      }
    },
    [],
  );

  const handleDeleteConfig = useCallback(
    async (fileName: string) => {
      try {
        const result = await deletePresentationConfig(fileName);
        if (result.ok) {
          toast.success('Deleted');
          await fetchPresentationConfigs();
        } else {
          toast.error(`Delete failed: ${result.error}`);
        }
      } catch (e: any) {
        toast.error(`Delete failed: ${e?.message || e}`);
      }
    },
    [fetchPresentationConfigs],
  );

  return (
    <div className='space-y-4'>
      <section className='space-y-3'>
        <h4 className='text-sm font-medium text-foreground'>Welcome Modal</h4>
        <div className='space-y-2'>
          <Label htmlFor='welcome-before' className='text-xs text-muted-foreground'>
            Text before pending connections
          </Label>
          <Textarea
            id='welcome-before'
            placeholder='Welcome! Please connect your camera or screenshare below...'
            value={welcomeTextBefore}
            onChange={(e) => setWelcomeTextBefore(e.target.value)}
            className='min-h-[60px] text-sm'
          />
        </div>
        <div className='space-y-2'>
          <Label htmlFor='welcome-after' className='text-xs text-muted-foreground'>
            Text after pending connections
          </Label>
          <Textarea
            id='welcome-after'
            placeholder='Once connected, the presentation will begin automatically.'
            value={welcomeTextAfter}
            onChange={(e) => setWelcomeTextAfter(e.target.value)}
            className='min-h-[60px] text-sm'
          />
        </div>
      </section>

      <div className='h-px bg-card' />

      <section className='space-y-3'>
        <h4 className='text-sm font-medium text-foreground'>Room Configuration</h4>
        <div className='flex items-center gap-3'>
          <Select
            value={roomConfigSource}
            onValueChange={(v: 'current' | 'saved') => setRoomConfigSource(v)}>
            <SelectTrigger className='bg-card border border-border text-foreground text-xs px-2 py-1 rounded h-auto flex-1'>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='current'>Use current room state</SelectItem>
              <SelectItem value='saved'>Select from saved configs</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {roomConfigSource === 'saved' && (
          <Select
            value={selectedConfigFile}
            onValueChange={setSelectedConfigFile}>
            <SelectTrigger className='bg-card border border-border text-foreground text-xs px-2 py-1 rounded h-auto w-full'>
              <SelectValue placeholder='Choose a saved config...' />
            </SelectTrigger>
            <SelectContent>
              {savedConfigs.map((c) => (
                <SelectItem key={c.fileName} value={c.fileName}>
                  {c.name}
                </SelectItem>
              ))}
              {savedConfigs.length === 0 && (
                <div className='px-3 py-2 text-xs text-neutral-500'>
                  No saved configs found
                </div>
              )}
            </SelectContent>
          </Select>
        )}
      </section>

      <div className='h-px bg-card' />

      <section className='space-y-3'>
        <h4 className='text-sm font-medium text-foreground'>Save</h4>
        <div className='flex gap-2'>
          <Input
            placeholder='Presentation name...'
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            className='text-sm flex-1'
          />
          <Button
            size='sm'
            onClick={handleSave}
            disabled={isSaving || !configName.trim()}
            className='cursor-pointer'>
            {isSaving ? (
              <LoadingSpinner size='sm' variant='spinner' />
            ) : (
              <>
                <Check className='w-4 h-4 mr-1' />
                Save
              </>
            )}
          </Button>
        </div>
      </section>

      <div className='h-px bg-card' />

      <section className='space-y-3'>
        <h4 className='text-sm font-medium text-foreground'>
          Saved Presentation Configs
        </h4>
        {isLoadingList ? (
          <div className='flex justify-center py-3'>
            <LoadingSpinner size='sm' variant='spinner' />
          </div>
        ) : presentationConfigs.length === 0 ? (
          <p className='text-xs text-neutral-500'>
            No presentation configs saved yet.
          </p>
        ) : (
          <ul className='space-y-2'>
            {presentationConfigs.map((item) => (
              <li
                key={item.fileName}
                className='flex items-center justify-between bg-neutral-900 rounded px-3 py-2'>
                <div className='min-w-0 flex-1'>
                  <span className='text-sm text-white truncate block'>
                    {item.name}
                  </span>
                  <span className='text-xs text-neutral-500'>
                    {new Date(item.savedAt).toLocaleString()}
                  </span>
                </div>
                <div className='flex gap-1 ml-2 shrink-0'>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='h-7 w-7 cursor-pointer'
                    title='Load settings'
                    disabled={loadingConfigFile === item.fileName}
                    onClick={() => handleLoadConfig(item.fileName)}>
                    {loadingConfigFile === item.fileName ? (
                      <LoadingSpinner size='sm' variant='spinner' />
                    ) : (
                      <Download className='w-3.5 h-3.5' />
                    )}
                  </Button>
                  <Button
                    size='icon'
                    variant='ghost'
                    className='h-7 w-7 text-red-400 hover:text-red-300 cursor-pointer'
                    title='Delete'
                    onClick={() => handleDeleteConfig(item.fileName)}>
                    <Trash2 className='w-3.5 h-3.5' />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
