'use client';

import {
  Display,
  Meta,
  MicMeter,
  Mono,
  OB,
  ObButton,
  RADIUS,
  WarnPlate,
  scanLines,
  useIsLandscape,
} from '@/components/ob-van/ob-kit';

/**
 * Step 3 — the camera rig: self-preview, mic check, then GO LIVE (asks the
 * server for a WHIP input and publishes). The page moves on to the tally
 * screen by itself once the publish is up.
 */
export function CamRigStep({
  camOn,
  camErr,
  facing,
  publishing,
  live,
  sendFps,
  micLevel,
  attachVideo,
  seatLabel,
  onEnable,
  onFlip,
  onGoLive,
  onEditSeat,
}: {
  camOn: boolean;
  camErr: string | null;
  facing: 'user' | 'environment';
  publishing: boolean;
  live: boolean;
  /** usePublishWatchdog's send rate (null while not live). */
  sendFps: number | null;
  micLevel: number;
  attachVideo: (el: HTMLVideoElement | null) => void;
  /** "CAM 3 · SPEAKER · OLA" once the seat is taken. */
  seatLabel: string | null;
  onEnable: () => void;
  onFlip: () => void;
  onGoLive: () => void;
  onEditSeat: () => void;
}) {
  const landscape = useIsLandscape();
  const sending = live && sendFps != null && sendFps > 0;

  const preview = (
    <div
      style={{
        position: 'relative',
        flex: landscape ? '1 1 0' : undefined,
        minWidth: 0,
        minHeight: landscape ? 0 : 200,
        height: landscape ? '100%' : '44vh',
        maxHeight: landscape ? undefined : 420,
        background: OB.well,
        backgroundImage: scanLines(0.03),
        border: `1px solid ${OB.rule2}`,
        borderRadius: RADIUS,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {camOn ? (
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
            objectFit: 'contain',
            transform: facing === 'user' ? 'scaleX(-1)' : undefined,
          }}
        />
      ) : (
        <Mono size={11} weight={600} tracking={0.2} color={OB.dim2}>
          CAMERA OFF
        </Mono>
      )}
      <span
        style={{
          position: 'absolute',
          left: 8,
          top: 8,
          padding: '3px 6px',
          background: OB.scrim,
          borderRadius: 2,
        }}>
        <Mono size={9} weight={600} tracking={0.16} color={OB.dim}>
          {facing === 'user' ? 'FRONT CAMERA' : 'REAR CAMERA'}
        </Mono>
      </span>
    </div>
  );

  const controls = (
    <div
      style={{
        flex: landscape ? '0 0 260px' : undefined,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        minWidth: 0,
      }}>
      {seatLabel ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}>
          <Display
            size={20}
            weight={700}
            tracking={0.04}
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}>
            {seatLabel}
          </Display>
          <ObButton
            size='xs'
            variant='ghost'
            label='EDIT'
            disabled={publishing || live}
            onClick={onEditSeat}
          />
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Meta size={9.5}>MIC</Meta>
        <MicMeter level={camOn ? micLevel : 0} style={{ flex: 1 }} />
      </div>

      <Mono
        size={10.5}
        weight={600}
        tracking={0.18}
        color={sending ? OB.chalk : live || publishing ? OB.amber : OB.dim2}>
        {sending
          ? `SENDING ${sendFps} FPS`
          : live || publishing
            ? 'NO SIGNAL OUT'
            : camOn
              ? 'READY — NOT SENDING YET'
              : 'CAMERA OFF'}
      </Mono>

      {camErr ? <WarnPlate tone='bad'>{camErr}</WarnPlate> : null}

      {!camOn ? (
        <ObButton
          block
          size='lg'
          variant='primary'
          label='ENABLE CAMERA'
          active
          onClick={onEnable}
        />
      ) : (
        <>
          <ObButton
            block
            size='lg'
            variant='program'
            label={publishing ? 'OPENING LINK…' : 'GO LIVE'}
            pending={publishing}
            disabled={publishing || live}
            active={!publishing && !live}
            onClick={onGoLive}
          />
          <ObButton
            block
            size='md'
            variant='outline'
            label='FLIP CAMERA'
            disabled={publishing || live}
            onClick={onFlip}
          />
        </>
      )}

      <Meta size={9.5} tracking={0.1} color={OB.dim2}>
        {camOn
          ? 'hold the phone sideways for a 16:9 picture'
          : 'allow camera and microphone when the browser asks'}
      </Meta>
    </div>
  );

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: landscape ? 'row' : 'column',
        gap: 14,
      }}>
      {preview}
      {controls}
    </div>
  );
}
