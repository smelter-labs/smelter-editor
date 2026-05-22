'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useVoiceCommandsEnabledSetting } from '@/lib/voice/macroSettings';

const SpeechToTextWithCommands = dynamic(
  () =>
    import('@/components/speech-to-text-with-commands').then((m) => ({
      default: m.SpeechToTextWithCommands,
    })),
  { ssr: false },
);

const SonnerToaster = dynamic(
  () => import('@/components/ui/sonner').then((m) => ({ default: m.Toaster })),
  { ssr: false },
);

const VoiceActionFeedback = dynamic(
  () =>
    import('@/components/voice-action-feedback/VoiceActionFeedback').then(
      (m) => ({ default: m.VoiceActionFeedback }),
    ),
  { ssr: false },
);

const TimelineEventFeedback = dynamic(
  () =>
    import('@/components/timeline-event-feedback/TimelineEventFeedback').then(
      (m) => ({ default: m.TimelineEventFeedback }),
    ),
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
 * Renders nothing until mounted so server HTML matches the client on hydration
 * (next/dynamic with ssr:false otherwise emits <script> vs <Suspense> on Next 15).
 * Dynamic imports use ssr:false so deps that touch window never run during prerender.
 */
export default function ClientLayoutAddons() {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isPreview = PREVIEW_PREFIXES.some((p) => pathname.startsWith(p));
  const [voiceCommandsEnabled] = useVoiceCommandsEnabledSetting();

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <>
      {!isPreview && voiceCommandsEnabled && <SpeechToTextWithCommands />}
      {!isPreview && <VoiceActionFeedback />}
      {!isPreview && <TimelineEventFeedback />}
      <SonnerToaster />
      <Analytics />
    </>
  );
}
