import { Suspense } from 'react';
import type { Metadata } from 'next';
import { ObVanArcadeHost } from '@/components/ob-van/arcade-host';
import { obDisplay, obMono } from '../fonts';

export const metadata: Metadata = {
  title: 'OB VAN · AI DIRECTOR',
};

/**
 * The OB Van host: title → setup (event, preset, cameras, rules) → on air
 * (program monitor, camera strip, WHY log, LLM) → wrap. No dashboard chrome.
 *
 * The arcade lives in this LAYOUT, not in the pages (the Duck Hunter fix):
 * after NEW EVENT creates the room the arcade rewrites its URL from /ob-van
 * to /ob-van/[roomId] with `history.replaceState`; the next server action
 * re-syncs the router tree and swaps the page segment, which would remount
 * an arcade living in a page. A layout survives that swap. The `(arcade)`
 * route group keeps /ob-van/panel/* and /ob-van/cam out of this layout.
 */
export default function ObVanArcadeLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${obDisplay.variable} ${obMono.variable}`}>
      <Suspense>
        <ObVanArcadeHost />
      </Suspense>
      {children}
    </div>
  );
}
