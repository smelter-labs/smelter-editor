'use client';

import type { ObFixedCamRole } from '@smelter-editor/types';
import {
  Chip,
  Display,
  Field,
  Meta,
  OB,
  ObButton,
  TextField,
} from '@/components/ob-van/ob-kit';
import { FIXED_ROLES, ROLE_HINT, ROLE_LABEL } from '@/lib/ob-van/roles';

export type RoleChoice = ObFixedCamRole | 'custom';

export const NAME_MAX = 24;
export const TALENT_MAX = 40;

/**
 * Step 2 — who holds this camera and what it points at. The role steers the
 * AI director (speaker cams cut on speech, wide is the safe shot…); the
 * talent is the person in the shot, printed on lower thirds.
 */
export function CamSetupStep({
  name,
  onName,
  roleChoice,
  onRoleChoice,
  customName,
  onCustomName,
  talent,
  onTalent,
  canContinue,
  onContinue,
  camNumber,
}: {
  name: string;
  onName: (v: string) => void;
  roleChoice: RoleChoice;
  onRoleChoice: (v: RoleChoice) => void;
  customName: string;
  onCustomName: (v: string) => void;
  talent: string;
  onTalent: (v: string) => void;
  canContinue: boolean;
  onContinue: () => void;
  /** Seat number when editing an existing seat. */
  camNumber: number | null;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Display size={30} weight={800} tracking={0.03}>
          {camNumber != null ? `CAM ${camNumber}` : 'TAKE A CAMERA SEAT'}
        </Display>
        <Meta size={10} tracking={0.1} color={OB.dim2}>
          this phone becomes one of the event cameras
        </Meta>
      </div>

      <Field label='YOUR NAME'>
        <TextField
          display
          value={name}
          onChange={onName}
          placeholder='OPERATOR NAME'
          maxLength={NAME_MAX}
          height={48}
          fontSize={24}
          onEnter={canContinue ? onContinue : undefined}
        />
      </Field>

      <Field label='ROLE' hint='what this camera points at'>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FIXED_ROLES.map((r) => (
            <Chip
              key={r}
              label={ROLE_LABEL[r]}
              active={roleChoice === r}
              onClick={() => onRoleChoice(r)}
              style={{ height: 36 }}
            />
          ))}
          <Chip
            label='CUSTOM'
            active={roleChoice === 'custom'}
            onClick={() => onRoleChoice('custom')}
            style={{ height: 36 }}
          />
        </div>
        {roleChoice === 'custom' ? (
          <TextField
            value={customName}
            onChange={onCustomName}
            placeholder='e.g. drone, backstage'
            label='custom role name'
            maxLength={24}
            height={40}
            autoFocus
          />
        ) : (
          <Meta size={10} tracking={0.08} color={OB.dim}>
            {ROLE_HINT[roleChoice]}
          </Meta>
        )}
      </Field>

      <Field label='TALENT' hint='shown on lower thirds'>
        <TextField
          value={talent}
          onChange={onTalent}
          placeholder='who is in the shot (optional)'
          label='talent'
          maxLength={TALENT_MAX}
          height={40}
          onEnter={canContinue ? onContinue : undefined}
        />
      </Field>

      <ObButton
        block
        size='lg'
        variant='primary'
        label='CONTINUE'
        disabled={!canContinue}
        onClick={onContinue}
      />
    </div>
  );
}
