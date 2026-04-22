'use client';

import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SERVER_PRESETS,
  getDefaultServerUrl,
  getEffectiveClientServerUrl,
  setStoredServerUrl,
} from '@/lib/server-url';

type SettingsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/$/, '');
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function SettingsModal({ open, onOpenChange }: SettingsModalProps) {
  const defaultUrl = useMemo(() => getDefaultServerUrl(), []);
  const [url, setUrl] = useState(defaultUrl);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setUrl(getEffectiveClientServerUrl());
    setError(null);
  }, [open]);

  const selectedPreset = useMemo(() => {
    const normalized = normalizeUrl(url);
    return SERVER_PRESETS.find(
      (preset) => preset.url && normalizeUrl(preset.url) === normalized,
    );
  }, [url]);

  const selectedPresetId = selectedPreset?.id ?? 'custom';

  const handleSave = () => {
    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError('Server URL is required.');
      return;
    }
    if (!isValidHttpUrl(normalized)) {
      setError('Enter a valid http:// or https:// URL.');
      return;
    }

    setStoredServerUrl(normalized);
    window.location.reload();
  };

  const handleReset = () => {
    setStoredServerUrl(null);
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-lg'>
        <DialogHeader>
          <DialogTitle>Server settings</DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          <div className='space-y-2'>
            <label className='text-xs text-neutral-400'>Preset</label>
            <Select
              value={selectedPresetId}
              onValueChange={(value) => {
                if (value === 'custom') {
                  return;
                }
                const preset = SERVER_PRESETS.find((item) => item.id === value);
                if (!preset) {
                  return;
                }
                setUrl(preset.url);
                setError(null);
              }}>
              <SelectTrigger>
                <SelectValue placeholder='Select preset' />
              </SelectTrigger>
              <SelectContent>
                {SERVER_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {preset.url ? `${preset.label} (${preset.url})` : preset.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className='space-y-2'>
            <label className='text-xs text-neutral-400'>Server URL</label>
            <Input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                if (error) {
                  setError(null);
                }
              }}
              placeholder='http://localhost:3001'
              autoComplete='off'
              spellCheck={false}
            />
            <p className='text-xs text-neutral-500'>Default from env: {defaultUrl}</p>
            {error && <p className='text-xs text-red-400'>{error}</p>}
          </div>

          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant='outline' onClick={handleReset}>
              Reset to default
            </Button>
            <Button onClick={handleSave}>Save & reload</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
