import fs from 'node:fs/promises';
import path from 'node:path';
import {
  SHOOTER_CHARACTERS,
  type ShooterCharacterId,
} from '@smelter-editor/types';
import { DATA_DIR } from '../dataDir';
import { SmelterInstance } from '../smelter';

/**
 * The looping "character select" clips (data/mp4s/duck-hunter-characters, seeded
 * at boot by seedDuckHunterAssets) mounted as real Smelter inputs so the
 * broadcast scenes can draw them — the hunter lineup in the lobby/countdown and
 * the TOP 3 podium on GAME OVER.
 *
 * They are *global* inputs, not per-output `<Mp4>` components: a room that is
 * being recorded mounts the `<App>` tree twice, and an output-specific input
 * would decode the same file once per output. A global input also lands in
 * `useInputStreams()`, which is what lets the scenes wait for
 * `videoState === 'playing'` instead of rendering an input the engine does not
 * know yet (the same guard LiveCamTile uses for player cameras).
 *
 * Mounting is on demand — refcounted per room, so two rooms never unregister
 * each other's clips, and two players on the same character share one decoder.
 * On demand also means the clip always starts at its first frame when a scene
 * appears, instead of dropping in at a random point of the loop.
 */

const CLIPS_DIR = path.join(DATA_DIR, 'mp4s', 'duck-hunter-characters');

const KNOWN_IDS = new Set<string>(SHOOTER_CHARACTERS.map((c) => c.id));

/** Engine input id carrying one character's clip. */
export function characterClipInputId(id: ShooterCharacterId): string {
  return `dh-char-${id}`;
}

function clipPath(id: ShooterCharacterId): string {
  return path.join(CLIPS_DIR, `${id}.mp4`);
}

/** owner (roomId) -> characters that owner currently wants on air. */
const owners = new Map<string, Set<ShooterCharacterId>>();
/** Characters actually registered with the engine. */
const mounted = new Set<ShooterCharacterId>();
/** Serializes register/unregister so a fast lobby→start→end flip can't race. */
let queue: Promise<void> = Promise.resolve();

function desiredNow(): Set<ShooterCharacterId> {
  const all = new Set<ShooterCharacterId>();
  for (const ids of owners.values()) for (const id of ids) all.add(id);
  return all;
}

async function mount(id: ShooterCharacterId): Promise<void> {
  const filePath = clipPath(id);
  try {
    await fs.access(filePath);
  } catch {
    // Asset never seeded (or deleted): the scenes fall back to the player's
    // solid color, so this is not worth failing a match over.
    console.warn(`[duck-hunter] character clip missing, skipping: ${filePath}`);
    return;
  }
  await SmelterInstance.registerInput(characterClipInputId(id), {
    type: 'mp4',
    filePath,
    loop: true,
  });
  mounted.add(id);
}

async function unmount(id: ShooterCharacterId): Promise<void> {
  await SmelterInstance.unregisterInput(characterClipInputId(id));
  mounted.delete(id);
}

/** Apply the union of every owner's wish list to the engine. */
function reconcile(): Promise<void> {
  queue = queue
    .then(async () => {
      const desired = desiredNow();
      for (const id of [...mounted]) {
        if (!desired.has(id)) await unmount(id);
      }
      for (const id of desired) {
        if (!mounted.has(id)) await mount(id);
      }
    })
    .catch((err) => {
      console.error('[duck-hunter] character clip reconcile failed', err);
    });
  return queue;
}

/**
 * Declare which character clips this room needs on air right now. Idempotent —
 * repeating the same set is a no-op, so callers may drive it from a hot loop.
 */
export function acquireCharacterClips(
  owner: string,
  ids: readonly ShooterCharacterId[],
): Promise<void> {
  const next = new Set(ids.filter((id) => KNOWN_IDS.has(id)));
  const prev = owners.get(owner);
  if (
    prev &&
    prev.size === next.size &&
    [...next].every((id) => prev.has(id))
  ) {
    return queue;
  }
  if (next.size === 0) owners.delete(owner);
  else owners.set(owner, next);
  return reconcile();
}

/** Drop this room's claim; clips no room wants anymore are unregistered. */
export function releaseCharacterClips(owner: string): Promise<void> {
  if (!owners.delete(owner)) return queue;
  return reconcile();
}

/** Test seam: forget all claims without touching the engine. */
export function __resetCharacterClipsForTest(): void {
  owners.clear();
  mounted.clear();
  queue = Promise.resolve();
}
