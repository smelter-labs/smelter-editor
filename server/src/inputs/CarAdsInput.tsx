import React, { useEffect, useRef, useState } from 'react';
import { Shader, Image, InputStream, Rescaler, View } from '@swmansion/smelter';
import type { CarAdBoxes, CarQuad } from '../app/store';
import { MotionPredictor } from './motionPredictor';

type CarAdsInputProps = {
  sourceInputId: string;
  data: CarAdBoxes;
  resolution: { width: number; height: number };
  volume: number;
};

const MAX_ADS = 8;
// Smooth-motion tuning (matches PacmanGhostsInput).
const TICK_MS = 16;
const SMOOTH = 0.25; // exponential easing toward the latest quad per tick
// corner-pin edge anti-aliasing, in source UV units.
const AD_FEATHER = 0.02;
const DEFAULT_AD_OPACITY = 0.92;

/** A quad in tile pixels, corner order [tl, tr, br, bl] flattened to x/y pairs. */
type PxQuad = number[];

/**
 * Sticks the ad image onto the side of each tracked car. The server sends the
 * door-panel quad (from the wheel pair) in normalized frame coordinates; here
 * each quad is mapped through the same rescale 'fill' (cover) transform the
 * video uses and rendered as the `car-ad` image warped onto the quad by the
 * corner-pin homography shader.
 *
 * Between AI responses each quad is dead-reckoned: MotionPredictor
 * extrapolates all four corners along their estimated velocity every tick so
 * the ad keeps pace with a moving car, and each new response corrects the
 * estimate; the per-tick easing hides the correction jumps.
 */
export function CarAdsInput({
  sourceInputId,
  data,
  resolution,
  volume,
}: CarAdsInputProps) {
  const { width, height } = resolution;
  // Live track ids + per-track motion estimate + eased, currently-drawn quad.
  const idsRef = useRef<number[]>([]);
  const predictorRef = useRef(new MotionPredictor());
  const cursRef = useRef<Map<number, PxQuad>>(new Map());
  const [, setFrame] = useState(0);

  useEffect(() => {
    const { cars, frameW, frameH } = data;
    // Map normalized quads through the same cover transform as the video.
    const scale = Math.max(width / frameW, height / frameH);
    const dispW = frameW * scale;
    const dispH = frameH * scale;
    const offX = (width - dispW) / 2;
    const offY = (height - dispH) / 2;
    const toPx = (q: CarQuad): PxQuad =>
      q.flatMap((p) => [offX + p.x * dispW, offY + p.y * dispH]);

    const now = Date.now();
    const live = new Set<number>();
    for (const car of cars.slice(0, MAX_ADS)) {
      if (!car.quad) continue;
      live.add(car.id);
      predictorRef.current.update(car.id, toPx(car.quad), now);
    }
    idsRef.current = [...live].sort((a, b) => a - b);
    predictorRef.current.prune(live);
    for (const id of [...cursRef.current.keys()]) {
      if (!live.has(id)) cursRef.current.delete(id);
    }
  }, [data, width, height]);

  // Every tick, ease each drawn quad toward its *predicted* position — the
  // target itself moves along the track's velocity between responses.
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      const curs = cursRef.current;
      for (const id of idsRef.current) {
        const tgt = predictorRef.current.predict(id, now);
        if (!tgt) continue;
        const cur = curs.get(id);
        if (!cur) {
          // New car: the ad appears in place rather than sliding in.
          curs.set(id, [...tgt]);
        } else {
          for (let i = 0; i < tgt.length; i++) {
            cur[i] += (tgt[i] - cur[i]) * SMOOTH;
          }
        }
      }
      setFrame((f) => (f + 1) % 1_000_000);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, []);

  const opacity = data.adOpacity ?? DEFAULT_AD_OPACITY;

  return (
    <View style={{ width, height }}>
      <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
        <InputStream inputId={sourceInputId} volume={volume} />
      </Rescaler>
      <View style={{ top: 0, left: 0, width, height, overflow: 'hidden' }}>
        {idsRef.current.map((id) => {
          const quad =
            cursRef.current.get(id) ??
            predictorRef.current.predict(id, Date.now());
          return quad ? (
            <AdQuad key={id} quad={quad} opacity={opacity} />
          ) : null;
        })}
      </View>
    </View>
  );
}

/**
 * One warped ad. The corner-pin shader displaces the corners of its own layer,
 * so the ad is laid out on the quad's bounding rect and each corner offset (in
 * UV units of that rect) pins it to the corresponding quad corner.
 */
function AdQuad({ quad, opacity }: { quad: PxQuad; opacity: number }) {
  const [tlx, tly, trx, try_, brx, bry, blx, bly] = quad;
  const left = Math.min(tlx, trx, brx, blx);
  const top = Math.min(tly, try_, bry, bly);
  const w = Math.max(tlx, trx, brx, blx) - left;
  const h = Math.max(tly, try_, bry, bly) - top;
  if (w < 8 || h < 4) return null;

  const rectW = Math.max(1, Math.round(w));
  const rectH = Math.max(1, Math.round(h));
  // Offset of each quad corner from the rect's own corner, in rect UV units.
  const params = [
    { fieldName: 'tl_x', value: (tlx - left) / w },
    { fieldName: 'tl_y', value: (tly - top) / h },
    { fieldName: 'tr_x', value: (trx - left) / w - 1 },
    { fieldName: 'tr_y', value: (try_ - top) / h },
    { fieldName: 'br_x', value: (brx - left) / w - 1 },
    { fieldName: 'br_y', value: (bry - top) / h - 1 },
    { fieldName: 'bl_x', value: (blx - left) / w },
    { fieldName: 'bl_y', value: (bly - top) / h - 1 },
    { fieldName: 'feather', value: AD_FEATHER },
    { fieldName: 'opacity', value: opacity },
  ].map((p) => ({ type: 'f32' as const, ...p }));

  return (
    <View
      style={{
        top: Math.round(top),
        left: Math.round(left),
        width: rectW,
        height: rectH,
      }}>
      <Shader
        shaderId='corner-pin'
        resolution={{ width: rectW, height: rectH }}
        shaderParam={{ type: 'struct', value: params }}>
        <Rescaler style={{ width: rectW, height: rectH, rescaleMode: 'fill' }}>
          <Image imageId='car-ad' />
        </Rescaler>
      </Shader>
    </View>
  );
}

/**
 * Debug overlay for the drawBoxes toggle: green vehicle boxes, cyan wheel
 * circles and yellow quad corners, all mapped through the same cover transform
 * — for tuning detection before switching the ad overlay on.
 */
export function CarAdDebugBoxes({
  data,
  parent,
}: {
  data: CarAdBoxes;
  parent: { width: number; height: number };
}) {
  const { cars, frameW, frameH } = data;
  const scale = Math.max(parent.width / frameW, parent.height / frameH);
  const dispW = frameW * scale;
  const dispH = frameH * scale;
  const offX = (parent.width - dispW) / 2;
  const offY = (parent.height - dispH) / 2;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: parent.width,
        height: parent.height,
        overflow: 'hidden',
      }}>
      {cars.map((car) => (
        <View
          key={`box-${car.id}`}
          style={{
            top: Math.round(offY + car.box.y * dispH),
            left: Math.round(offX + car.box.x * dispW),
            width: Math.max(2, Math.round(car.box.w * dispW)),
            height: Math.max(2, Math.round(car.box.h * dispH)),
            borderWidth: 4,
            borderColor: '#00FF66FF',
            borderRadius: 4,
          }}
        />
      ))}
      {cars.flatMap(
        (car) =>
          car.wheels?.map((wheel, i) => {
            const r = Math.max(3, Math.round(wheel.r * dispW));
            return (
              <View
                key={`wheel-${car.id}-${i}`}
                style={{
                  top: Math.round(offY + wheel.y * dispH - r),
                  left: Math.round(offX + wheel.x * dispW - r),
                  width: r * 2,
                  height: r * 2,
                  borderWidth: 3,
                  borderColor: '#00CCFFFF',
                  borderRadius: r,
                }}
              />
            );
          }) ?? [],
      )}
      {cars.flatMap(
        (car) =>
          car.quad?.map((p, i) => (
            <View
              key={`corner-${car.id}-${i}`}
              style={{
                top: Math.round(offY + p.y * dispH - 6),
                left: Math.round(offX + p.x * dispW - 6),
                width: 12,
                height: 12,
                backgroundColor: '#FFEE00FF',
                borderRadius: 6,
              }}
            />
          )) ?? [],
      )}
    </View>
  );
}
