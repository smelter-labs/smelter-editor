import { Suspense } from 'react';
import type { Metadata } from 'next';
import { DuckHunterArcade } from '@/components/duck-hunter/arcade';
import { doto, pressStart, robotoMono } from './fonts';

export const metadata: Metadata = {
  title: 'DUCK HUNTER',
};

/**
 * The standalone Duck Hunter arcade: title screen → character select (the
 * pre-rendered workshop-5 clips) → mode + config → phone lobby → live game
 * on the Smelter output → results. No dashboard chrome — just the game.
 */
export default function DuckHunterPage() {
  return (
    <div
      className={`${pressStart.variable} ${doto.variable} ${robotoMono.variable}`}>
      <Suspense>
        <DuckHunterArcade />
      </Suspense>
    </div>
  );
}
