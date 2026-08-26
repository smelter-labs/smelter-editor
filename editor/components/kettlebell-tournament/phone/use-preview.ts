'use client';

import { useCallback, useRef } from 'react';

// A <video> that already played once has its autoplay flag consumed — a
// second srcObject assignment (camera flip, device switch) freezes on the
// old stream's last frame unless play() is called again.
function applyStream(el: HTMLVideoElement, stream: MediaStream | null) {
  el.muted = true; // never monitor your own mic
  if (el.srcObject !== stream) el.srcObject = stream;
  if (stream) el.play().catch(() => {}); // stream swaps interrupt play()
}

/**
 * Self-preview plumbing shared by the lifter page, the phone commentate page
 * and the desktop panel rig: any number of <video> elements attach via a
 * ref-callback and all follow the current stream across swaps.
 */
export function usePreviewSet(
  streamRef: React.MutableRefObject<MediaStream | null>,
): {
  /** Ref-callback for self-preview <video> elements (any number of them). */
  attachPreview: (el: HTMLVideoElement | null) => void;
  /** Re-point every attached element after the stream changes. */
  syncPreviews: () => void;
} {
  const previewElsRef = useRef(new Set<HTMLVideoElement>());

  const attachPreview = useCallback(
    (el: HTMLVideoElement | null) => {
      if (!el) return;
      previewElsRef.current.add(el);
      if (streamRef.current) applyStream(el, streamRef.current);
    },
    [streamRef],
  );

  const syncPreviews = useCallback(() => {
    for (const el of previewElsRef.current) {
      if (el.isConnected) applyStream(el, streamRef.current);
      else previewElsRef.current.delete(el);
    }
  }, [streamRef]);

  return { attachPreview, syncPreviews };
}
