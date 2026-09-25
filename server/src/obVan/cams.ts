/**
 * OB Van camera roster: phones (WHIP, a seat that exists before the phone
 * publishes and survives a socket drop for a grace period), file cams (a
 * looping local mp4 with a role) and adopted room inputs. Every camera gets a
 * bus number 1..8 (lowest free) that the desk, the keyboard and the LLM use.
 * No timers, no deps — the controller drives it.
 */
import { randomUUID } from 'node:crypto';
import type {
  ObCam,
  ObCamKind,
  ObCamRole,
  ObTally,
} from '@smelter-editor/types';
import { OB_MAX_CAMS } from '@smelter-editor/types';

/** A phone whose socket has been gone this long loses its seat (and input). */
export const OB_CAM_GONE_MS = 90_000;

export type ObCamRecord = {
  id: string;
  number: number;
  /** Phone resume key (re-adopts the seat after a refresh / reconnect). */
  camKey: string;
  clientId: string | null;
  /** Phone socket attached (always true for file / adopted cams). */
  connected: boolean;
  disconnectedAt: number | null;
  inputId: string | null;
  role: ObCamRole;
  name: string;
  talent: string | null;
  kind: ObCamKind;
  /** Picture flowing (WHIP heartbeat / file input connected). */
  live: boolean;
  width: number | null;
  height: number | null;
  fileName: string | null;
  /** Bumped on every input (re)registration — a stale await drops its result. */
  gen: number;
  /** Side-channel delay registered for the input (ms). */
  delayMs: number;
  /** Wall time of the last worker sample for this camera. */
  lastSignalAt: number | null;
};

export type ObCamSeed = {
  kind: ObCamKind;
  role: ObCamRole;
  name: string;
  talent?: string | null;
  clientId?: string | null;
  camKey?: string;
  inputId?: string | null;
  width?: number | null;
  height?: number | null;
  fileName?: string | null;
  delayMs?: number;
};

const NAME_MAX = 24;
const TALENT_MAX = 40;

export function cleanName(raw: string, fallback: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) || fallback;
}

export function cleanTalent(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const t = raw.replace(/\s+/g, ' ').trim().slice(0, TALENT_MAX);
  return t || null;
}

export class ObCams {
  private readonly cams = new Map<string, ObCamRecord>();

  /** Cameras in bus order. */
  list(): ObCamRecord[] {
    return [...this.cams.values()].sort((a, b) => a.number - b.number);
  }

  get size(): number {
    return this.cams.size;
  }

  get(id: string): ObCamRecord | undefined {
    return this.cams.get(id);
  }

  byInput(inputId: string): ObCamRecord | undefined {
    for (const c of this.cams.values()) if (c.inputId === inputId) return c;
    return undefined;
  }

  byClient(clientId: string): ObCamRecord | undefined {
    for (const c of this.cams.values()) if (c.clientId === clientId) return c;
    return undefined;
  }

  byNumber(n: number): ObCamRecord | undefined {
    for (const c of this.cams.values()) if (c.number === n) return c;
    return undefined;
  }

  /** Lowest free bus number, or null when all OB_MAX_CAMS are taken. */
  lowestFreeNumber(): number | null {
    const taken = new Set([...this.cams.values()].map((c) => c.number));
    for (let n = 1; n <= OB_MAX_CAMS; n++) if (!taken.has(n)) return n;
    return null;
  }

  /** New camera on the lowest free number (null when the van is full). */
  create(seed: ObCamSeed): ObCamRecord | null {
    const number = this.lowestFreeNumber();
    if (number == null) return null;
    const cam: ObCamRecord = {
      id: `cam-${randomUUID().slice(0, 8)}`,
      number,
      camKey: seed.camKey ?? randomUUID(),
      clientId: seed.clientId ?? null,
      connected: seed.kind !== 'whip' || seed.clientId != null,
      disconnectedAt: null,
      inputId: seed.inputId ?? null,
      role: seed.role,
      name: cleanName(seed.name, `Cam ${number}`),
      talent: cleanTalent(seed.talent),
      kind: seed.kind,
      live: false,
      width: seed.width ?? null,
      height: seed.height ?? null,
      fileName: seed.fileName ?? null,
      gen: 0,
      delayMs: seed.delayMs ?? 0,
      lastSignalAt: null,
    };
    this.cams.set(cam.id, cam);
    return cam;
  }

  remove(id: string): ObCamRecord | undefined {
    const cam = this.cams.get(id);
    this.cams.delete(id);
    return cam;
  }

  clear(): void {
    this.cams.clear();
  }

  /**
   * A phone claims a seat: its camKey re-adopts its own seat; the same socket
   * keeps its seat; a DISCONNECTED phone seat with the same name is adopted
   * (swapped phone, lost key); otherwise a new seat. Null = the van is full.
   */
  join(
    clientId: string,
    msg: {
      name: string;
      role: ObCamRole;
      talent?: string | null;
      camKey?: string;
    },
    now: number,
  ): { cam: ObCamRecord; adopted: boolean } | null {
    const name = cleanName(msg.name, '');
    const phones = [...this.cams.values()].filter((c) => c.kind === 'whip');
    const match =
      (msg.camKey != null
        ? phones.find((c) => c.camKey === msg.camKey)
        : undefined) ??
      phones.find((c) => c.clientId === clientId) ??
      (name ? phones.find((c) => !c.connected && c.name === name) : undefined);
    if (match) {
      // A socket that already held another seat gives it up.
      const other = this.byClient(clientId);
      if (other && other !== match) this.detach(other, now);
      match.clientId = clientId;
      match.connected = true;
      match.disconnectedAt = null;
      if (name) match.name = name;
      match.role = msg.role;
      if (msg.talent !== undefined) match.talent = cleanTalent(msg.talent);
      return { cam: match, adopted: true };
    }
    const cam = this.create({
      kind: 'whip',
      role: msg.role,
      name,
      talent: msg.talent ?? null,
      clientId,
      camKey: msg.camKey,
    });
    return cam ? { cam, adopted: false } : null;
  }

  /** The phone's socket dropped: keep the seat for OB_CAM_GONE_MS. */
  detach(cam: ObCamRecord, now: number): void {
    cam.clientId = null;
    cam.connected = false;
    cam.disconnectedAt = now;
  }

  /** Phone seats whose socket has been gone for good (the caller removes them). */
  expired(now: number, goneMs = OB_CAM_GONE_MS): ObCamRecord[] {
    return [...this.cams.values()].filter(
      (c) =>
        c.kind === 'whip' &&
        !c.connected &&
        c.disconnectedAt != null &&
        now - c.disconnectedAt >= goneMs,
    );
  }
}

/** Public DTO of a camera (the `ob_state.cams` row). */
export function toPublicCam(
  cam: ObCamRecord,
  tally: ObTally,
  signals: boolean,
): ObCam {
  return {
    id: cam.id,
    number: cam.number,
    inputId: cam.inputId,
    role: cam.role,
    name: cam.name,
    talent: cam.talent,
    kind: cam.kind,
    connected: cam.connected,
    live: cam.live,
    tally,
    ...(cam.fileName ? { fileName: cam.fileName } : {}),
    ...(cam.width != null ? { width: cam.width } : {}),
    ...(cam.height != null ? { height: cam.height } : {}),
    delayMs: cam.delayMs,
    signals,
  };
}

/** Pretty role label for graphics (`speaker` → `SPEAKER`, `custom:Drums` → `DRUMS`). */
export function roleLabel(role: ObCamRole): string {
  const r = role.startsWith('custom:') ? role.slice(7) : role;
  return r.replace(/-/g, ' ').toUpperCase();
}
