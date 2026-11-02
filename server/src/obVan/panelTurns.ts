/**
 * OB Van — host turn aggregation for the AI PANEL.
 *
 * The Whisper sidecar has no "utterance finished" event: it emits one
 * transcript per VAD segment (a 200 ms pause splits a sentence), segments
 * can arrive out of order (parallel transcriptions), and each one is final.
 * This joins the host's raw segments into one turn and closes it after
 * `OB_PANEL_TURN_CLOSE_MS` of raw-clock quiet. Pure — the controller polls
 * it from its tick.
 */
import {
  OB_PANEL_MIN_QUESTION_CHARS,
  OB_PANEL_TURN_CLOSE_MS,
} from '@smelter-editor/types';

export type ObTurnSegment = {
  text: string;
  /** Segment-start pts (ms, pipeline clock) — the sort key. */
  ts: number;
  /** When the segment starts airing on program (wall clock). */
  airAtMs: number;
  durationMs: number;
  /** When the segment reached Node (wall clock) — the quiet timer. */
  wallMs: number;
};

export type ObClosedTurn = {
  text: string;
  /** When the last word of the turn airs on program (wall clock). */
  airEndMs: number;
};

export class ObTurnAggregator {
  private segments: ObTurnSegment[] = [];
  private lastPushWallMs = 0;

  push(seg: ObTurnSegment): void {
    const text = seg.text.trim();
    if (!text) return;
    let i = this.segments.length;
    while (i > 0 && this.segments[i - 1].ts > seg.ts) i--;
    this.segments.splice(i, 0, { ...seg, text });
    this.lastPushWallMs = Math.max(this.lastPushWallMs, seg.wallMs);
  }

  /**
   * Close and return the turn once the host has been quiet long enough.
   * Too-short turns (Whisper hallucinates single words on silence) are
   * swallowed — the buffer clears either way.
   */
  poll(nowWallMs: number): ObClosedTurn | null {
    if (this.segments.length === 0) return null;
    if (nowWallMs - this.lastPushWallMs < OB_PANEL_TURN_CLOSE_MS) return null;
    const text = this.segments
      .map((s) => s.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    const airEndMs = Math.max(
      ...this.segments.map((s) => s.airAtMs + s.durationMs),
    );
    this.segments = [];
    if (text.length < OB_PANEL_MIN_QUESTION_CHARS) return null;
    if (!text.includes(' ')) return null;
    return { text, airEndMs };
  }

  reset(): void {
    this.segments = [];
    this.lastPushWallMs = 0;
  }
}
