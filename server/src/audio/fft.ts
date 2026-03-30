import { AUDIO_BAND_COUNT } from '../types';

/**
 * Cooley-Tukey radix-2 FFT (in-place, iterative).
 * `real` and `imag` must have length that is a power of 2.
 */
function fftInPlace(real: Float64Array, imag: Float64Array): void {
  const n = real.length;

  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1;
    const angle = (-2 * Math.PI) / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1;
      let curImag = 0;
      for (let j = 0; j < halfLen; j++) {
        const tReal = curReal * real[i + j + halfLen] - curImag * imag[i + j + halfLen];
        const tImag = curReal * imag[i + j + halfLen] + curImag * real[i + j + halfLen];
        real[i + j + halfLen] = real[i + j] - tReal;
        imag[i + j + halfLen] = imag[i + j] - tImag;
        real[i + j] += tReal;
        imag[i + j] += tImag;
        const nextReal = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = nextReal;
      }
    }
  }
}

const hannWindow = new Float64Array(2048);
for (let i = 0; i < 2048; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / 2047));
}

/**
 * Log-spaced frequency band edges for 16 bands spanning 20 Hz to 20 kHz.
 * Each band covers approximately one octave.
 */
function buildBandEdges(
  bandCount: number,
  sampleRate: number,
  fftSize: number,
): { low: number; high: number }[] {
  const minFreq = 20;
  const maxFreq = Math.min(20000, sampleRate / 2);
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const edges: { low: number; high: number }[] = [];

  for (let i = 0; i < bandCount; i++) {
    const fLow = Math.exp(logMin + ((logMax - logMin) * i) / bandCount);
    const fHigh = Math.exp(logMin + ((logMax - logMin) * (i + 1)) / bandCount);
    const binLow = Math.max(1, Math.round((fLow * fftSize) / sampleRate));
    const binHigh = Math.min(
      fftSize / 2 - 1,
      Math.round((fHigh * fftSize) / sampleRate),
    );
    edges.push({ low: binLow, high: Math.max(binLow, binHigh) });
  }
  return edges;
}

const SAMPLE_RATE = 48000;
const FFT_SIZE = 2048;
const BAND_EDGES = buildBandEdges(AUDIO_BAND_COUNT, SAMPLE_RATE, FFT_SIZE);

/**
 * Compute 16 frequency bands from a 2048-sample PCM buffer.
 * Returns an array of AUDIO_BAND_COUNT floats in [0, 1].
 */
export function computeBands(pcm: Int16Array): number[] {
  const n = FFT_SIZE;
  const real = new Float64Array(n);
  const imag = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    real[i] = (pcm[i] / 32768) * hannWindow[i];
  }

  fftInPlace(real, imag);

  const magnitudes = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
  }

  const bands: number[] = new Array(AUDIO_BAND_COUNT);
  for (let b = 0; b < AUDIO_BAND_COUNT; b++) {
    const { low, high } = BAND_EDGES[b];
    let sum = 0;
    let count = 0;
    for (let i = low; i <= high; i++) {
      sum += magnitudes[i];
      count++;
    }
    const avg = count > 0 ? sum / count : 0;
    // Convert to dB-like scale and normalize to 0-1
    const db = 20 * Math.log10(avg + 1e-10);
    // Map roughly -60 dB to 0 dB → 0 to 1
    bands[b] = Math.max(0, Math.min(1, (db + 60) / 60));
  }

  return bands;
}

export { FFT_SIZE, SAMPLE_RATE };
