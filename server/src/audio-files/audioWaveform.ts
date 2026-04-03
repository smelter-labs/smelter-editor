import path from 'node:path';

const AUDIO_WAVEFORM_SUFFIX = '.waveform.png';

export function getAudioWaveformPath(audioFilePath: string): string {
  const parsed = path.parse(audioFilePath);
  return path.join(parsed.dir, `${parsed.name}${AUDIO_WAVEFORM_SUFFIX}`);
}
