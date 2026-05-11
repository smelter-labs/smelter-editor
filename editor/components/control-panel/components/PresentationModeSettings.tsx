'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
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
  updatePresentationConfig,
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

function isEffectivelyEmptyRichText(value: string): boolean {
  const withoutTags = value
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return withoutTags.length === 0;
}

function resolvePresentationTextValues(
  payload: Partial<PresentationConfig> & {
    before?: string;
    after?: string;
    title?: string;
    description?: string;
  },
): {
  welcomeTextBefore: string;
  welcomeTextAfter: string;
  farewellTitle: string;
  farewellDescription: string;
} {
  return {
    welcomeTextBefore: payload.welcomeTextBefore ?? payload.before ?? '',
    welcomeTextAfter: payload.welcomeTextAfter ?? payload.after ?? '',
    farewellTitle: payload.farewellTitle ?? payload.title ?? '',
    farewellDescription:
      payload.farewellDescription ?? payload.description ?? '',
  };
}

type PresentationModeSettingsProps = {
  roomState: RoomState;
  getTimelineStateForConfig: () => TimelineState | null;
  showcasePrefill?: {
    welcomeTextBefore: string;
    welcomeTextAfter: string;
    farewellTitle: string;
    farewellDescription: string;
  } | null;
};

export function PresentationModeSettings({
  roomState,
  getTimelineStateForConfig,
  showcasePrefill,
}: PresentationModeSettingsProps) {
  const { roomId } = useControlPanelContext();

  const [welcomeTextBefore, setWelcomeTextBefore] = useState('');
  const [welcomeTextAfter, setWelcomeTextAfter] = useState('');
  const [farewellTitle, setFarewellTitle] = useState('');
  const [farewellDescription, setFarewellDescription] = useState('');
  const [configName, setConfigName] = useState('');
  const [roomConfigSource, setRoomConfigSource] = useState<'current' | 'saved'>(
    'current',
  );
  const [savedConfigs, setSavedConfigs] = useState<SavedItemInfo[]>([]);
  const [selectedConfigFile, setSelectedConfigFile] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [selectedPresentationConfigFile, setSelectedPresentationConfigFile] =
    useState<string>('');
  const [selectedPresentationConfigName, setSelectedPresentationConfigName] =
    useState<string>('');

  const [presentationConfigs, setPresentationConfigs] = useState<
    SavedItemInfo[]
  >([]);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [loadingConfigFile, setLoadingConfigFile] = useState<string | null>(
    null,
  );
  const autoPrefillAppliedRef = useRef(false);

  const applyTextFields = useCallback(
    (values: {
      welcomeTextBefore?: string;
      welcomeTextAfter?: string;
      farewellTitle?: string;
      farewellDescription?: string;
      before?: string;
      after?: string;
      title?: string;
      description?: string;
    }) => {
      const resolved = resolvePresentationTextValues(values);
      setWelcomeTextBefore(resolved.welcomeTextBefore);
      setWelcomeTextAfter(resolved.welcomeTextAfter);
      setFarewellTitle(resolved.farewellTitle);
      setFarewellDescription(resolved.farewellDescription);
    },
    [],
  );

  const applyShowcasePrefill = useCallback(() => {
    if (!showcasePrefill) {
      return false;
    }
    applyTextFields(showcasePrefill);
    return true;
  }, [applyTextFields, showcasePrefill]);

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

  useEffect(() => {
    if (presentationConfigs.length === 0 || selectedPresentationConfigFile) {
      return;
    }
    const first = presentationConfigs[0];
    if (!first) return;
    setSelectedPresentationConfigFile(first.fileName);
    setSelectedPresentationConfigName(first.name);
  }, [presentationConfigs, selectedPresentationConfigFile]);

  useEffect(() => {
    if (!showcasePrefill || autoPrefillAppliedRef.current) {
      return;
    }

    const formIsEmpty =
      isEffectivelyEmptyRichText(welcomeTextBefore) &&
      isEffectivelyEmptyRichText(welcomeTextAfter) &&
      !farewellTitle.trim() &&
      isEffectivelyEmptyRichText(farewellDescription);
    if (!formIsEmpty) {
      autoPrefillAppliedRef.current = true;
      return;
    }

    applyTextFields(showcasePrefill);
    autoPrefillAppliedRef.current = true;
  }, [
    applyTextFields,
    showcasePrefill,
    welcomeTextBefore,
    welcomeTextAfter,
    farewellTitle,
    farewellDescription,
  ]);

  const buildCurrentRoomConfig = useCallback((): RoomConfig => {
    const timelineState = resolveRoomConfigTimelineState(
      roomId,
      getTimelineStateForConfig(),
    );
    const outputPlayer = loadOutputPlayerSettings(roomId) ?? undefined;
    return exportRoomConfig(
      roomState.inputs,
      undefined,
      roomState.resolution,
      {
        swapDurationMs: roomState.swapDurationMs,
        swapOutgoingEnabled: roomState.swapOutgoingEnabled,
        swapFadeInDurationMs: roomState.swapFadeInDurationMs,
        swapFadeOutDurationMs: roomState.swapFadeOutDurationMs,
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
      roomState.layers,
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
        farewellTitle,
        farewellDescription,
      };

      const result = await savePresentationConfig(name, presentationConfig);
      if (result.ok) {
        toast.success('Presentation config saved');
        setSelectedPresentationConfigFile(result.fileName);
        setSelectedPresentationConfigName(result.name);
        setConfigName(result.name);
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
    farewellTitle,
    farewellDescription,
    buildCurrentRoomConfig,
    fetchPresentationConfigs,
  ]);

  const handleLoadConfig = useCallback(
    async (fileName: string, options?: { markAsEditTarget?: boolean }) => {
      setLoadingConfigFile(fileName);
      try {
        const result = await loadPresentationConfig(fileName);
        if (!result.ok) {
          toast.error(`Load failed: ${result.error}`);
          return;
        }
        const config = result.data as PresentationConfig;
        applyTextFields(config);
        if (options?.markAsEditTarget) {
          setSelectedPresentationConfigFile(fileName);
          setSelectedPresentationConfigName(result.name);
          setConfigName(result.name);
          toast.success('Loaded selected config for editing');
        } else {
          toast.success('Loaded presentation config settings');
        }
      } catch (e: any) {
        toast.error(`Load failed: ${e?.message || e}`);
      } finally {
        setLoadingConfigFile(null);
      }
    },
    [applyTextFields],
  );

  const handleEditSelected = useCallback(async () => {
    if (!selectedPresentationConfigFile) {
      toast.error('Select a saved presentation config first');
      return;
    }
    await handleLoadConfig(selectedPresentationConfigFile, {
      markAsEditTarget: true,
    });
  }, [handleLoadConfig, selectedPresentationConfigFile]);

  const handleUpdateSelected = useCallback(async () => {
    if (!selectedPresentationConfigFile) {
      toast.error('Select a saved presentation config to update');
      return;
    }

    const name = configName.trim() || selectedPresentationConfigName;
    if (!name) {
      toast.error('Please enter a name for the updated config');
      return;
    }

    setIsUpdating(true);
    try {
      let roomConfig: RoomConfig;
      if (roomConfigSource === 'current') {
        roomConfig = buildCurrentRoomConfig();
      } else {
        if (!selectedConfigFile) {
          toast.error('Please select a saved config');
          setIsUpdating(false);
          return;
        }
        const loaded = await loadRemoteConfig(selectedConfigFile);
        if (!loaded.ok) {
          toast.error(`Failed to load config: ${loaded.error}`);
          setIsUpdating(false);
          return;
        }
        roomConfig = loaded.data as RoomConfig;
      }

      const presentationConfig: PresentationConfig = {
        roomConfig,
        welcomeTextBefore,
        welcomeTextAfter,
        farewellTitle,
        farewellDescription,
      };

      const result = await updatePresentationConfig(
        selectedPresentationConfigFile,
        name,
        presentationConfig,
      );
      if (result.ok) {
        toast.success('Presentation config updated');
        setSelectedPresentationConfigName(result.name);
        setConfigName(result.name);
        await fetchPresentationConfigs();
      } else {
        toast.error(`Update failed: ${result.error}`);
      }
    } catch (e: any) {
      toast.error(`Update failed: ${e?.message || e}`);
    } finally {
      setIsUpdating(false);
    }
  }, [
    selectedPresentationConfigFile,
    configName,
    selectedPresentationConfigName,
    roomConfigSource,
    buildCurrentRoomConfig,
    selectedConfigFile,
    welcomeTextBefore,
    welcomeTextAfter,
    farewellTitle,
    farewellDescription,
    fetchPresentationConfigs,
  ]);

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
        {showcasePrefill && (
          <div className='flex justify-end'>
            <Button
              size='sm'
              variant='outline'
              className='cursor-pointer'
              onClick={() => {
                const loaded = applyShowcasePrefill();
                if (loaded) {
                  toast.success('Loaded active showcase values');
                }
              }}>
              Load active values
            </Button>
          </div>
        )}
        <div className='space-y-2'>
          <Label className='text-xs text-muted-foreground'>
            Text before pending connections
          </Label>
          <RichTextEditor
            value={welcomeTextBefore}
            onChange={setWelcomeTextBefore}
            placeholder='Welcome! Please connect your camera or screenshare below...'
          />
        </div>
        <div className='space-y-2'>
          <Label className='text-xs text-muted-foreground'>
            Text after pending connections
          </Label>
          <RichTextEditor
            value={welcomeTextAfter}
            onChange={setWelcomeTextAfter}
            placeholder='Once connected, the presentation will begin automatically.'
          />
        </div>
      </section>

      <div className='h-px bg-card' />

      <section className='space-y-3'>
        <h4 className='text-sm font-medium text-foreground'>
          Completion Modal
        </h4>
        <div className='space-y-2'>
          <Label className='text-xs text-muted-foreground'>Title</Label>
          <Input
            value={farewellTitle}
            onChange={(e) => setFarewellTitle(e.target.value)}
            placeholder='Thanks for watching'
            className='text-sm'
          />
        </div>
        <div className='space-y-2'>
          <Label className='text-xs text-muted-foreground'>Description</Label>
          <RichTextEditor
            value={farewellDescription}
            onChange={setFarewellDescription}
            placeholder='Thanks for sticking with us to the end of the presentation...'
          />
        </div>
      </section>

      <div className='h-px bg-card' />

      <section className='space-y-3'>
        <h4 className='text-sm font-medium text-foreground'>
          Room Configuration
        </h4>
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
        {selectedPresentationConfigFile && (
          <p className='text-xs text-muted-foreground'>
            Editing:{' '}
            {selectedPresentationConfigName || selectedPresentationConfigFile}
          </p>
        )}
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
            disabled={isSaving || isUpdating || !configName.trim()}
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
          <Button
            size='sm'
            variant='outline'
            onClick={handleUpdateSelected}
            disabled={isSaving || isUpdating || !selectedPresentationConfigFile}
            className='cursor-pointer'>
            {isUpdating ? (
              <LoadingSpinner size='sm' variant='spinner' />
            ) : (
              'Update selected'
            )}
          </Button>
        </div>
      </section>

      <div className='h-px bg-card' />

      <section className='space-y-3'>
        <div className='flex items-center justify-between gap-2'>
          <h4 className='text-sm font-medium text-foreground'>
            Saved Presentation Configs
          </h4>
          <Button
            size='sm'
            variant='outline'
            className='cursor-pointer'
            disabled={
              !selectedPresentationConfigFile ||
              loadingConfigFile === selectedPresentationConfigFile
            }
            onClick={() => void handleEditSelected()}>
            Edit selected
          </Button>
        </div>
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
                className={`flex items-center justify-between rounded px-3 py-2 cursor-pointer transition-colors ${
                  selectedPresentationConfigFile === item.fileName
                    ? 'bg-neutral-800 ring-1 ring-neutral-600'
                    : 'bg-neutral-900 hover:bg-neutral-800'
                }`}
                onClick={() => {
                  setSelectedPresentationConfigFile(item.fileName);
                  setSelectedPresentationConfigName(item.name);
                  setConfigName(item.name);
                }}>
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
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedPresentationConfigFile(item.fileName);
                      setSelectedPresentationConfigName(item.name);
                      setConfigName(item.name);
                      void handleLoadConfig(item.fileName, {
                        markAsEditTarget: true,
                      });
                    }}>
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
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteConfig(item.fileName);
                    }}>
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
