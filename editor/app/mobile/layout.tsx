import type { Viewport } from 'next';

// The /mobile pages are phone game controllers. viewport-fit=cover makes the
// env(safe-area-inset-*) paddings (PhoneShell, play HUD) real on notched
// phones, and disabling pinch/double-tap zoom stops iOS from fighting rapid
// FIRE taps.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
