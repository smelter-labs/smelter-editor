/**
 * Live Smelter puppets: illustrated talent rendered by the compositor itself
 * (no Remotion, no pre-rendered video). The cam's mp4 carries only the voice;
 * the picture is painted live from layered `ob-puppet-*` engine images and a
 * precomputed mouth-amplitude track, so the lips follow the audio exactly.
 */

export const PUPPET_CHARACTER_IDS = [
  'host',
  'nova',
  'bit',
  'prof',
  'lux',
] as const;

export type PuppetCharacterId = (typeof PUPPET_CHARACTER_IDS)[number];

export function isPuppetCharacterId(v: string): v is PuppetCharacterId {
  return (PUPPET_CHARACTER_IDS as readonly string[]).includes(v);
}

/** Mouth amplitude 0..1 sampled at `rateHz` over the clip, from its audio. */
export type PuppetMouthTrack = { rateHz: number; v: number[] };

/**
 * The clip→air clock: media 0 of the looping mp4 is audible at `zeroAirMs`
 * wall time (side-channel delay included), so the puppet animates what the
 * viewer hears right now.
 */
export type PuppetClock = { zeroAirMs: number; durationMs: number | null };

export type PuppetCastMember = {
  character: PuppetCharacterId;
  /** Display name — equals the cam talent, so quiz player fx can match it. */
  name: string;
  mouth: PuppetMouthTrack | null;
};

export type ObPuppetConfig = {
  /** `studio` renders the whole set (every cast member at a desk). */
  character: PuppetCharacterId | 'studio';
  name: string;
  mouth: PuppetMouthTrack | null;
  /**
   * Live clock of the carrier mp4; null while it is (re)starting — the
   * renderer then idles with a resting mouth. A closure into RoomState so
   * restarts and loops never need a store round-trip.
   */
  getClock: () => PuppetClock | null;
  /** The studio's seated cast (solo puppets ignore it). */
  cast?: PuppetCastMember[];
};

/** What an attach caller provides — RoomState adds the live clock. */
export type ObPuppetSeed = Omit<ObPuppetConfig, 'getClock'>;
