import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RoomEvent } from '@smelter-editor/types';
import { OB_PRESET_RULESETS, parseObRuleset } from '@smelter-editor/types';
import type { ObHudState } from '../../app/store';
import {
  NULL_BRAIN,
  NULL_ATTENTION,
  ObNullSignals,
  ObVanController,
  type ObControllerDeps,
} from '../ObVanController';
import { parseObCommand } from '../commands';
import type { ObPanelAiModule, ObPanelistInput } from '../llm/panelists';
import type { ObQuizTtsClip, ObQuizTtsModule } from '../llm/tts';

const ROOM = 'room-panel';
const T0 = 1_000_000;

class SpySignals extends ObNullSignals {
  quizTurns: (string | null)[] = [];
  setQuizTurn(camId: string | null): void {
    this.quizTurns.push(camId);
  }
}

function fakePanelAi(
  answer: (model: 'opus' | 'gpt') => string | null = (m) => `${m} hot take`,
): { ai: ObPanelAiModule; calls: { model: string; input: ObPanelistInput }[] } {
  const calls: { model: string; input: ObPanelistInput }[] = [];
  const mk = (id: 'opus' | 'gpt') => ({
    id,
    model: `${id}-test`,
    available: () => true,
    discuss: async (input: ObPanelistInput) => {
      calls.push({ model: id, input });
      const text = answer(id);
      return text === null ? null : { text };
    },
  });
  return {
    ai: {
      panelists: { opus: mk('opus'), gpt: mk('gpt') },
      voiceOf: (model) => `voice-${model}`,
    },
    calls,
  };
}

function fakeTts(durationMs = 1_200): {
  tts: ObQuizTtsModule;
  synths: { text: string; voiceId: string }[];
} {
  const synths: { text: string; voiceId: string }[] = [];
  const tts: ObQuizTtsModule = {
    hostVoice: 'voice-host',
    voiceOf: (model) => `voice-${model}`,
    async synth(text, voiceId): Promise<ObQuizTtsClip | null> {
      synths.push({ text, voiceId });
      return {
        file: `/tts/${synths.length}.mp4`,
        durationMs,
        mouth: { rateHz: 50, v: [0.3, 0.7] },
      };
    },
    warm() {},
    dispose: () => {},
  };
  return { tts, synths };
}

function harness(
  opts: {
    panelAi?: ObPanelAiModule;
    tts?: ObQuizTtsModule;
  } = {},
) {
  const events: RoomEvent[] = [];
  const hud: (ObHudState | null)[] = [];
  const connected = new Set<string>();
  const speechRegs: { file: string; offsetMs: number }[] = [];
  const mouthSets: { camInputId: string; mouth: unknown }[] = [];
  const captions: { inputId: string; text: string | null }[] = [];
  const signals = new SpySignals();

  const deps: ObControllerDeps = {
    broadcast: (e) => events.push(e),
    sendTo: () => {},
    removeInput: async (inputId) => {
      connected.delete(inputId);
    },
    layoutTiles: async () => {},
    runInputTransition: () => {},
    setInputVolume: () => {},
    isInputConnected: (inputId) => connected.has(inputId),
    isInputLive: (inputId) => connected.has(inputId),
    getResolution: () => ({ width: 1280, height: 720 }),
    publishHud: (s) => hud.push(s),
    registerJoinQr: async (url) => `ob-qr-${url.length}`,
    registerGameCam: async () => {
      throw new Error('not used');
    },
    getSideChannelDelayMs: () => 3000,
    getFileClock: () => null,
    registerReplayClip: async () => null,
    unregisterReplayClip: () => {},
    registerQuizSpeech: async (file, offsetMs) => {
      speechRegs.push({ file, offsetMs });
      return `ob-tts-${speechRegs.length}`;
    },
    unregisterQuizSpeech: () => {},
    setQuizSpeechMouth: (camInputId, mouth) =>
      mouthSets.push({ camInputId, mouth }),
    setCamCaption: (inputId, text) => captions.push({ inputId, text }),
    getPipelineTimeMs: () => 50_000,
  };

  const controller = new ObVanController(ROOM, deps, {
    createSignals: () => signals,
    createBrain: () => NULL_BRAIN,
    attention: NULL_ATTENTION,
    ...(opts.panelAi ? { createPanelAi: () => opts.panelAi! } : {}),
    ...(opts.tts ? { createQuizTts: () => opts.tts! } : {}),
  });

  const attach = (n: number, role: 'speaker' | 'guest', talent?: string) => {
    const inputId = `mp4-${n}`;
    connected.add(inputId);
    const r = controller.attachFileCam({
      role,
      inputId,
      fileName: `ob-demo/clip${n}.mp4`,
      width: 1920,
      height: 1080,
      talent: talent ?? null,
    });
    if (!r.ok) throw new Error(r.message);
    return r.camId;
  };

  return { controller, signals, speechRegs, mouthSets, captions, hud, attach };
}

/** Panel preset, live host + OPUS + GPT, on air, roster synced. */
async function onAirPanel(h: ReturnType<typeof harness>) {
  h.controller.setConfig({
    presetId: 'panel',
    audio: { mode: 'mix' },
    panel: { tts: true, auto: true },
  });
  const host = h.attach(1, 'speaker', 'Piotr');
  const opus = h.attach(2, 'guest', 'OPUS');
  const gpt = h.attach(3, 'guest', 'GPT');
  expect(h.controller.control('go_live').ok).toBe(true);
  await vi.advanceTimersByTimeAsync(150); // one tick: panelStep seats models
  return { host, opus, gpt };
}

/** Two raw segments + the quiet window that closes the turn. */
async function askByVoice(
  h: ReturnType<typeof harness>,
  text1 = 'What do you think',
  text2 = 'about AI television?',
) {
  const now = Date.now();
  h.controller.onRawTranscript('mp4-1', text1, now + 2_500, 800, 100);
  h.controller.onRawTranscript('mp4-1', text2, now + 4_000, 800, 1_000);
  await vi.advanceTimersByTimeAsync(1_700); // the 1.5 s quiet window closes
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('PANEL preset plumbing', () => {
  it('the preset ruleset parses clean, features everywhere, no solos', () => {
    const panel = OB_PRESET_RULESETS.panel;
    const parsed = parseObRuleset(panel, panel);
    expect(parsed.ruleset).not.toBeNull();
    expect(parsed.warnings).toEqual([]);
    const kinds = parsed.ruleset!.rules.map((r) => r.then.shot?.kind);
    expect(kinds).not.toContain('solo');
    const byId = Object.fromEntries(
      parsed.ruleset!.rules.map((r) => [r.id, r]),
    );
    expect(byId['panel-turn'].priority).toBeGreaterThanOrEqual(80);
    expect(byId['panel-turn'].then.shot).toMatchObject({
      kind: 'featured',
      main: 'trigger',
    });
    expect(byId['panel-host-rest'].then.shot).toMatchObject({
      kind: 'featured',
      main: 'speaker',
    });
  });

  it('parseObCommand round-trips panel_set and rejects an empty one', () => {
    expect(parseObCommand({ op: 'panel_set', auto: false, tts: true })).toEqual(
      { op: 'panel_set', auto: false, tts: true },
    );
    expect(parseObCommand({ op: 'panel_set' })).toBeNull();
  });
});

describe('ObVanController · AI panel', () => {
  it('seats the two models and exposes panel state on the preset only', async () => {
    const h = harness(fakePanelAi());
    await onAirPanel(h);
    const s = h.controller.stateSnapshot();
    expect(s.panel?.speakers.map((x) => x.model)).toEqual(['opus', 'gpt']);
    expect(s.panel?.phase).toBe('idle');
    h.controller.setConfig({ presetId: 'talk' });
    expect(h.controller.stateSnapshot().panel).toBeNull();
  });

  it('a closed host turn asks both models with the question and history', async () => {
    const { ai, calls } = fakePanelAi();
    const { tts } = fakeTts();
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    await askByVoice(h);
    expect(calls.map((c) => c.model).sort()).toEqual(['gpt', 'opus']);
    expect(calls[0].input.question).toBe(
      'What do you think about AI television?',
    );
    expect(calls[0].input.history).toEqual([]);
    const s = h.controller.stateSnapshot();
    expect(s.panel?.question).toBe('What do you think about AI television?');
  });

  it('answer clips queue in order, bracketed by the turn signal', async () => {
    const { ai } = fakePanelAi();
    const { tts, synths } = fakeTts(1_200);
    const h = harness({ panelAi: ai, tts });
    const { opus, gpt } = await onAirPanel(h);
    await askByVoice(h);
    // Both answers synthesised and both clips registered (serial queue).
    await vi.advanceTimersByTimeAsync(500);
    expect(synths.map((x) => x.text)).toEqual([
      'opus hot take',
      'gpt hot take',
    ]);
    expect(synths.map((x) => x.voiceId)).toEqual(['voice-opus', 'voice-gpt']);
    expect(h.speechRegs).toHaveLength(2);
    // Ride the clips out. The brackets overlap on purpose (GPT's turn rises
    // before OPUS's tail lands), so the tile flows OPUS → GPT → clear and
    // never flashes back to the host between answers.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(h.signals.quizTurns).toEqual([opus, gpt, null]);
    const s = h.controller.stateSnapshot();
    expect(s.panel?.phase).toBe('idle');
    // Puppet mouths were driven for both panelist cams.
    expect(h.mouthSets.some((m) => m.camInputId === 'mp4-2')).toBe(true);
    expect(h.mouthSets.some((m) => m.camInputId === 'mp4-3')).toBe(true);
  });

  it('the first clip respects the question air-end (notBeforeMs)', async () => {
    const { ai } = fakePanelAi();
    const { tts } = fakeTts();
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    const now = Date.now();
    // The question airs far in the future (long side-channel delay).
    h.controller.onRawTranscript(
      'mp4-1',
      'a very delayed one?',
      now + 20_000,
      1_000,
      100,
    );
    await vi.advanceTimersByTimeAsync(1_700);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.speechRegs).toHaveLength(2);
    // offset = pipelineTime + (voicedStart - now) - headPad; voicedStart is
    // pinned past the air-end (now+21s+lead), well beyond the 4 s headroom.
    const offset = h.speechRegs[0].offsetMs - 50_000; // minus pipeline time
    expect(offset).toBeGreaterThan(15_000);
  });

  it('a question asked mid-answer parks and fires after the turn', async () => {
    const { ai, calls } = fakePanelAi();
    const { tts } = fakeTts(1_200);
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(4_500); // OPUS is mid-clip
    const now = Date.now();
    h.controller.onRawTranscript('mp4-1', 'and one more thing?', now, 800, 50);
    await vi.advanceTimersByTimeAsync(1_700);
    expect(h.controller.stateSnapshot().panel?.pendingQuestion).toBe(
      'and one more thing?',
    );
    // After both clips end, the parked question goes out by itself.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls).toHaveLength(4);
    expect(calls.at(-1)?.input.question).toBe('and one more thing?');
    // The follow-up saw the first exchange as history.
    expect(calls.at(-1)?.input.history.map((e) => e.speaker)).toEqual([
      'host',
      'opus',
      'gpt',
    ]);
  });

  it('non-speaker inputs and other presets never feed the aggregator', async () => {
    const { ai, calls } = fakePanelAi();
    const { tts } = fakeTts();
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    const now = Date.now();
    h.controller.onRawTranscript('mp4-2', 'puppet echo?', now, 800, 10);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(0);
    h.controller.setConfig({ presetId: 'talk' });
    h.controller.onRawTranscript('mp4-1', 'is this thing on?', now, 800, 20);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls).toHaveLength(0);
  });

  it('without TTS the answers land desk-only and the turn closes at once', async () => {
    const { ai } = fakePanelAi();
    const h = harness({ panelAi: ai }); // no quizTts module at all
    await onAirPanel(h);
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(500);
    const s = h.controller.stateSnapshot();
    expect(s.panel?.phase).toBe('idle');
    expect(s.panel?.speakers.map((x) => x.lastText)).toEqual([
      'opus hot take',
      'gpt hot take',
    ]);
    expect(h.speechRegs).toHaveLength(0);
    expect(h.signals.quizTurns).toEqual([]);
  });

  it('offline panelists fall back to canned lines that still play', async () => {
    const { ai } = fakePanelAi(() => null);
    const { tts, synths } = fakeTts();
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(500);
    expect(h.speechRegs).toHaveLength(2);
    expect(synths.every((x) => x.text.length > 0)).toBe(true);
    const s = h.controller.stateSnapshot();
    expect(s.panel?.phase).toBe('answering');
  });

  it('panel_set toggles config; auto off ignores closed turns', async () => {
    const { ai, calls } = fakePanelAi();
    const { tts } = fakeTts();
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    expect(h.controller.operate({ op: 'panel_set', auto: false }).ok).toBe(
      true,
    );
    expect(h.controller.stateSnapshot().config.panel.auto).toBe(false);
    await askByVoice(h);
    expect(calls).toHaveLength(0);
    expect(h.controller.stateSnapshot().panel?.phase).toBe('idle');
  });

  it('leaving the preset mid-answer clears the turn and the queue', async () => {
    const { ai } = fakePanelAi();
    const { tts } = fakeTts(60_000); // a clip long enough to still be playing
    const h = harness({ panelAi: ai, tts });
    const { opus } = await onAirPanel(h);
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(6_000); // OPUS clip started
    expect(h.signals.quizTurns.at(-1)).toBe(opus);
    h.controller.setConfig({ presetId: 'talk' });
    expect(h.signals.quizTurns.at(-1)).toBeNull();
    expect(h.controller.stateSnapshot().panel).toBeNull();
    // Late brackets of the dead question are seq-guarded no-ops.
    const turnsAfter = h.signals.quizTurns.length;
    await vi.advanceTimersByTimeAsync(70_000);
    expect(h.signals.quizTurns.length).toBe(turnsAfter);
  });
});

describe('ObVanController · panel speech audio + captions', () => {
  it('mixes the TTS clip via hud.audio (panel preset — quiz hud stays null)', async () => {
    const { ai } = fakePanelAi();
    const { tts } = fakeTts(2_000);
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(6_000); // synth + register + slot
    expect(h.speechRegs.length).toBeGreaterThan(0);
    const withSpeech = h.hud.find((s) => s?.audio?.speech.length);
    expect(withSpeech?.audio?.speech[0]?.inputId).toBe('ob-tts-1');
    expect(withSpeech?.quiz).toBeNull();
    // Chained answers: the second clip registers (decode warm-up) while the
    // first still plays — BOTH keepers must be up, or the first voice dies.
    const both = h.hud.find((s) => (s?.audio?.speech.length ?? 0) >= 2);
    expect(both?.audio?.speech.map((c) => c.inputId)).toEqual([
      'ob-tts-1',
      'ob-tts-2',
    ]);
  });

  it('captions the spoken answer on the panelist tile, then clears it', async () => {
    const { ai } = fakePanelAi((m) =>
      m === 'opus'
        ? 'First point here. Second point that runs a little longer than one line.'
        : 'Short take.',
    );
    const { tts } = fakeTts(2_000);
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(20_000); // both lines play out fully
    const opusCaps = h.captions.filter((c) => c.inputId === 'mp4-2');
    expect(opusCaps.some((c) => c.text?.startsWith('First point here.'))).toBe(
      true,
    );
    expect(opusCaps[opusCaps.length - 1].text).toBeNull();
    const gptCaps = h.captions.filter((c) => c.inputId === 'mp4-3');
    expect(gptCaps.some((c) => c.text === 'Short take.')).toBe(true);
    expect(gptCaps[gptCaps.length - 1].text).toBeNull();
  });

  it('subtitles off keeps the panel captions off', async () => {
    const { ai } = fakePanelAi();
    const { tts } = fakeTts(1_200);
    const h = harness({ panelAi: ai, tts });
    await onAirPanel(h);
    h.controller.setConfig({ subtitles: false });
    await askByVoice(h);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(h.captions.length).toBe(0);
  });
});
