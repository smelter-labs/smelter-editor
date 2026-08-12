import { Doto, Press_Start_2P, Roboto_Mono } from 'next/font/google';

// Arcade typography for the /duck-hunter page, exposed as CSS variables the
// retro kit reads (pixelFont / ledFont / monoFont in retro-kit.tsx):
// Press Start 2P — headlines/labels (the font of the workshop-5 retro kit),
// Doto — LED dot-matrix numerals (timers, scores; also burned into the
// on-stream HUD server-side), Roboto Mono — body copy and footer tips.

export const pressStart = Press_Start_2P({
  weight: '400',
  subsets: ['latin'],
  variable: '--font-pixel',
  display: 'swap',
});

export const doto = Doto({
  subsets: ['latin'],
  variable: '--font-led',
  display: 'swap',
});

export const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  variable: '--font-retro-mono',
  display: 'swap',
});
