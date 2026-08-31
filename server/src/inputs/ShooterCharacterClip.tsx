import React from 'react';
import {
  InputStream,
  Rescaler,
  Shader,
  Text,
  View,
  useInputStreams,
} from '@swmansion/smelter';
import {
  SHOOTER_CHARACTERS,
  type ShooterCharacterId,
} from '@smelter-editor/types';
import { characterClipInputId } from '../duckHunter/characterClips';
import { RetroPanel } from './RetroPanel';

const FONT = 'Doto';

const CHARACTER_BY_ID = new Map(SHOOTER_CHARACTERS.map((c) => [c.id, c]));

export function shooterCharacter(id: string | undefined | null) {
  return id ? CHARACTER_BY_ID.get(id as ShooterCharacterId) : undefined;
}

/**
 * A hunter's character-select clip, drawn from the looping mp4 input mounted by
 * duckHunter/characterClips. Returns null until the decoder actually delivers
 * frames — the engine only learns about the input a moment after the scene that
 * needs it appears, and rendering an InputStream for an unknown id is the one
 * thing the rest of this app never does (see LiveCamTile / the mp4 restart
 * fade). Callers draw their own fallback behind it, so nothing pops or jumps.
 *
 * Filling a square box crops the 16:9 clip to its center, which is how the
 * lineup shows hunters that never turned a camera on.
 */
export function CharacterClip({
  characterId,
  width,
  height,
}: {
  characterId: string | undefined | null;
  width: number;
  height: number;
}): React.ReactElement | null {
  const streams = useInputStreams();
  const character = shooterCharacter(characterId);
  if (!character) return null;
  const inputId = characterClipInputId(character.id);
  if (streams[inputId]?.videoState !== 'playing') return null;
  return (
    <Rescaler style={{ width, height, rescaleMode: 'fill' }}>
      {/* The clips have no audio track, so there is no volume to mute. */}
      <InputStream inputId={inputId} />
    </Rescaler>
  );
}

/**
 * Square hunter avatar for the lobby lineup: the player's live front camera
 * when their phone is publishing (mirrored, like the in-game badge), otherwise
 * their character clip cropped to the square, otherwise their solid crosshair
 * color. Framed with a retro panel rather than a View border — bordered Views
 * render broken on this engine build (see RetroPanel).
 */
export function HunterTile({
  camInputId,
  camLive,
  characterId,
  color,
  size,
  top,
  left,
}: {
  camInputId: string | undefined;
  camLive: boolean | undefined;
  characterId: string | undefined | null;
  color: string;
  size: number;
  top: number;
  left: number;
}) {
  const streams = useInputStreams();
  const camPlaying =
    camLive === true &&
    camInputId != null &&
    streams[camInputId]?.videoState === 'playing';
  // Video is inset so the panel's chamfered stroke stays visible around it —
  // filling the box edge to edge hides the frame the tile is built from.
  const inset = Math.max(3, Math.round(size * 0.035));
  const inner = size - inset * 2;
  return (
    <RetroPanel
      x={left}
      y={top}
      w={size}
      h={size}
      cut={Math.round(size * 0.1)}
      line={color}
      glow={0.35}
      glowPx={Math.round(size * 0.09)}
      fill={color}
      fillA={0.35}
      scanline={0.35}
      scanPx={Math.max(3, Math.round(size * 0.02))}>
      <View
        style={{
          top: inset,
          left: inset,
          width: inner,
          height: inner,
          overflow: 'hidden',
        }}>
        {camPlaying ? (
          <Shader
            shaderId='mirror-x'
            resolution={{ width: inner, height: inner }}>
            <Rescaler
              style={{ width: inner, height: inner, rescaleMode: 'fill' }}>
              <InputStream inputId={camInputId} />
            </Rescaler>
          </Shader>
        ) : (
          <CharacterClip
            characterId={characterId}
            width={inner}
            height={inner}
          />
        )}
      </View>
    </RetroPanel>
  );
}

/** Centered single-line label, the shape every scene here needs. */
export function HudLine({
  text,
  color,
  top,
  left,
  width,
  fontSize,
  weight = 'bold',
}: {
  text: string;
  color: string;
  top: number;
  left: number;
  width: number;
  fontSize: number;
  weight?: 'bold' | 'black';
}) {
  return (
    <View
      style={{
        top,
        left,
        width,
        height: Math.round(fontSize * 1.45),
        overflow: 'hidden',
      }}>
      <Text
        style={{
          fontSize,
          color,
          width,
          align: 'center',
          fontFamily: FONT,
          fontWeight: weight,
        }}>
        {text}
      </Text>
    </View>
  );
}
