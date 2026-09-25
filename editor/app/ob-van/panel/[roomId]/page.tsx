'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { OperatorPanel } from '@/components/ob-van/panel/operator-panel';
import { obDisplay, obMono } from '../../fonts';

/**
 * OB Van operator panel (tablet / laptop): the vision mixer — preview and
 * program buses, TAKE / CUT, shots, transitions, effects, lower thirds, the
 * rundown and the auto pilot.
 */
export default function ObOperatorPanelPage() {
  const { roomId } = useParams();
  return (
    <div className={`${obDisplay.variable} ${obMono.variable}`}>
      <Suspense>
        <OperatorPanel roomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
