'use client';

import type { ObTally } from '@smelter-editor/types';
import {
  Display,
  Meta,
  MicMeter,
  Mono,
  OB,
  ObButton,
  WarnPlate,
  useArmed,
  useIsLandscape,
} from '@/components/ob-van/ob-kit';
import { TALLY_LABEL } from '@/lib/ob-van/tally';

export type HudStatus = { text: string; tone: 'ok' | 'warn' };

const TALLY_BG: Record<ObTally, string> = {
  program: OB.program,
  preview: OB.preview,
  off: OB.page,
};

const TALLY_FG: Record<ObTally, string> = {
  program: '#fff',
  preview: OB.dark,
  off: OB.chalk,
};

/**
 * The live screen, readable from across the room: the whole phone is the
 * tally light — red ON AIR, green PREVIEW, dark STANDBY — with the camera
 * number huge in the middle. The self-view keeps running underneath at low
 * opacity (the publish track stays warm and framing drift stays visible);
 * the controls sit on a dark dock so they read on any tally colour.
 */
export function CamLiveHud({
  tally,
  camNumber,
  name,
  roleText,
  talent,
  facing,
  attachVideo,
  status,
  camErr,
  muted,
  micLevel,
  onToggleMute,
  onStopVideo,
  onLeave,
}: {
  tally: ObTally | null;
  camNumber: number | null;
  name: string;
  roleText: string;
  talent: string | null;
  facing: 'user' | 'environment';
  attachVideo: (el: HTMLVideoElement | null) => void;
  status: HudStatus;
  camErr: string | null;
  muted: boolean;
  micLevel: number;
  onToggleMute: () => void;
  /** Stop publishing on purpose and go back to the rig. */
  onStopVideo: () => void;
  onLeave: () => void;
}) {
  const landscape = useIsLandscape();
  const { armed, arm, disarm } = useArmed(4000);
  const t: ObTally = tally ?? 'off';
  const fg = TALLY_FG[t];
  const lit = t !== 'off';

  const press = (id: 'leave' | 'stop', fire: () => void) => {
    if (armed === id) {
      disarm();
      fire();
    } else {
      arm(id);
    }
  };

  const tallyBlock = (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: landscape ? 4 : 10,
        textAlign: 'center',
        padding: '0 12px',
      }}>
      <Display
        size={48}
        weight={800}
        tracking={0.12}
        color={fg}
        style={{
          fontSize: landscape ? 'min(9vh, 7vw)' : 'min(13vw, 7vh)',
          opacity: lit ? 1 : 0.7,
        }}>
        {TALLY_LABEL[t]}
      </Display>
      <Display
        size={200}
        weight={800}
        tracking={0}
        lineHeight={0.82}
        color={fg}
        style={{
          fontSize: landscape ? 'min(52vh, 34vw)' : 'min(62vw, 38vh)',
        }}>
        {camNumber ?? '–'}
      </Display>
      <Display
        size={28}
        weight={700}
        tracking={0.04}
        color={fg}
        style={{
          fontSize: landscape ? 'min(7vh, 5vw)' : 'min(8vw, 4.2vh)',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {name || 'CAMERA'}
      </Display>
      <Mono
        size={12}
        weight={600}
        tracking={0.18}
        color={fg}
        style={{
          opacity: 0.8,
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
        {roleText}
        {talent ? ` · ${talent}` : ''}
      </Mono>
    </div>
  );

  const dock = (
    <div
      style={{
        position: 'relative',
        zIndex: 1,
        flex: landscape ? '0 0 min(300px, 42vw)' : undefined,
        alignSelf: landscape ? 'stretch' : undefined,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: landscape ? 'center' : undefined,
        gap: 10,
        background: OB.scrim,
        borderTop: landscape ? 'none' : `1px solid ${OB.rule2}`,
        borderLeft: landscape ? `1px solid ${OB.rule2}` : 'none',
        padding: landscape
          ? 'calc(env(safe-area-inset-top, 0px) + 12px) calc(env(safe-area-inset-right, 0px) + 14px) calc(env(safe-area-inset-bottom, 0px) + 12px) 14px'
          : '12px calc(env(safe-area-inset-right, 0px) + 14px) calc(env(safe-area-inset-bottom, 0px) + 12px) calc(env(safe-area-inset-left, 0px) + 14px)',
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Meta size={9.5}>MIC</Meta>
        {muted ? (
          <Mono size={10} weight={600} tracking={0.18} color={OB.amber}>
            MUTED
          </Mono>
        ) : (
          <MicMeter level={micLevel} style={{ flex: 1 }} />
        )}
      </div>
      {camErr ? <WarnPlate tone='bad'>{camErr}</WarnPlate> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <ObButton
          size='md'
          variant={muted ? 'danger' : 'outline'}
          label={muted ? 'UNMUTE' : 'MUTE MIC'}
          active={muted}
          onClick={onToggleMute}
          style={{ flex: 1 }}
        />
        <ObButton
          size='md'
          variant={armed === 'leave' ? 'dangerSolid' : 'danger'}
          label={armed === 'leave' ? 'PRESS AGAIN' : 'LEAVE'}
          onClick={() => press('leave', onLeave)}
          style={{ flex: 1 }}
        />
      </div>
      <ObButton
        size='sm'
        variant={armed === 'stop' ? 'danger' : 'ghost'}
        label={armed === 'stop' ? 'PRESS AGAIN TO STOP VIDEO' : 'STOP VIDEO'}
        onClick={() => press('stop', onStopVideo)}
        block
      />
    </div>
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: TALLY_BG[t],
        color: fg,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: landscape ? 'row' : 'column',
        transition: 'background-color .15s ease',
      }}>
      {/* Dim self-view: keeps the camera pipeline warm + shows framing. */}
      <video
        ref={attachVideo}
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: lit ? 0.16 : 0.22,
          mixBlendMode: lit ? 'luminosity' : undefined,
          transform: facing === 'user' ? 'scaleX(-1)' : undefined,
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: landscape
            ? 'calc(env(safe-area-inset-top, 0px) + 8px) 8px calc(env(safe-area-inset-bottom, 0px) + 8px) calc(env(safe-area-inset-left, 0px) + 12px)'
            : 'calc(env(safe-area-inset-top, 0px) + 12px) calc(env(safe-area-inset-right, 0px) + 14px) 8px calc(env(safe-area-inset-left, 0px) + 14px)',
        }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '4px 8px',
              background: OB.scrim,
              borderRadius: 2,
              minWidth: 0,
            }}>
            <span
              aria-hidden
              className={status.tone === 'warn' ? 'ob-pulse' : undefined}
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                flexShrink: 0,
                background: status.tone === 'warn' ? OB.amber : OB.chalk,
              }}
            />
            <Mono
              size={10}
              weight={600}
              tracking={0.16}
              color={status.tone === 'warn' ? OB.amber : OB.chalk}
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
              {status.text}
            </Mono>
          </span>
          <Mono size={10} weight={600} tracking={0.2} color={fg}>
            OB · CAMERA
          </Mono>
        </div>
        {tallyBlock}
      </div>
      {dock}
    </div>
  );
}
