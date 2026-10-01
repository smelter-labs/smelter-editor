'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { OB_MAX_CAMS, type ObCam, type ObCamRole } from '@smelter-editor/types';
import { getRoomInfo } from '@/app/actions/actions';
import type { Input } from '@/lib/types';
import { FIXED_ROLES, ROLE_LABEL, toRole } from '@/lib/ob-van/roles';
import { Chip, Meta, OB, ObSelect } from '../ob-kit';
import type { ObRoom } from '../use-ob-room';

/** Input types that carry a picture a camera could use. */
const ADOPTABLE_TYPES: readonly Input['type'][] = [
  'local-mp4',
  'hls',
  'twitch-channel',
  'kick-channel',
  'whip',
];

export function adoptableInputs(
  inputs: readonly Input[],
  cams: readonly Pick<ObCam, 'inputId'>[],
): Input[] {
  const taken = new Set(cams.map((c) => c.inputId).filter(Boolean));
  return inputs.filter(
    (i) => ADOPTABLE_TYPES.includes(i.type) && !taken.has(i.inputId),
  );
}

/**
 * Turn an input that already lives in the room (a stream added from the
 * dashboard, a WHIP publisher) into a camera. Lists the room's video
 * inputs that are not cameras yet.
 */
export function AdoptInputRow({ room, cams }: { room: ObRoom; cams: ObCam[] }) {
  const [inputs, setInputs] = useState<Input[]>([]);
  const [selected, setSelected] = useState('');
  const [role, setRole] = useState<ObCamRole>('wide');
  const [busy, setBusy] = useState(false);
  const roomId = room.roomId;

  const load = useCallback(() => {
    if (!roomId) return;
    void getRoomInfo(roomId)
      .then((info) => {
        if (info === 'not-found') return;
        setInputs(info.inputs ?? []);
      })
      .catch(() => setInputs([]));
  }, [roomId]);

  // Re-list whenever the camera set changes (an adopted input drops out).
  const camKey = cams.map((c) => c.inputId ?? '').join(',');
  useEffect(() => load(), [load, camKey]);

  const options = adoptableInputs(inputs, cams);
  useEffect(() => {
    if (selected && options.some((o) => o.inputId === selected)) return;
    setSelected(options[0]?.inputId ?? '');
  }, [options, selected]);

  const full = cams.length >= OB_MAX_CAMS;
  const adopt = async () => {
    const input = options.find((o) => o.inputId === selected);
    if (!input || busy || full) return;
    setBusy(true);
    await room.adoptInput({
      inputId: input.inputId,
      role,
      name: input.title.slice(0, 24),
    });
    setBusy(false);
    load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
        <ObSelect
          label='ROOM INPUT'
          value={selected}
          onChange={setSelected}
          style={{ flex: 1 }}>
          {options.length === 0 ? (
            <option value=''>no other video inputs in the room</option>
          ) : null}
          {options.map((o) => (
            <option key={o.inputId} value={o.inputId}>
              {o.title || o.inputId} · {o.type}
            </option>
          ))}
        </ObSelect>
        <ObSelect
          value={role}
          onChange={(v) => setRole(toRole(v, role))}
          style={{ width: 110, flexShrink: 0 }}>
          {FIXED_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </ObSelect>
        <Chip
          label={busy ? 'ADOPTING…' : 'ADOPT'}
          disabled={busy || !selected || full}
          onClick={() => void adopt()}
        />
      </div>
      <Meta size={8.5} tracking={0.08} color={OB.dim2}>
        uses a stream already added to this room as a camera
      </Meta>
    </div>
  );
}
