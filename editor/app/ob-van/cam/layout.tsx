import type { Viewport } from 'next';

// The phone camera page. viewport-fit=cover makes the env(safe-area-inset-*)
// paddings real on notched phones; no pinch zoom on a tally screen.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#0A0C10',
};

export default function ObCamLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
