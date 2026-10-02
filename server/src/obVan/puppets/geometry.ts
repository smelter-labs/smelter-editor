/**
 * Shared puppet sprite geometry, in the 900×1200 logical canvas every
 * character is drawn on. Mirrors the boxes in scripts/ob-puppet-assets.mjs —
 * the renderer places each layer's PNG at its box, scaled by one factor, so
 * the layers always line up regardless of tile size.
 */

export type PuppetBox = { x: number; y: number; w: number; h: number };

export const PUPPET_CANVAS = { w: 900, h: 1200 };

export const PUPPET_BODY_BOX: PuppetBox = { x: 40, y: 490, w: 820, h: 710 };
export const PUPPET_HEAD_BOX: PuppetBox = { x: 170, y: 130, w: 560, h: 860 };
export const PUPPET_EYES_BOX: PuppetBox = { x: 235, y: 355, w: 430, h: 180 };
export const PUPPET_BROWS_BOX: PuppetBox = { x: 290, y: 318, w: 320, h: 112 };
export const PUPPET_MOUTH_BOX: PuppetBox = { x: 330, y: 520, w: 240, h: 190 };

/** Logical desk plate (PNG is 1800×660 = 2×). */
export const PUPPET_DESK = { w: 900, h: 330 };

/** Glow sprite (800×800), centred on the face. */
export const PUPPET_GLOW = { w: 800, h: 800 };
