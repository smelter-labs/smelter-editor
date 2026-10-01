/**
 * OB Van LLM — rolling window of caption lines per camera number, the
 * analyst's ears. Lines live `windowMs` (60 s) on the air clock and the ring
 * never holds more than `maxLines` (200). `lastChangeAt` feeds the analyst's
 * situation hash: no new words → no new call.
 */

export type ObTranscriptLine = {
  camNumber: number;
  text: string;
  airMs: number;
};

export class ObTranscriptRing {
  readonly windowMs: number;
  readonly maxLines: number;
  private buf: ObTranscriptLine[] = [];
  private changedAt: number | null = null;

  constructor(opts: { windowMs?: number; maxLines?: number } = {}) {
    this.windowMs = opts.windowMs ?? 60_000;
    this.maxLines = opts.maxLines ?? 200;
  }

  /** Air time of the newest accepted line (null = nothing heard yet). */
  get lastChangeAt(): number | null {
    return this.changedAt;
  }

  push(camNumber: number, text: string, airMs: number): void {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (!clean || !Number.isFinite(airMs)) return;
    // Keep air order even if lines arrive slightly out of order.
    let i = this.buf.length;
    while (i > 0 && this.buf[i - 1].airMs > airMs) i--;
    this.buf.splice(i, 0, { camNumber, text: clean.slice(0, 500), airMs });
    if (this.buf.length > this.maxLines)
      this.buf.splice(0, this.buf.length - this.maxLines);
    this.changedAt = Math.max(this.changedAt ?? airMs, airMs);
  }

  /**
   * Lines of the last `windowMs` before `nowMs` (older ones are dropped).
   * Lines slightly in the future (captions arrive before their air time) are
   * kept — the analyst gets a head start on what is about to air.
   */
  lines(nowMs: number): ObTranscriptLine[] {
    const from = nowMs - this.windowMs;
    const firstKept = this.buf.findIndex((l) => l.airMs >= from);
    if (firstKept < 0) this.buf = [];
    else if (firstKept > 0) this.buf.splice(0, firstKept);
    return [...this.buf];
  }

  /** Lines of one camera inside the window. */
  linesFor(camNumber: number, nowMs: number): ObTranscriptLine[] {
    return this.lines(nowMs).filter((l) => l.camNumber === camNumber);
  }

  clear(): void {
    this.buf = [];
    this.changedAt = null;
  }
}
