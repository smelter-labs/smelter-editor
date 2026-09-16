import type { Metadata } from 'next';
import { DuckHunterBanner } from '@/components/duck-hunter/banner';
import { doto, pressStart, robotoMono } from '../duck-hunter/fonts';

export const metadata: Metadata = {
  title: 'DUCK HUNTER · BANNER',
};

/**
 * /duck-hunter-banner — the standing placard for the TV next to the Duck
 * Hunter screen: rules, the signal chain and QR codes to smelter.dev and the
 * workshop. A sibling of /duck-hunter (not a child) on purpose: the arcade
 * lives in that route's layout and would mount under any sub-page.
 */
export default function DuckHunterBannerPage() {
  return (
    <div
      className={`${pressStart.variable} ${doto.variable} ${robotoMono.variable}`}>
      <DuckHunterBanner />
    </div>
  );
}
