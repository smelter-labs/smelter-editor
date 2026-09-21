'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { FbCam, FbCamRole } from '@smelter-editor/types';
import type { FbSession } from '@smelter-editor/types';
import {
  attachFbMp4Cam,
  getFbClips,
  getMP4Suggestions,
  syncFbFileCams,
} from '@/app/actions/actions';
import { FB, FbSelect, Chip, Meta } from './fb-kit';
import { clipFitsRole } from './clip-role';

type Cams = Record<FbCamRole, FbCam>;

/** Clips in data/mp4s usable as a camera (menu assets of other games excluded). */
export function useMp4Library() {
  const [files, setFiles] = useState<string[]>([]);
  const [sessions, setSessions] = useState<Map<string, FbSession | null>>(
    () => new Map(),
  );
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => {
    setLoading(true);
    void getMP4Suggestions({ refresh: true })
      .then(async (s) => {
        setFiles(
          s.mp4s
            .filter((f) => f.toLowerCase().endsWith('.mp4'))
            .filter((f) => !f.startsWith('duck-hunter-characters/'))
            .sort((a, b) => a.localeCompare(b)),
        );
        // The rig each clip's sidecar names (after the refresh above).
        const { clips } = await getFbClips();
        setSessions(new Map(clips.map((c) => [c.fileName, c.session])));
      })
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => reload(), [reload]);
  /** Candidate clips for a camera role (sidecar rig first, then the name). */
  const filterFor = useCallback(
    (role: FbCamRole) => (f: string) => clipFitsRole(role, f, sessions.get(f)),
    [sessions],
  );
  return { files, loading, reload, filterFor };
}

/** Roles of the given session. */
export function rolesForSession(session: 'pano' | 'tricam'): FbCamRole[] {
  return session === 'pano' ? ['pano'] : ['left', 'centre', 'right'];
}

export const ROLE_LABEL: Record<FbCamRole, string> = {
  pano: 'PANORAMA',
  left: 'LEFT CAM',
  centre: 'CENTRE CAM',
  right: 'RIGHT CAM',
};

/**
 * Pick a clip from the server library and use it as this role's camera.
 * When another role already runs on a clip, the attach also restarts every
 * clip from 0:00 so synchronized recordings line up.
 */
export function FileCamPicker({
  roomId,
  role,
  cams,
  files,
  loading,
  dense = false,
  filter,
}: {
  roomId: string;
  role: FbCamRole;
  cams: Cams | null | undefined;
  files: string[];
  loading: boolean;
  dense?: boolean;
  /** Only list clips whose path contains this (e.g. 'pano' / 'cam0'). */
  filter?: (file: string) => boolean;
}) {
  const cam = cams?.[role];
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listed = filter ? files.filter(filter) : files;

  useEffect(() => {
    if (selected && listed.includes(selected)) return;
    const current = cam?.fileName;
    setSelected(
      current && listed.includes(current) ? current : (listed[0] ?? ''),
    );
  }, [listed, cam?.fileName, selected]);

  const use = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      await attachFbMp4Cam(roomId, role, selected);
      const others = cams
        ? (Object.values(cams) as FbCam[]).filter(
            (c) => c.role !== role && c.fileName,
          )
        : [];
      if (others.length > 0) await syncFbFileCams(roomId, 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const isCurrent = cam?.fileName === selected;
  const h = dense ? 28 : 36;

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
        <FbSelect
          label={dense ? 'CLIP' : `${ROLE_LABEL[role]} · CLIP FROM DATA/MP4S`}
          value={selected}
          onChange={setSelected}
          height={h}
          style={{ flex: 1, minWidth: 0 }}>
          {listed.length === 0 ? (
            <option value=''>
              {loading ? 'loading…' : 'no mp4s in data/mp4s'}
            </option>
          ) : null}
          {listed.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </FbSelect>
        <Chip
          dense={dense}
          label={busy ? 'ATTACHING…' : isCurrent ? 'RESTART' : 'USE FILE'}
          title={
            isCurrent
              ? 'Re-attach the same clip (starts over)'
              : 'Use this clip as the camera'
          }
          disabled={busy || !selected}
          onClick={() => void use()}
          style={{ flexShrink: 0 }}
        />
      </div>
      {error ? (
        <Meta size={9} tracking={0.1} color={FB.amber}>
          {error}
        </Meta>
      ) : null}
    </div>
  );
}

/** Restart every file camera from 0:00 at once. */
export function FileCamSyncButton({
  roomId,
  cams,
  onReload,
  dense = false,
}: {
  roomId: string;
  cams: Cams | null | undefined;
  onReload?: () => void;
  dense?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const fileCams = cams
    ? (Object.values(cams) as FbCam[]).filter((c) => c.fileName)
    : [];
  if (fileCams.length === 0 && !onReload) return null;

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { inputIds } = await syncFbFileCams(roomId, 0);
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
        <Chip
          dense={dense}
          label={busy ? 'RESTARTING…' : 'RESTART CLIPS 0:00'}
          title='Restart every file camera from the beginning, in sync'
          disabled={busy}
          onClick={() => void sync()}
        />
      ) : null}
      {onReload ? (
        <Chip dense={dense} label='RELOAD LIST' onClick={onReload} />
      ) : null}
      {note ? (
        <Meta size={9} tracking={0.1}>
          {note}
        </Meta>
      ) : null}
    </div>
  );
}
