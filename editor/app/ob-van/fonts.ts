import { Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google';

// OB Van typography, exposed as the CSS variables the OB kit reads (obDisplay
// / obMono in components/ob-van/ob-kit.tsx). Own instances — the other
// games keep their own fonts.ts, so no app can change another's weights.
//
// Barlow Condensed — labels, keys, camera numbers (a broadcast-desk face).
// IBM Plex Mono — time, signals, status and the WHY log.

export const obDisplay = Barlow_Condensed({
  weight: ['500', '600', '700', '800'],
  subsets: ['latin'],
  variable: '--font-ob-display',
  display: 'swap',
});

export const obMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-ob-mono',
  display: 'swap',
});
