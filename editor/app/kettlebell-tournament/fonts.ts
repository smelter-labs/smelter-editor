import { Big_Shoulders, IBM_Plex_Mono } from 'next/font/google';

// kb_design typography ("Smelter Overlays"), exposed as CSS variables the
// kbt kit reads (displayFont / kbtMonoFont in kbt-kit.tsx):
// Big Shoulders Display — condensed uppercase headlines and big numerals
// (the same family burned into the on-stream HUD server-side),
// IBM Plex Mono — wide-tracked uppercase labels, clocks and body copy.

// Google renamed the family: "Big Shoulders Display" is now "Big Shoulders"
// (next/font exports Big_Shoulders; the Display variant no longer exists).
export const bigShoulders = Big_Shoulders({
  weight: ['500', '700', '800'],
  subsets: ['latin'],
  variable: '--font-kbt-display',
  display: 'swap',
});

export const plexMono = IBM_Plex_Mono({
  weight: ['400', '500', '600'],
  subsets: ['latin'],
  variable: '--font-kbt-mono',
  display: 'swap',
});
