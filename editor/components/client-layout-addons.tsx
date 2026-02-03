'use client';

import dynamic from 'next/dynamic';

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

/**
 * Wraps browser-only layout addons (toast, analytics, voice UI).
 * All are loaded with ssr: false so their code never runs during prerender,
 * avoiding "window is not defined" when they or their deps access window at load time.
 */
export default function ClientLayoutAddons() {
  return (
    <>
      <SpeechToTextWithCommands />
      <ToastContainer />
      <Analytics />
    </>
  );
}
