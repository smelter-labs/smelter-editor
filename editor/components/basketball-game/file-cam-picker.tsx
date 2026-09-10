'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { BbCam, BbCamRole } from '@smelter-editor/types';
import {
  attachBbMp4Cam,
  getMP4Suggestions,
  syncBbFileCams,
} from '@/app/actions/actions';
import {
  ChipButton,
  KBT,
  KbtSelect,
  Label,
} from '@/components/kettlebell-tournament/kbt-kit';

type Cams = Record<BbCamRole, BbCam>;

/** Clips in data/mp4s usable as a camera (menu assets of other games excluded). */
export function useMp4Library() {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    void getMP4Suggestions({ refresh: true })
      .then((s) =>
        setFiles(
          s.mp4s
            .filter((f) => f.toLowerCase().endsWith('.mp4'))
            .filter((f) => !f.startsWith('duck-hunter-characters/'))
            .sort((a, b) => a.localeCompare(b)),
        ),
      )
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => reload(), [reload]);
  return { files, loading, reload };
}

/** `LIVE · …` style status for a cam row, naming the clip for file cams. */
export function camSourceLabel(cam: BbCam | null | undefined): string {
  if (!cam?.joined) return '';
  return cam.source === 'file'
    ? `FILE · ${cam.fileName ?? cam.name}`
    : cam.name;
}

const otherRole = (role: BbCamRole): BbCamRole =>
  role === 'hoop' ? 'court' : 'hoop';

/**
 * Pick a clip from the server library and use it as this role's camera.
 * When the other role already runs on a clip, the second attach also
 * restarts both from 0:00 so synchronized recordings line up.
 */
export function FileCamPicker({
  roomId,
  role,
  cams,
  files,
  loading,
  dense = false,
}: {
  roomId: string;
  role: BbCamRole;
  cams: Cams | null | undefined;
  files: string[];
  loading: boolean;
  dense?: boolean;
}) {
  const cam = cams?.[role];
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default to the clip already attached, else the first in the library.
  useEffect(() => {
    if (selected && files.includes(selected)) return;
    const current = cam?.source === 'file' ? cam.fileName : undefined;
    setSelected(
      current && files.includes(current) ? current : (files[0] ?? ''),
    );
  }, [files, cam?.source, cam?.fileName, selected]);

  const use = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await attachBbMp4Cam(roomId, role, selected);
      if (cams?.[otherRole(role)]?.source === 'file') {
        await syncBbFileCams(roomId, 0);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isCurrent = cam?.source === 'file' && cam.fileName === selected;

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
        }}>
        <KbtSelect
          label={dense ? 'CLIP' : 'CLIP FROM DATA/MP4S'}
          value={selected}
          onChange={setSelected}
          style={{ minWidth: 0 }}>
          {files.length === 0 ? (
            <option value=''>
              {loading ? 'loading…' : 'no mp4s in data/mp4s'}
            </option>
          ) : null}
          {files.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </KbtSelect>
        <ChipButton
          dense={dense}
          label={busy ? 'ATTACHING…' : isCurrent ? 'RESTART' : 'USE FILE'}
          title={
            isCurrent
              ? 'Re-attach the same clip (starts over)'
              : 'Use this clip as the camera (replaces a phone stream)'
          }
          disabled={busy || !selected}
          onClick={() => void use()}
          style={{ flexShrink: 0, marginBottom: 1 }}
        />
      </div>
      {error ? (
        <Label size={9} tracking={1} color={KBT.amber}>
          {error}
        </Label>
      ) : null}
    </div>
  );
}

/**
 * Restart every file camera from 0:00 at once. Shown as soon as one role
 * runs on a clip: arming the scorer re-registers the hoop clip a beat after
 * it is attached, so hoop and court drift apart until they are restarted
 * together.
 */
export function FileCamSyncButton({
  roomId,
  cams,
  onReload,
  dense = false,
}: {
  roomId: string;
  cams: Cams | null | undefined;
  /** Rescan the clip library. */
  onReload?: () => void;
  dense?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileCams = cams
    ? (Object.values(cams) as BbCam[]).filter(
        (c) => c.joined && c.source === 'file',
      )
    : [];
  if (fileCams.length === 0 && !onReload) return null;

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { inputIds } = await syncBbFileCams(roomId, 0);
      setNote(
        inputIds.length === 0
          ? 'no clip restarted — cams still connecting?'
          : `${inputIds.length} clip${inputIds.length === 1 ? '' : 's'} restarted from 0:00`,
      );
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
      }}>
      {fileCams.length > 0 ? (
        <ChipButton
          dense={dense}
          label={busy ? 'RESTARTING…' : 'RESTART CLIPS 0:00'}
          title='Restart every file camera from the beginning, in sync'
          disabled={busy}
          onClick={() => void sync()}
        />
      ) : null}
      {onReload ? (
        <ChipButton dense={dense} label='RELOAD LIST' onClick={onReload} />
      ) : null}
      {note ? (
        <Label size={9} tracking={1}>
          {note}
        </Label>
      ) : null}
    </div>
  );
}
