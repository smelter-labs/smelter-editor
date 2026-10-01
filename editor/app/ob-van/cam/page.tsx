'use client';

import { Suspense } from 'react';
import { CamPhone } from '@/components/ob-van/phone/cam-phone';
import { obDisplay, obMono } from '../fonts';

/**
 * /ob-van/cam?room=<roomId>&server=<api> — a phone becomes one of the
 * event's cameras: name + role → camera rig → GO LIVE (WHIP) → a
 * full-screen tally (ON AIR / PREVIEW / STANDBY).
 */
export default function ObCamPage() {
  return (
    <div className={`${obDisplay.variable} ${obMono.variable}`}>
      <Suspense>
        <CamPhone />
      </Suspense>
    </div>
  );
}
