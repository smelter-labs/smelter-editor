import { Big_Shoulders, IBM_Plex_Mono } from 'next/font/google';

// Blacktop typography (docs/design/blacktop/Blacktop Brandbook.dc.html),
// exposed as CSS variables the Blacktop kit reads (bbDisplay / bbMono in
// components/basketball-game/bb-kit.tsx). Own instances — the kettlebell
// pages keep their own fonts.ts, so neither app can change the other's
// weights by accident.
//
// Big Shoulders Display — wordmark, headlines and numerals (Black 900 for
// the wordmark / SCORE! / FINAL / final scores, ExtraBold 800 for names and
// live scores); the same faces are burned into the broadcast HUD server-side.
// IBM Plex Mono — clocks, tags, status and tracked meta lines.

// Google renamed the family: "Big Shoulders Display" is now "Big Shoulders".
export const bbDisplay = Big_Shoulders({
  weight: ['500', '700', '800', '900'],
  subsets: ['latin'],
  variable: '--font-bb-display',
  display: 'swap',
});

export const bbMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-bb-mono',
  display: 'swap',
});
