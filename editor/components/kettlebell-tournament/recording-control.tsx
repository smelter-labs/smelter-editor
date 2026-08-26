'use client';

import React from 'react';
import {
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  PlateTitle,
  StatusDot,
} from './kbt-kit';
import type { KbtRecording } from './use-kbt-recording';

/**
 * Floating REC toggle for the host arcade — persistent chrome, so it sits on
 * a scrim (readable over the heat screen's fullscreen video).
 */
export function RecChip({ rec }: { rec: KbtRecording }) {
  const label = rec.isWaitingForDownload
    ? 'SAVING MP4…'
    : rec.effectiveIsRecording
      ? 'REC — TAP TO STOP'
      : 'RECORD SHOW';
  return (
    <div style={{ background: KBT.scrim, padding: 4 }}>
      <ChipButton
        label={label}
        tone={rec.effectiveIsRecording ? 'danger' : 'default'}
        disabled={rec.isToggling || rec.isWaitingForDownload}
        leading={
          rec.effectiveIsRecording && !rec.isWaitingForDownload ? (
            <span
              className='kbt-blink'
              style={{
                width: 8,
                height: 8,
                background: KBT.bad,
                flexShrink: 0,
              }}
            />
          ) : undefined
        }
        onClick={() => void rec.toggle()}
        title={
          rec.effectiveIsRecording
            ? 'Stop recording — the mp4 downloads when it finalizes'
            : 'Record everything viewers see + hear as an mp4'
        }
      />
    </div>
  );
}

/** RECORDING plate for the commentator panel. */
export function RecordingPlate({ rec }: { rec: KbtRecording }) {
  return (
    <Plate
      cutPx={18}
      innerStyle={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: '14px 18px',
      }}>
      <PlateTitle
        right={
          rec.effectiveIsRecording ? <StatusDot state='bad' pulse /> : undefined
        }>
        RECORDING
      </PlateTitle>
      {rec.isWaitingForDownload ? (
        <KbtButton
          block
          disabled
          label='SAVING MP4…'
          sub='download starts in a moment'
        />
      ) : rec.effectiveIsRecording ? (
        <KbtButton
          block
          variant='danger'
          active
          locked={rec.isToggling}
          label='STOP + DOWNLOAD'
          sub='mp4 downloads when it finalizes'
          onClick={() => void rec.toggle()}
        />
      ) : (
        <KbtButton
          block
          variant='outline'
          locked={rec.isToggling}
          label='START RECORDING'
          sub='saves the program as mp4'
          onClick={() => void rec.toggle()}
        />
      )}
      <Label size={10} tracking={2}>
        records everything viewers see + hear
      </Label>
    </Plate>
  );
}
