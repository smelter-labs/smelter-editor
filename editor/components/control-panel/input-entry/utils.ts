import type { Input } from '@/lib/types';

export function hasEnabledShader(input: Input): boolean {
  if (!input.shaders) return false;
  return input.shaders.some((shader) => shader.enabled);
}

export function getSourceStateColor(input: Input): string {
  if (input.sourceState === 'live') return 'bg-green-500';
  if (input.sourceState === 'always-live') return 'bg-green-500';
  if (input.sourceState === 'offline') return 'bg-neutral-500';
  return 'bg-neutral-600';
}

export function getSourceStateLabel(input: Input): string {
  if (input.sourceState === 'live') return 'Live';
  if (input.sourceState === 'always-live') return 'Always Live';
  if (input.sourceState === 'offline') return 'Offline';
  return 'Unknown';
}
