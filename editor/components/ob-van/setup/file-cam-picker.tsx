'use client';

import React, { useEffect, useState } from 'react';
import { OB_MAX_CAMS, type ObCam, type ObCamRole } from '@smelter-editor/types';
import { useMp4Library } from '@/components/football-game/file-cam-picker';
import { FIXED_ROLES, ROLE_LABEL, toRole } from '@/lib/ob-van/roles';
import { Chip, Meta, OB, ObSelect, TextField } from '../ob-kit';
import type { ObRoom } from '../use-ob-room';

/** `speaker-keynote.mp4` → `SPEAKER KEYNOTE` (a default camera name). */
export function nameFromFile(fileName: string): string {
  const base = fileName.split('/').pop() ?? fileName;
  return base
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .slice(0, 24)
    .toUpperCase();
}

/**
 * Add a looping mp4 from the server library (data/mp4s) as a camera with a
 * role — the way to rehearse a show without phones. Every add after the
 * first restarts all file cameras from 0:00 so synced recordings line up.
 */
export function FileCamPicker({ room, cams }: { room: ObRoom; cams: ObCam[] }) {
  const { files, loading, reload } = useMp4Library();
  const [selected, setSelected] = useState('');
  const [role, setRole] = useState<ObCamRole>('speaker');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (selected && files.includes(selected)) return;
    setSelected(files[0] ?? '');
  }, [files, selected]);

  const full = cams.length >= OB_MAX_CAMS;
  const fileCams = cams.filter((c) => c.kind === 'file');

  const add = async () => {
    if (!selected || busy || full) return;
    setBusy(true);
    setNote(null);
    const camId = await room.attachFileCam({
      role,
      fileName: selected,
      name: name.trim() || nameFromFile(selected),
    });
    if (camId) {
      setName('');
      if (fileCams.length > 0) await room.syncFileCams();
      setNote('added — clips restarted together');
    }
    setBusy(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <ObSelect
        label='CLIP FROM DATA/MP4S'
        value={selected}
        onChange={setSelected}>
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
      </ObSelect>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <ObSelect
          value={role}
          onChange={(v) => setRole(toRole(v, role))}
          style={{ width: 118, flexShrink: 0 }}>
          {FIXED_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </ObSelect>
        <TextField
          value={name}
          onChange={setName}
          placeholder={selected ? nameFromFile(selected) : 'camera name'}
          label='File camera name'
          maxLength={24}
          height={30}
          fontSize={11}
          onEnter={() => void add()}
        />
        <Chip
          label={busy ? 'ADDING…' : 'ADD FILE CAM'}
          tone='preview'
          disabled={busy || !selected || full}
          onClick={() => void add()}
        />
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {fileCams.length > 1 ? (
          <Chip
            dense
            label='RESTART CLIPS 0:00'
            title='Restart every file camera from the beginning, in sync'
            onClick={() => void room.syncFileCams()}
          />
        ) : null}
        <Chip dense label='RELOAD LIST' onClick={reload} />
        {full ? (
          <Meta size={9} tracking={0.08} color={OB.amber}>
            all {OB_MAX_CAMS} seats taken
          </Meta>
        ) : note ? (
          <Meta size={9} tracking={0.08}>
            {note}
          </Meta>
        ) : null}
      </div>
    </div>
  );
}
