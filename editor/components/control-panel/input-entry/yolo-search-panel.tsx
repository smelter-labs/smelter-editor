'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Input, UpdateInputOptions, YoloSearchConfig } from '@/lib/types';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Input as ShadcnInput } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActions } from '../contexts/actions-context';

interface YoloSearchPanelProps {
  roomId: string;
  input: Input;
  onUpdate: (opts: Partial<UpdateInputOptions>) => void;
}

export default function YoloSearchPanel({
  roomId,
  input,
  onUpdate,
}: YoloSearchPanelProps) {
  const actions = useActions();

  const config: YoloSearchConfig = input.yoloSearchConfig ?? {
    enabled: false,
    serverUrl: '',
    modelName: undefined,
    targetClass: '',
    boxColor: '#ff0000',
  };

  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [models, setModels] = useState<string[]>([]);
  const [classes, setClasses] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const saveConfig = useCallback(
    (patch: Partial<YoloSearchConfig>) => {
      const next: YoloSearchConfig = { ...config, ...patch };
      onUpdate({ yoloSearchConfig: next });
    },
    [config, onUpdate],
  );

  // Re-fetch classes whenever the persisted serverUrl or modelName changes.
  // This is the single source of truth for the class list — no manual calls needed.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    if (!config.serverUrl) return;
    let cancelled = false;
    setClasses([]);
    actionsRef.current
      .getYoloModelInfo(config.serverUrl, config.modelName)
      .then((info) => {
        if (!cancelled) setClasses(info.classes ?? []);
      })
      .catch(() => {
        if (!cancelled) setClasses([]);
      });
    return () => {
      cancelled = true;
    };
  }, [config.serverUrl, config.modelName]);

  // Fetch button: populates models list and persists the server URL
  // (persisting serverUrl triggers the effect above to refresh classes).
  const handleFetch = useCallback(async () => {
    const url = serverUrl.trim();
    if (!url) return;
    setFetching(true);
    setFetchError(null);
    try {
      const result = await actions.getYoloModels(url);
      setModels(result.models ?? []);
      if (url !== config.serverUrl) {
        saveConfig({ serverUrl: url });
      }
    } catch (err: any) {
      setFetchError(err?.message ?? 'Cannot reach YOLO server');
    } finally {
      setFetching(false);
    }
  }, [serverUrl, config.serverUrl, actions, saveConfig]);

  // Model change: just persist; the effect handles re-fetching classes.
  const handleModelChange = useCallback(
    (value: string) => {
      const modelName = value === '__default__' ? undefined : value;
      saveConfig({ modelName, targetClass: '' });
    },
    [saveConfig],
  );

  return (
    <div className='flex flex-col gap-3 px-1 py-2'>
      {/* Header row */}
      <div className='flex items-center justify-between'>
        <span className='text-sm font-semibold text-foreground'>
          YOLO Search
        </span>
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => saveConfig({ enabled: checked })}
        />
      </div>

      {/* Server URL */}
      <div className='flex flex-col gap-1'>
        <label className='text-xs text-muted-foreground'>Server URL</label>
        <div className='flex gap-2'>
          <ShadcnInput
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            onBlur={() => {
              if (serverUrl !== config.serverUrl) {
                saveConfig({ serverUrl });
              }
            }}
            placeholder='http://localhost:8765'
            className='h-8 text-sm flex-1'
          />
          <Button
            variant='outline'
            size='sm'
            onClick={handleFetch}
            disabled={fetching || !serverUrl.trim()}
            className='shrink-0'>
            {fetching ? 'Loading…' : 'Fetch'}
          </Button>
        </div>
        {fetchError && (
          <span className='text-xs text-destructive'>{fetchError}</span>
        )}
      </div>

      {/* Model selector */}
      <div className='flex flex-col gap-1'>
        <label className='text-xs text-muted-foreground'>Model</label>
        <Select
          value={config.modelName || '__default__'}
          onValueChange={handleModelChange}>
          <SelectTrigger className='h-8 text-sm'>
            <SelectValue
              placeholder={
                models.length === 0 ? 'Fetch models first' : 'Default model'
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__default__'>Default model</SelectItem>
            {models.map((m) => (
              <SelectItem key={m} value={m}>
                {m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Class selector */}
      <div className='flex flex-col gap-1'>
        <label className='text-xs text-muted-foreground'>Class to detect</label>
        <Select
          value={config.targetClass || '__all__'}
          onValueChange={(value) =>
            saveConfig({ targetClass: value === '__all__' ? '' : value })
          }>
          <SelectTrigger className='h-8 text-sm'>
            <SelectValue
              placeholder={
                classes.length === 0 ? 'Fetch classes first' : 'All classes'
              }
            />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='__all__'>All classes</SelectItem>
            {classes.map((cls) => (
              <SelectItem key={cls} value={cls}>
                {cls}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Box color */}
      <div className='flex flex-col gap-1'>
        <label className='text-xs text-muted-foreground'>
          Bounding box color
        </label>
        <div className='flex items-center gap-2'>
          <input
            type='color'
            value={config.boxColor}
            onChange={(e) => saveConfig({ boxColor: e.target.value })}
            className='h-8 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5'
          />
          <span className='text-xs text-muted-foreground font-mono'>
            {config.boxColor}
          </span>
        </div>
      </div>
    </div>
  );
}
