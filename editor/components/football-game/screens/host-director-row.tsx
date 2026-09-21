'use client';

import React, { useState } from 'react';
import {
  FB_PANO_VIEWS,
  FB_TRICAM_VIEWS,
  type FbStateEvent,
  type FbView,
} from '@smelter-editor/types';
import { setFbConfig, setFbMinimap, setFbView } from '@/app/actions/actions';
import { Chip, FB, Mono } from '../fb-kit';
import { VIEW_LABEL, overrideFor } from '../view-labels';
import type { FbRoom } from '../use-fb-room';

/**
 * The host's fallback for the moderator's VIEW plate: when the panel phone is
 * gone the director can still be steered from the laptop (REST, no seat
 * needed). Also frees a stuck moderator seat.
 */
export function HostDirectorRow({
  room,
  state,
}: {
  room: FbRoom;
  state: FbStateEvent | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const roomId = room.roomId;
  const session = state?.session ?? null;
  const views: readonly FbView[] =
    session === 'pano'
      ? FB_PANO_VIEWS
      : session === 'tricam'
        ? FB_TRICAM_VIEWS
        : ['auto'];
  const activeView: FbView =
    state?.viewOverride?.mode === 'view' ? state.viewOverride.view : 'auto';
  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((err) =>
      setError(err instanceof Error ? err.message : 'Request failed'),
    );
  };
  const moderator = state?.commentator ?? null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div
        style={{
          display: 'flex',
          gap: 5,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
        <Mono
          size={9}
          tracking={0.22}
          color={FB.chalk}
          style={{ opacity: 0.7 }}>
          VIEW
        </Mono>
        {views.map((v) => (
          <Chip
            key={v}
            dense
            label={VIEW_LABEL[v]}
            active={activeView === v}
            disabled={
              !roomId ||
              (session === 'tricam' &&
                v !== 'auto' &&
                !state?.cams[v as 'left' | 'centre' | 'right']?.fileName)
            }
            onClick={() => roomId && run(setFbView(roomId, overrideFor(v)))}
          />
        ))}
        <span style={{ flex: 1 }} />
        <Chip
          dense
          label={state?.config.replay ? 'REPLAY · ON' : 'REPLAY · OFF'}
          active={!!state?.config.replay}
          disabled={!roomId}
          onClick={() =>
            roomId &&
            run(setFbConfig(roomId, { replay: !state?.config.replay }))
          }
        />
        <Chip
          dense
          label={state?.minimap ? 'MINIMAP · ON' : 'MINIMAP · OFF'}
          active={!!state?.minimap}
          disabled={!roomId}
          onClick={() => roomId && run(setFbMinimap(roomId, !state?.minimap))}
        />
        {moderator ? (
          <Chip
            dense
            tone='danger'
            title={`Free the moderator seat (${moderator.name})`}
            label={`KICK ${moderator.name.toUpperCase()}`}
            onClick={() => void room.control('kick_commentator')}
          />
        ) : null}
      </div>
      {error ? (
        <Mono size={9} tracking={0.18} color={FB.amber}>
          {error.toUpperCase()}
        </Mono>
      ) : null}
    </div>
  );
}
