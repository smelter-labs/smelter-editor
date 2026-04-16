'use client';

import { useState, useCallback } from 'react';
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
    targetClass: '',
    boxColor: '#ff0000',
  };

  const [serverUrl, setServerUrl] = useState(config.serverUrl);
  const [classes, setClasses] = useState<string[]>([]);
  const [classesFetching, setClassesFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const saveConfig = useCallback(
    (patch: Partial<YoloSearchConfig>) => {
      const next: YoloSearchConfig = { ...config, ...patch };
      onUpdate({ yoloSearchConfig: next });
    },
    [config, onUpdate],
  );

  const handleFetchClasses = useCallback(async () => {
    const url = serverUrl.trim();
    if (!url) return;
    setClassesFetching(true);
    setFetchError(null);
    try {
      const info = await actions.getYoloModelInfo(url);
      setClasses(info.classes ?? []);
      // persist the server URL if it changed
      if (url !== config.serverUrl) {
        saveConfig({ serverUrl: url });
      }
    } catch (err: any) {
      setFetchError(err?.message ?? 'Cannot reach YOLO server');
    } finally {
      setClassesFetching(false);
    }
  }, [serverUrl, config.serverUrl, actions, saveConfig]);

  return (
    <div className='flex flex-col gap-3 px-1 py-2'>
      {/* Header row */}
      <div className='flex items-center justify-between'>
        <span className='text-sm font-semibold text-foreground'>YOLO Search</span>
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
            onClick={handleFetchClasses}
            disabled={classesFetching || !serverUrl.trim()}
            className='shrink-0'
          >
            {classesFetching ? 'Loading…' : 'Fetch'}
          </Button>
        </div>
        {fetchError && (
          <span className='text-xs text-destructive'>{fetchError}</span>
        )}
      </div>

      {/* Class selector */}
      <div className='flex flex-col gap-1'>
        <label className='text-xs text-muted-foreground'>Class to detect</label>
        <Select
          value={config.targetClass}
          onValueChange={(value) => saveConfig({ targetClass: value })}
        >
          <SelectTrigger className='h-8 text-sm'>
            <SelectValue placeholder={classes.length === 0 ? 'Fetch classes first' : 'All classes'} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value=''>All classes</SelectItem>
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
        <label className='text-xs text-muted-foreground'>Bounding box color</label>
        <div className='flex items-center gap-2'>
          <input
            type='color'
            value={config.boxColor}
            onChange={(e) => saveConfig({ boxColor: e.target.value })}
            className='h-8 w-12 cursor-pointer rounded border border-input bg-transparent p-0.5'
          />
          <span className='text-xs text-muted-foreground font-mono'>{config.boxColor}</span>
        </div>
      </div>
    </div>
  );
}
