'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChipButton,
  KBT,
  KbtButton,
  Label,
  Plate,
  WarnPlate,
  kbtMonoFont,
} from '../kbt-kit';

/**
 * Step 2 — the lifter's profile photo (optional). Two paths: pick from the
 * gallery or take a selfie with a short-lived front-camera preview (the rig
 * step's stream is framed for a full body at 2–3 m — wrong for a portrait,
 * and its lifecycle belongs to the WHIP publish). Every source is re-encoded
 * to a square 512×512 JPEG on-device, which is what also neutralizes HEIC
 * files and EXIF rotation before the server ever sees the bytes.
 */

const PHOTO_SIZE = 512;
const JPEG_QUALITY = 0.85;

async function toSquareJpeg(
  src: File | HTMLVideoElement,
  size = PHOTO_SIZE,
): Promise<Blob> {
  let source: CanvasImageSource;
  let sw: number;
  let sh: number;
  let cleanup: (() => void) | null = null;
  if (src instanceof HTMLVideoElement) {
    source = src;
    sw = src.videoWidth;
    sh = src.videoHeight;
  } else {
    try {
      const bmp = await createImageBitmap(src, {
        imageOrientation: 'from-image',
      });
      source = bmp;
      sw = bmp.width;
      sh = bmp.height;
      cleanup = () => bmp.close();
    } catch {
      // HEIC outside Safari, or a Safari without the imageOrientation option:
      // <img> decode applies EXIF rotation on its own.
      const url = URL.createObjectURL(src);
      const img = new Image();
      img.src = url;
      try {
        await img.decode();
      } catch {
        URL.revokeObjectURL(url);
        throw new Error('undecodable image');
      }
      source = img;
      sw = img.naturalWidth;
      sh = img.naturalHeight;
      cleanup = () => URL.revokeObjectURL(url);
    }
  }
  try {
    if (!sw || !sh) throw new Error('empty image');
    const side = Math.min(sw, sh);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // Selfies are saved unmirrored (broadcast/roster convention — the
    // mirrored live preview is only ergonomics). To save the mirrored view
    // instead: ctx.translate(size, 0); ctx.scale(-1, 1); before drawImage.
    ctx.drawImage(
      source,
      (sw - side) / 2,
      (sh - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob) throw new Error('encode failed');
    return blob;
  } finally {
    cleanup?.();
  }
}

type Mode = 'idle' | 'selfie' | 'preview';

export function PhotoStep({
  existingPhoto,
  onUpload,
  onSkip,
}: {
  /** The roster already has a photo for this name (rejoin after a reload). */
  existingPhoto: boolean;
  /** Upload the processed JPEG; rejects with a displayable Error message. */
  onUpload: (blob: Blob) => Promise<void>;
  onSkip: () => void;
}) {
  const [mode, setMode] = useState<Mode>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selfieStreamRef = useRef<MediaStream | null>(null);
  const selfieVideoRef = useRef<HTMLVideoElement | null>(null);

  const stopSelfie = useCallback(() => {
    selfieStreamRef.current?.getTracks().forEach((t) => t.stop());
    selfieStreamRef.current = null;
  }, []);

  useEffect(
    () => () => {
      stopSelfie();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const showPreview = useCallback((nextBlob: Blob) => {
    setBlob(nextBlob);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(nextBlob);
    });
    setMode('preview');
  }, []);

  const pickFile = useCallback(
    async (file: File) => {
      setErr(null);
      try {
        showPreview(await toSquareJpeg(file));
      } catch {
        setErr('COULD NOT READ THAT IMAGE — try a different photo.');
      }
    },
    [showPreview],
  );

  const startSelfie = useCallback(async () => {
    setErr(null);
    try {
      stopSelfie();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 } },
        audio: false,
      });
      selfieStreamRef.current = stream;
      setMode('selfie');
    } catch {
      setErr(
        'CAMERA BLOCKED — allow camera access for this site (HTTPS required), or pick from the gallery.',
      );
    }
  }, [stopSelfie]);

  const attachSelfieVideo = useCallback((el: HTMLVideoElement | null) => {
    selfieVideoRef.current = el;
    if (el && selfieStreamRef.current) el.srcObject = selfieStreamRef.current;
  }, []);

  const capture = useCallback(async () => {
    const video = selfieVideoRef.current;
    if (!video) return;
    setErr(null);
    try {
      const shot = await toSquareJpeg(video);
      stopSelfie();
      showPreview(shot);
    } catch {
      setErr('CAPTURE FAILED — wait for the preview and try again.');
    }
  }, [showPreview, stopSelfie]);

  const upload = useCallback(async () => {
    if (!blob) return;
    setBusy(true);
    setErr(null);
    try {
      await onUpload(blob);
    } catch (e) {
      setErr(
        e instanceof Error && e.message
          ? e.message
          : 'UPLOAD FAILED — check the connection and try again.',
      );
      setBusy(false);
    }
  }, [blob, onUpload]);

  const retake = useCallback(() => {
    setBlob(null);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
    setMode('idle');
  }, []);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}>
      <Plate
        cutPx={14}
        innerStyle={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: '14px 16px',
        }}>
        <Label size={10}>YOUR PHOTO</Label>
        <span
          style={{
            fontFamily: kbtMonoFont,
            fontSize: 11,
            letterSpacing: 0.5,
            lineHeight: 1.6,
            color: KBT.dim,
            whiteSpace: 'pre-line',
          }}>
          {existingPhoto
            ? 'Photo on file from your last visit — keep it, or shoot a new one.'
            : 'Rides next to your name on the roster, the standings and the broadcast. Optional — skip if you like.'}
        </span>
      </Plate>

      <div
        style={{
          position: 'relative',
          flex: 1,
          minHeight: 220,
          background: '#000',
          border: `1px solid ${KBT.border}`,
          overflow: 'hidden',
        }}>
        {mode === 'selfie' ? (
          <video
            ref={attachSelfieVideo}
            autoPlay
            playsInline
            muted
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)',
            }}
          />
        ) : mode === 'preview' && previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt='Your profile photo'
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        ) : (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Label size={11} tracking={3}>
              {existingPhoto ? 'PHOTO ON FILE' : 'NO PHOTO YET'}
            </Label>
          </div>
        )}
        {/* Square framing guide: what you see is the crop that ships. */}
        {mode === 'selfie' ? (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              width: 'min(70vw, 260px)',
              aspectRatio: '1',
              border: `2px dashed ${KBT.dim}`,
              pointerEvents: 'none',
            }}
          />
        ) : null}
        {mode === 'selfie' ? (
          <ChipButton
            label='CANCEL'
            dense
            onClick={() => {
              stopSelfie();
              setMode('idle');
            }}
            style={{ position: 'absolute', top: 8, right: 8 }}
          />
        ) : null}
      </div>

      {err ? <WarnPlate>{err}</WarnPlate> : null}

      <input
        ref={fileInputRef}
        type='file'
        accept='image/*'
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void pickFile(f);
        }}
      />

      {mode === 'selfie' ? (
        <KbtButton
          block
          variant='solid'
          label='TAKE THE SHOT'
          sub='center your face in the square'
          active
          onClick={() => void capture()}
        />
      ) : mode === 'preview' ? (
        <>
          <KbtButton
            block
            variant='solid'
            label={busy ? 'UPLOADING…' : 'USE THIS PHOTO'}
            sub='shows up next to your name'
            disabled={busy}
            active={!busy}
            onClick={() => void upload()}
          />
          <div style={{ display: 'flex', gap: 10 }}>
            <KbtButton
              block
              variant='outline'
              label='RETAKE'
              disabled={busy}
              onClick={retake}
              style={{ flex: 1 }}
            />
            <KbtButton
              block
              variant='outline'
              label='SKIP'
              disabled={busy}
              onClick={onSkip}
              style={{ flex: 1 }}
            />
          </div>
        </>
      ) : (
        <>
          <KbtButton
            block
            variant='solid'
            label='TAKE A SELFIE'
            sub='front camera, square crop'
            active
            onClick={() => void startSelfie()}
          />
          <KbtButton
            block
            variant='solid'
            label='FROM GALLERY'
            sub='pick an existing photo'
            active
            onClick={() => fileInputRef.current?.click()}
          />
          <KbtButton
            block
            variant='outline'
            label={existingPhoto ? 'KEEP CURRENT PHOTO' : 'SKIP FOR NOW'}
            onClick={onSkip}
          />
        </>
      )}
    </div>
  );
}
