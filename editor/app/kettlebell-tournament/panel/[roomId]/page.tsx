'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import { CommentatorPanel } from '@/components/kettlebell-tournament/panel/commentator-panel';
import { bigShoulders, plexMono } from '../../fonts';

/**
 * Desktop commentator/moderator panel: join by link from a computer, publish
 * webcam + mic and run the broadcast — program monitor, view switching and
 * the tournament flow on one page. The phone-sized camera-only variant lives
 * at /mobile/[roomId]/commentate.
 */
export default function CommentatorPanelPage() {
  const { roomId } = useParams();
  return (
    <div className={`${bigShoulders.variable} ${plexMono.variable}`}>
      <Suspense>
        <CommentatorPanel roomId={String(roomId)} />
      </Suspense>
    </div>
  );
}
