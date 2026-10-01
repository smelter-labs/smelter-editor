'use client';

import React, { useState } from 'react';
import { Chip, ChipLink, Display, Meta, Mono, OB, QrBox } from '../ob-kit';
import type { ObJoinLinks } from '../arcade';

function CopyChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Chip
      dense
      label={copied ? 'COPIED' : 'COPY'}
      tone={copied ? 'preview' : 'default'}
      disabled={!text}
      onClick={() => {
        void navigator.clipboard
          ?.writeText(text)
          .then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          })
          .catch(() => {});
      }}
    />
  );
}

/**
 * How cameras and the operator get in: the phone QR (also burned into the
 * on-air setup slate by the server) and the operator panel link.
 */
export function JoinPlate({ links }: { links: ObJoinLinks }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {links.cam ? (
        <QrBox url={links.cam} size={104} />
      ) : (
        <div
          style={{
            width: 120,
            height: 120,
            border: `1px dashed ${OB.rule2}`,
            flexShrink: 0,
          }}
        />
      )}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          minWidth: 0,
          flex: 1,
        }}>
        <Display size={17} weight={700}>
          PHONES → SCAN TO JOIN
        </Display>
        <Mono size={10} tracking={0.04} uppercase={false} color={OB.dim}>
          Each phone picks a name and a role, then goes live as a camera. Same
          Wi-Fi as this machine works best.
        </Mono>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <Meta
            size={8.5}
            tracking={0.04}
            color={OB.dim2}
            style={{
              flex: 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textTransform: 'none',
            }}>
            {links.cam || 'link appears once the event exists'}
          </Meta>
          <CopyChip text={links.cam} />
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            borderTop: `1px solid ${OB.rule}`,
            paddingTop: 8,
          }}>
          <Meta size={9} style={{ flex: 1 }}>
            OPERATOR PANEL (TABLET)
          </Meta>
          {links.panel ? (
            <ChipLink dense label='OPEN' href={links.panel} />
          ) : null}
          <CopyChip text={links.panel} />
        </div>
      </div>
    </div>
  );
}
