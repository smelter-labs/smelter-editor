import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { StoreApi } from 'zustand';
import { SmelterInstance, type SmelterOutput } from '../smelter';
import { computeBands, FFT_SIZE, SAMPLE_RATE } from './fft';
import type { AudioStoreState } from './audioStore';

const BYTES_PER_SAMPLE = 2; // 16-bit PCM
const CHUNK_BYTES = FFT_SIZE * BYTES_PER_SAMPLE;
const MAX_RESTART_ATTEMPTS = 3;

/**
 * Single-pipeline audio analyser that runs FFT on the room's program mix.
 * One instance per room — no per-input tracking.
 */
export class AudioManager {
  private static nextPort = 24000;
  private static readonly PORT_STRIDE = 2;

  private readonly audioStore: StoreApi<AudioStoreState>;
  private readonly roomId: string;
  private readonly output: SmelterOutput;

  private outputId: string;
  private port: number;
  private ffmpegProcess: ChildProcess | null = null;
  private pcmBuffer: Buffer = Buffer.alloc(CHUNK_BYTES * 4);
  private pcmOffset = 0;
  private restartAttempts = 0;
  private pcmChunkCount = 0;
  private running = false;

  constructor(
    roomId: string,
    audioStore: StoreApi<AudioStoreState>,
    output: SmelterOutput,
  ) {
    this.roomId = roomId;
    this.audioStore = audioStore;
    this.output = output;
    this.port = AudioManager.nextPort;
    AudioManager.nextPort += AudioManager.PORT_STRIDE;
    this.outputId = `audio::room::${roomId}`;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this._startPipeline();
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    await this._teardown();
    this.audioStore.getState().clearBands();
  }

  private async _startPipeline(): Promise<void> {
    console.log(
      `[audio] Starting room mix pipeline roomId=${this.roomId} outputId=${this.outputId} port=${this.port}`,
    );

    this._spawnFfmpeg();
    await this._waitForFfmpegReady();

    try {
      await SmelterInstance.registerRoomAudioOutput(
        this.outputId,
        this.output,
        this.port,
      );
      console.log(`[audio] registerRoomAudioOutput OK for room ${this.roomId}`);
    } catch (err) {
      console.error(
        `[audio] Failed to register room audio output for ${this.roomId}`,
        err,
      );
      this._killFfmpeg();
      this.running = false;
      throw err;
    }
  }

  private _spawnFfmpeg(): void {
    const sdp = [
      'v=0',
      `o=- 0 0 IN IP4 127.0.0.1`,
      's=AudioAnalysis',
      `c=IN IP4 127.0.0.1`,
      't=0 0',
      `m=audio ${this.port} RTP/AVP 111`,
      'a=rtpmap:111 opus/48000/2',
    ].join('\r\n') + '\r\n';

    console.log(`[audio] ffmpeg SDP for room ${this.roomId}: port=${this.port}`);

    const child = spawn(
      'ffmpeg',
      [
        '-fflags', 'nobuffer',
        '-flags', 'low_delay',
        '-protocol_whitelist', 'pipe,rtp,udp',
        '-f', 'sdp',
        '-i', 'pipe:0',
        '-ac', '1',
        '-ar', String(SAMPLE_RATE),
        '-f', 's16le',
        '-acodec', 'pcm_s16le',
        '-flush_packets', '1',
        'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );

    this.ffmpegProcess = child;

    child.stdin!.write(sdp);
    child.stdin!.end();

    child.stdout!.on('data', (chunk: Buffer) => {
      this._onPcmData(chunk);
    });

    child.on('exit', (code) => {
      console.log(
        `[audio] ffmpeg for room ${this.roomId} exited with code ${code}`,
      );
      if (!this.running) return;

      this.ffmpegProcess = null;
      if (this.restartAttempts < MAX_RESTART_ATTEMPTS) {
        const delay = Math.min(
          1000 * Math.pow(2, this.restartAttempts),
          8000,
        );
        this.restartAttempts++;
        console.log(
          `[audio] Restarting ffmpeg for room ${this.roomId} in ${delay}ms (attempt ${this.restartAttempts})`,
        );
        setTimeout(() => {
          if (this.running) {
            this._spawnFfmpeg();
          }
        }, delay);
      }
    });
  }

  private _waitForFfmpegReady(): Promise<void> {
    return new Promise<void>((resolve) => {
      const child = this.ffmpegProcess;
      if (!child || !child.stderr) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        console.log(`[audio] ffmpeg ready timeout for room ${this.roomId}, proceeding`);
        resolve();
      }, 3000);

      let resolved = false;

      const stderrRl = createInterface({ input: child.stderr! });
      stderrRl.on('line', (line) => {
        console.log(`[audio][ffmpeg-stderr][room:${this.roomId}] ${line}`);
        if (!resolved && /^(SDP:|Input #|Stream mapping)/i.test(line)) {
          resolved = true;
          clearTimeout(timeout);
          setTimeout(resolve, 200);
        }
      });

      child.on('exit', () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve();
        }
      });
    });
  }

  private _onPcmData(chunk: Buffer): void {
    let offset = 0;
    while (offset < chunk.length) {
      const remaining = CHUNK_BYTES - this.pcmOffset;
      const toCopy = Math.min(remaining, chunk.length - offset);
      chunk.copy(this.pcmBuffer, this.pcmOffset, offset, offset + toCopy);
      this.pcmOffset += toCopy;
      offset += toCopy;

      if (this.pcmOffset >= CHUNK_BYTES) {
        const pcm = new Int16Array(
          this.pcmBuffer.buffer,
          this.pcmBuffer.byteOffset,
          FFT_SIZE,
        );
        const bands = computeBands(pcm);
        this.audioStore.getState().setBands(bands);

        this.pcmChunkCount++;
        if (this.pcmChunkCount <= 3 || this.pcmChunkCount % 50 === 0) {
          const maxBand = Math.max(...bands);
          const avgBand = bands.reduce((a, b) => a + b, 0) / bands.length;
          console.log(
            `[audio][pcm] room=${this.roomId} chunk#${this.pcmChunkCount} maxBand=${maxBand.toFixed(3)} avgBand=${avgBand.toFixed(3)}`,
          );
        }

        this.pcmOffset = 0;
        this.restartAttempts = 0;
      }
    }
  }

  private _killFfmpeg(): void {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill('SIGTERM');
      this.ffmpegProcess = null;
    }
  }

  private async _teardown(): Promise<void> {
    this._killFfmpeg();
    try {
      await SmelterInstance.unregisterRoomAudioOutput(this.outputId);
    } catch (err) {
      console.error(
        `[audio] Failed to unregister room audio output ${this.outputId}`,
        err,
      );
    }
  }
}
