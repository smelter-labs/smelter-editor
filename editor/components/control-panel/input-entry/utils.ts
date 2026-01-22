import { Input } from '@/app/actions/actions';

export function hasEnabledShader(input: Input): boolean {
  if (!input.shaders) return false;
  return input.shaders.some((shader) => shader.enabled);
}

export function getSourceStateColor(input: Input): string {
  if (input.sourceState === 'live') return 'bg-green-500';
  if (input.sourceState === 'offline') return 'bg-neutral-500';
  return 'bg-neutral-600';
}

export function getSourceStateLabel(input: Input): string {
  if (input.sourceState === 'live') return 'Live';
  if (input.sourceState === 'offline') return 'Offline';
  return 'Unknown';
}

export function getShaderButtonClass(enabled: boolean): string {
  return (
    'ml-4 cursor-pointer transition-all duration-300 ' +
    (enabled
      ? 'bg-neutral-800 text-white hover:bg-neutral-700'
      : 'bg-neutral-700 text-neutral-300 hover:bg-neutral-600')
  );
}
