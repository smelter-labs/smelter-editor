'use client';

import React from 'react';
import { KBT, kbtMonoFont } from '../kbt-kit';

const underlineButtonStyle: React.CSSProperties = {
  padding: '2px 0 6px',
  alignSelf: 'center',
  fontFamily: kbtMonoFont,
  fontSize: 10,
  letterSpacing: 1,
  color: KBT.dim,
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};

/**
 * The discreet "publish a recorded clip instead of the camera" affordance:
 * a hidden file input plus an underlined mono link. Shared between the
 * camera rig step, the ready screen and any resume flow that has to re-ask
 * for the file (a File handle never survives a page refresh).
 */
export function UseRecordingButton({
  fileMode,
  onUseFile,
}: {
  /** Already in recording mode — flips the copy to "pick a different one". */
  fileMode?: boolean;
  onUseFile: (file: File) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={fileInputRef}
        type='file'
        accept='video/*'
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // re-picking the same file must re-fire
          if (file) onUseFile(file);
        }}
      />
      <button
        type='button'
        className='kbt-btn'
        onClick={() => fileInputRef.current?.click()}
        style={underlineButtonStyle}>
        {fileMode ? 'PICK A DIFFERENT RECORDING' : 'USE A RECORDING INSTEAD'}
      </button>
    </>
  );
}

/** The way back: swap the published recording for the live camera. */
export function UseCameraButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type='button'
      className='kbt-btn'
      onClick={onClick}
      style={underlineButtonStyle}>
      USE THE CAMERA
    </button>
  );
}
