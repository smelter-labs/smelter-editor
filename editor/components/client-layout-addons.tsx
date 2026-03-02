'use client';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

const SpeechToTextWithCommands = dynamic(
  () =>
    import('@/components/speech-to-text-with-commands').then((m) => ({
      default: m.SpeechToTextWithCommands,
    })),
  { ssr: false },
);

const ToastContainer = dynamic(
  () => import('react-toastify').then((m) => ({ default: m.ToastContainer })),
  { ssr: false },
);

const Analytics = dynamic(
  () =>
    import('@vercel/analytics/next').then((m) => ({ default: m.Analytics })),
  { ssr: false },
);

const PREVIEW_PREFIXES = ['/raw-preview', '/room-preview'];

/**
 * Wraps browser-only layout addons (toast, analytics, voice UI).
 * All are loaded with ssr: false so their code never runs during prerender,
 * avoiding "window is not defined" when they or their deps access window at load time.
 */
export default function ClientLayoutAddons() {
  const pathname = usePathname();
  const isPreview = PREVIEW_PREFIXES.some((p) => pathname.startsWith(p));

  return (
    <>
      {!isPreview && <SpeechToTextWithCommands />}
      <ToastContainer />
      <Analytics />
    </>
  );
}
