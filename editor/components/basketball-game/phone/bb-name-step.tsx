'use client';

import React from 'react';
import { BbButton, Copy, Display, NameField } from '../bb-kit';

/**
 * Name step: two-line headline, a hint, the big name field, an optional
 * preview slot (the commentator's lower third) and the primary at the
 * bottom. Secondary actions render under the primary.
 */
export function BbNameStep({
  heading,
  hint,
  name,
  onName,
  onContinue,
  continueLabel = 'CONTINUE',
  placeholder,
  maxLength = 20,
  optional = false,
  preview,
  secondary,
}: {
  heading: string[];
  hint?: string;
  name: string;
  onName: (v: string) => void;
  onContinue: () => void;
  continueLabel?: string;
  placeholder?: string;
  maxLength?: number;
  /** Empty name allowed (camera operators). */
  optional?: boolean;
  preview?: React.ReactNode;
  secondary?: React.ReactNode;
}) {
  const ready = optional || name.trim().length > 0;
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 24 }}>
      <Display
        size={44}
        weight={800}
        lineHeight={0.95}
        style={{ marginTop: 16, whiteSpace: 'pre-line' }}>
        {heading.join('\n')}
      </Display>
      {hint ? (
        <Copy size={13} color='rgba(232,228,218,.7)' lineHeight={1.6}>
          {hint}
        </Copy>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onContinue();
        }}>
        <NameField
          value={name}
          onChange={onName}
          placeholder={placeholder}
          maxLength={maxLength}
          fontSize={34}
          autoCapitalize='words'
          autoFocus
        />
      </form>
      {preview}
      <div
        style={{
          marginTop: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        }}>
        <BbButton
          block
          active={ready}
          disabled={!ready}
          size='lg'
          label={continueLabel}
          onClick={onContinue}
          style={{ height: 60, fontSize: 26 }}
        />
        {secondary}
      </div>
    </div>
  );
}
