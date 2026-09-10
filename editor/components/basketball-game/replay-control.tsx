'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type {
  BbCam,
  BbCamRole,
  BbReplayBasket,
  BbReplayState,
} from '@smelter-editor/types';
import { getBbEventsSuggestions, setBbReplay } from '@/app/actions/actions';
import { BB, BbSelect, Chip, Meta } from './bb-kit';
import {
  defaultEventsFile,
  replayClip,
  replayStatusLabel,
} from './replay-helpers';

type Cams = Record<BbCamRole, BbCam>;

/** Ground-truth event files (`events.json` / `*.events.json`) under data/mp4s. */
export function useBbEventsLibrary() {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    void getBbEventsSuggestions()
      .then((s) => setFiles([...s.files].sort((a, b) => a.localeCompare(b))))
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => reload(), [reload]);
  return { files, loading, reload };
}

const BASKETS: { value: BbReplayBasket; label: string }[] = [
  { value: 'both', label: 'BOTH BASKETS' },
  { value: 'left', label: 'LEFT BASKET' },
  { value: 'right', label: 'RIGHT BASKET' },
];

/**
 * Replay annotated throws on the file cams instead of scoring with the
 * model: pick an events file (defaults to the one next to the attached
 * clip), the basket the hoop cam looks at, LOAD. Throws fire at their clip
 * time — the same moment the model would report them — so the broadcast
 * behaves exactly as with a working detector. OFF hands the ledger back to
 * the model.
 */
export function ReplayControl({
  roomId,
  cams,
  replay,
  files,
  loading,
  dense = false,
}: {
  roomId: string;
  cams: Cams | null | undefined;
  replay: BbReplayState | null | undefined;
  files: string[];
  loading: boolean;
  dense?: boolean;
}) {
  const clip = replayClip(cams);
  const [selected, setSelected] = useState('');
  const [basket, setBasket] = useState<BbReplayBasket>('both');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (replay?.fileName && files.includes(replay.fileName)) {
      setSelected(replay.fileName);
      return;
    }
    if (selected && files.includes(selected)) return;
    setSelected(defaultEventsFile(files, cams));
  }, [files, clip, replay?.fileName, selected, cams]);

  const load = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await setBbReplay(roomId, { action: 'load', fileName: selected, basket });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const off = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await setBbReplay(roomId, { action: 'off' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!clip && !replay) return null;
  const h = dense ? 28 : 36;
  const status = replayStatusLabel(replay ?? null);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        width: '100%',
        minWidth: 0,
      }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 6,
          width: '100%',
          minWidth: 0,
          flexWrap: 'wrap',
        }}>
        <BbSelect
          label={dense ? 'GROUND TRUTH' : 'GROUND TRUTH (EVENTS.JSON)'}
          value={selected}
          onChange={setSelected}
          height={h}
          style={{ flex: 2, minWidth: 140 }}>
          {files.length === 0 ? (
            <option value=''>
              {loading ? 'loading…' : 'no events.json in data/mp4s'}
            </option>
          ) : null}
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </BbSelect>
        <BbSelect
          value={basket}
          onChange={(v) => setBasket(v as BbReplayBasket)}
          height={h}
          style={{ flex: 1, minWidth: 110 }}>
          {BASKETS.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </BbSelect>
        <Chip
          dense={dense}
          label={busy ? 'LOADING…' : replay ? 'RELOAD' : 'LOAD'}
          title='Fire the annotated throws on the file cams instead of the model'
          disabled={busy || !selected || !clip}
          onClick={() => void load()}
          style={{ flexShrink: 0 }}
        />
        {replay ? (
          <Chip
            dense={dense}
            tone='danger'
            label='OFF'
            title='Hand the ledger back to the model'
            disabled={busy}
            onClick={() => void off()}
            style={{ flexShrink: 0 }}
          />
        ) : null}
      </div>
      {status ? (
        <Meta size={9} tracking={0.12} color={BB.electric}>
          {status}
        </Meta>
      ) : null}
      {error ? (
        <Meta size={9} tracking={0.1} color={BB.amber}>
          {error}
        </Meta>
      ) : null}
    </div>
  );
}
