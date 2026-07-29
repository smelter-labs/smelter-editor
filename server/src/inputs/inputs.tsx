import type { InputConfig, PersonBoxes, ShooterOverlay } from '../app/store';
import { StoreContext } from '../app/store';
import {
  Text,
  View,
  InputStream,
  Image,
  Rescaler,
  Shader,
  useInputStreams,
} from '@swmansion/smelter';

import React, { useContext } from 'react';
import { useStore } from 'zustand';
import { getInputRenderer } from './rendererRegistry';
import { wrapWithShaders } from '../utils/shaderUtils';
import { ScrollingText } from './scrollingText';
import { TransitionShaderWrapper } from './transitionWrapper';
import { HandsInput } from './HandsInput';
import { PacmanBirdsInput } from './PacmanBirdsInput';
import { HaunterGhostsInput } from './HaunterGhostsInput';
import { GhostCityWrapper } from './GhostCityWrapper';
import { CarAdsInput, CarAdDebugBoxes } from './CarAdsInput';
import { CarHueWrapper } from './CarHueWrapper';
import { SmoothedBoxes } from './SmoothedBoxes';

type Resolution = { width: number; height: number };

const DEFAULT_LONG_EDGE = 1920;

function deriveInputResolution(
  sourceWidth?: number,
  sourceHeight?: number,
): Resolution {
  if (sourceWidth && sourceHeight && sourceWidth > 0 && sourceHeight > 0) {
    const maxDim = Math.max(sourceWidth, sourceHeight);
    const scale = DEFAULT_LONG_EDGE / maxDim;
    return {
      width: Math.round(sourceWidth * scale),
      height: Math.round(sourceHeight * scale),
    };
  }
  return { width: 1920, height: 1080 };
}

function normalizeBorderWidth(borderWidth: number | undefined): number {
  if (borderWidth === undefined || Number.isNaN(borderWidth)) {
    return 0;
  }
  return Math.max(0, Math.round(borderWidth));
}

function useFrozenImageHandoff(
  inputId: string,
  frozenImageId: string | undefined,
  restartFading: boolean | undefined,
) {
  const streams = useInputStreams();
  const liveStreamState = streams[inputId]?.videoState ?? 'finished';
  const [hiddenForRestart, setHiddenForRestart] = React.useState(false);
  const [displayFrozenImage, setDisplayFrozenImage] = React.useState(
    () => !!frozenImageId,
  );

  React.useEffect(() => {
    setDisplayFrozenImage(!!frozenImageId);
  }, [frozenImageId]);

  React.useEffect(() => {
    if (restartFading) {
      setHiddenForRestart(true);
    }
  }, [restartFading]);

  React.useEffect(() => {
    if (
      displayFrozenImage &&
      hiddenForRestart &&
      !restartFading &&
      liveStreamState === 'playing'
    ) {
      setDisplayFrozenImage(false);
    }
  }, [displayFrozenImage, hiddenForRestart, restartFading, liveStreamState]);

  React.useEffect(() => {
    if (hiddenForRestart && !restartFading && liveStreamState === 'playing') {
      setHiddenForRestart(false);
    }
  }, [hiddenForRestart, restartFading, liveStreamState]);

  React.useEffect(() => {
    if (!hiddenForRestart) return;
    const timeout = setTimeout(() => setHiddenForRestart(false), 5000);
    return () => clearTimeout(timeout);
  }, [hiddenForRestart]);

  return {
    hiddenForRestart,
    liveStreamState,
    showFrozenImage: !!frozenImageId && displayFrozenImage,
  };
}

export function Input({ input }: { input: InputConfig }) {
  const { hiddenForRestart, liveStreamState, showFrozenImage } =
    useFrozenImageHandoff(
      input.inputId,
      input.frozenImageId,
      input.restartFading,
    );
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const isGame = !!input.snakeGameState;
  const isHands = !!input.handsSourceInputId && !!input.handsStore;
  const streamState =
    showFrozenImage || isImage || isTextInput || isGame || isHands
      ? 'playing'
      : liveStreamState;
  const resolution = deriveInputResolution(
    input.sourceWidth,
    input.sourceHeight,
  );
  const borderWidth = normalizeBorderWidth(input.borderWidth ?? 0);
  const borderColor = input.borderColor ?? '#ff0000';
  const contentWidth = Math.max(1, resolution.width - borderWidth * 2);
  const contentHeight = Math.max(1, resolution.height - borderWidth * 2);

  // Live caption for this input when transcription is enabled. Empty string
  // string when there's nothing to show. Set by RoomState.applyTranscript.
  const store = useContext(StoreContext);
  const transcript = useStore(
    store,
    (state) => state.transcripts[input.inputId] ?? '',
  );
  const peopleCount = useStore(
    store,
    (state) => state.peopleCounts[input.inputId],
  );
  const peopleBoxes = useStore(
    store,
    (state) => state.peopleBoxes[input.inputId],
  );
  // Ghost City: detected building regions to haunt with the eerie shader.
  const buildingBoxes = useStore(
    store,
    (state) => state.buildingBoxes[input.inputId],
  );
  // Car Ads: tracked vehicles + wheel-derived side quads for the ad overlay.
  const carAdBoxes = useStore(
    store,
    (state) => state.carAdBoxes[input.inputId],
  );
  // Car Hue: tracked top-down vehicles for the per-car hue recolor shader.
  const carHueBoxes = useStore(
    store,
    (state) => state.carHueBoxes[input.inputId],
  );
  // Ghost Shooter overlay, only when this input is the game's target.
  const shooter = useStore(store, (state) =>
    state.shooter?.targetInputId === input.inputId ? state.shooter : null,
  );

  // The video/content element for the playing state. Extracted so Ghost City
  // can wrap it in the haunted-city shader without disturbing the overlays
  // (subtitle, boxes, count badge, shooter HUD) that sit beside it.
  // The base Rescalers carry explicit sizes (not just the parent View's) so
  // they stay valid when a shader wrapper (Ghost City / Car Hue) adopts them —
  // a Rescaler child of a Shader must have a known size.
  let videoContent: React.ReactElement = showFrozenImage ? (
    <Rescaler
      style={{
        width: contentWidth,
        height: contentHeight,
        rescaleMode: 'fill',
      }}>
      <Image imageId={input.frozenImageId!} />
    </Rescaler>
  ) : isGame && getInputRenderer('game') ? (
    getInputRenderer('game')!(input, {
      width: contentWidth,
      height: contentHeight,
    })
  ) : isImage ? (
    <Rescaler
      style={{
        width: contentWidth,
        height: contentHeight,
        rescaleMode: 'fit',
      }}>
      <Image imageId={input.imageId!} />
    </Rescaler>
  ) : isTextInput ? (
    <ScrollingText
      text={input.text!}
      maxLines={input.textMaxLines ?? 10}
      scrollEnabled={input.textScrollEnabled ?? true}
      scrollSpeed={input.textScrollSpeed ?? 80}
      scrollLoop={input.textScrollLoop ?? true}
      fontSize={input.textFontSize ?? 80}
      color={input.textColor ?? 'white'}
      align={input.textAlign ?? 'left'}
      containerWidth={contentWidth}
      containerHeight={contentHeight}
      scrollNudge={input.textScrollNudge}
    />
  ) : isHands ? (
    <HandsInput
      sourceInputId={input.handsSourceInputId!}
      handsStore={input.handsStore!}
      resolution={{ width: contentWidth, height: contentHeight }}
      volume={input.volume}
    />
  ) : peopleBoxes?.ghost &&
    // Haunters stay mounted with zero boxes so idle ghosts keep waiting.
    (peopleBoxes.boxes.length || peopleBoxes.sprite === 'haunter') ? (
    peopleBoxes.sprite === 'bird' ? (
      <PacmanBirdsInput
        sourceInputId={input.inputId}
        data={peopleBoxes}
        resolution={{ width: contentWidth, height: contentHeight }}
        volume={input.volume}
        ducks={shooter?.ducks}
      />
    ) : (
      // People ghost mode is always the haunting ghosts (Haunter panel style).
      <HaunterGhostsInput
        sourceInputId={input.inputId}
        data={peopleBoxes}
        resolution={{ width: contentWidth, height: contentHeight }}
        volume={input.volume}
      />
    )
  ) : carAdBoxes?.ads && carAdBoxes.cars.length ? (
    <CarAdsInput
      sourceInputId={input.inputId}
      data={carAdBoxes}
      resolution={{ width: contentWidth, height: contentHeight }}
      volume={input.volume}
    />
  ) : (
    <Rescaler
      style={{
        width: contentWidth,
        height: contentHeight,
        rescaleMode: 'fill',
      }}>
      <InputStream inputId={input.inputId} volume={input.volume} />
    </Rescaler>
  );

  // Ghost City: haunt the detected building regions. Wraps whatever the base
  // content is (raw stream or already ghost-swapped people), so it composes
  // with ghost mode as an independent toggle.
  if (buildingBoxes?.boxes.length) {
    videoContent = (
      <GhostCityWrapper
        data={buildingBoxes}
        resolution={{ width: contentWidth, height: contentHeight }}>
        {videoContent}
      </GhostCityWrapper>
    );
  }

  // Car Hue: recolor detected top-down cars. Wraps the base content like Ghost
  // City, so it composes with the other overlay modes.
  if (carHueBoxes?.effect && carHueBoxes.boxes.length) {
    videoContent = (
      <CarHueWrapper
        data={carHueBoxes}
        resolution={{ width: contentWidth, height: contentHeight }}>
        {videoContent}
      </CarHueWrapper>
    );
  }

  const inputComponent = (
    <Rescaler style={resolution}>
      <View style={{ ...resolution, direction: 'column' }}>
        {streamState === 'playing' ? (
          <View
            style={{
              width: contentWidth,
              height: contentHeight,
              borderWidth,
              borderColor,
              backgroundColor: isTextInput ? '#1a1a2e' : undefined,
            }}>
            {videoContent}
            {transcript ? (
              <Subtitle
                text={transcript}
                parent={{ width: contentWidth, height: contentHeight }}
              />
            ) : null}
            {peopleBoxes?.boxes.length && !peopleBoxes.ghost ? (
              <PeopleBoxes
                data={peopleBoxes}
                parent={{ width: contentWidth, height: contentHeight }}
              />
            ) : null}
            {carAdBoxes?.cars.length && !carAdBoxes.ads ? (
              <CarAdDebugBoxes
                data={carAdBoxes}
                parent={{ width: contentWidth, height: contentHeight }}
              />
            ) : null}
            {carHueBoxes?.boxes.length && !carHueBoxes.effect ? (
              // Dead-reckoned boxes: top-down cars move fast relative to the
              // ~5 responses/s, so raw boxes would jump and trail the cars.
              <SmoothedBoxes
                data={carHueBoxes}
                parent={{ width: contentWidth, height: contentHeight }}
              />
            ) : null}
            {peopleCount != null && peopleBoxes?.sprite !== 'bird' ? (
              <PeopleCountBadge
                count={peopleCount}
                parent={{ width: contentWidth, height: contentHeight }}
              />
            ) : null}
            {shooter ? (
              <ShooterHud
                shooter={shooter}
                parent={{ width: contentWidth, height: contentHeight }}
                frameW={peopleBoxes?.frameW}
                frameH={peopleBoxes?.frameH}
              />
            ) : null}
          </View>
        ) : streamState === 'ready' ? (
          <View style={{ padding: 300 }}>
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Image imageId='spinner' />
            </Rescaler>
          </View>
        ) : streamState === 'finished' ? (
          <View style={{ padding: 300 }}>
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Text style={{ fontSize: 600, fontFamily: 'Star Jedi' }}> </Text>
            </Rescaler>
          </View>
        ) : (
          <View />
        )}
        {input.showTitle !== false && (
          <View
            style={{
              backgroundColor: '#493880',
              height: 90,
              padding: 20,
              borderRadius: 0,
              direction: 'column',
              overflow: 'visible',
              bottom: 0,
              left: 0,
            }}>
            <Text
              style={{ fontSize: 40, color: 'white', fontFamily: 'Star Jedi' }}>
              {input?.title}
            </Text>
            <View style={{ height: 10 }} />

            <Text
              style={{ fontSize: 25, color: 'white', fontFamily: 'Star Jedi' }}>
              {input?.description}
            </Text>
          </View>
        )}
      </View>
    </Rescaler>
  );

  const activeShaders = input.shaders.filter((shader) => shader.enabled);

  let mainRendered = wrapWithShaders(inputComponent, activeShaders, resolution);

  if (input.activeTransition) {
    mainRendered = (
      <TransitionShaderWrapper
        transition={input.activeTransition}
        resolution={resolution}>
        {mainRendered}
      </TransitionShaderWrapper>
    );
  }

  if ((hiddenForRestart || input.restartFading) && !showFrozenImage) {
    mainRendered = (
      <Shader
        shaderId='opacity'
        resolution={resolution}
        shaderParam={{
          type: 'struct',
          value: [{ type: 'f32', fieldName: 'opacity', value: 0 }],
        }}>
        {mainRendered}
      </Shader>
    );
  }

  if (input.attachedInputs && input.attachedInputs.length > 0) {
    return (
      <View style={{ ...resolution, direction: 'column', overflow: 'visible' }}>
        {input.attachedInputs.map((attached) => (
          <Rescaler
            key={attached.inputId}
            style={{ ...resolution, top: 0, left: 0 }}>
            <Input input={attached} />
          </Rescaler>
        ))}
        <Rescaler style={{ ...resolution, top: 0, left: 0 }}>
          {mainRendered}
        </Rescaler>
      </View>
    );
  }

  return mainRendered;
}

// Live caption overlay, sized relative to the input's own content box so it
// scales with the tile wherever the layout places it. Pinned to the bottom with
// a semi-transparent background; numbers tuned to read at small grid-cell sizes.
function Subtitle({
  text,
  parent,
}: {
  text: string;
  parent: { width: number; height: number };
}) {
  const margin = Math.round(parent.width * 0.04);
  const width = parent.width - 2 * margin;
  const height = Math.round(parent.height * 0.12);
  return (
    <View
      style={{
        backgroundColor: '#000000CC',
        borderRadius: 16,
        paddingHorizontal: 32,
        left: margin,
        bottom: margin,
        width,
        height,
        overflow: 'hidden',
        direction: 'column',
      }}>
      <View />
      <Text
        style={{
          width: width - 64,
          fontSize: 48,
          lineHeight: 60,
          color: '#FFFFFFFF',
          align: 'center',
          wrap: 'word',
        }}>
        {text}
      </Text>
      <View />
    </View>
  );
}

function PeopleCountBadge({
  count,
  parent,
}: {
  count: number;
  parent: { width: number; height: number };
}) {
  const margin = Math.round(parent.width * 0.02);
  const fontSize = Math.max(18, Math.round(parent.height * 0.035));
  const padH = Math.round(fontSize * 0.45);
  const padV = Math.round(fontSize * 0.22);
  const label = `👥 ${count}`;
  // Smelter Views don't auto-size to content, so give the badge explicit
  // dimensions hugging the text (rough estimate; emoji ~1.6 char widths).
  const width = padH * 2 + Math.round(fontSize * 0.62 * (label.length + 1));
  const height = padV * 2 + Math.round(fontSize * 1.25);
  return (
    <View
      style={{
        top: margin,
        left: margin,
        width,
        height,
        backgroundColor: '#000000CC',
        borderRadius: Math.round(fontSize * 0.3),
        paddingHorizontal: padH,
        paddingVertical: padV,
        overflow: 'hidden',
      }}>
      <Text style={{ fontSize, color: '#FFFFFFFF' }}>{label}</Text>
    </View>
  );
}

function PeopleBoxes({
  data,
  parent,
}: {
  data: PersonBoxes;
  parent: { width: number; height: number };
}) {
  const { boxes, frameW, frameH } = data;
  // The video is rendered with rescaleMode 'fill' (cover): the source frame is
  // scaled to cover the tile and the overflow is cropped + centered. Map the
  // normalized boxes through the exact same transform so they line up.
  const scale = Math.max(parent.width / frameW, parent.height / frameH);
  const dispW = frameW * scale;
  const dispH = frameH * scale;
  const offX = (parent.width - dispW) / 2;
  const offY = (parent.height - dispH) / 2;
  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: parent.width,
        height: parent.height,
        overflow: 'hidden',
      }}>
      {boxes.flatMap((box, i) => {
        const top = Math.round(offY + box.y * dispH);
        const left = Math.round(offX + box.x * dispW);
        const width = Math.max(2, Math.round(box.w * dispW));
        const height = Math.max(2, Math.round(box.h * dispH));
        // Detection confidence, shown as a 0.00–1.00 label above the box.
        const conf = box.conf != null ? box.conf.toFixed(2) : null;
        // Flat siblings, NOT a nested wrapper View: nesting the outline inside a
        // sized layout View makes Smelter swallow the border, so only the filled
        // label showed. Keeping the outline a direct child of the overlay — the
        // shape the old code used — renders it again.
        const els = [
          <View
            key={`box-${i}`}
            style={{
              top,
              left,
              width,
              height,
              borderWidth: 4,
              borderColor: '#00FF66FF',
              borderRadius: 4,
            }}
          />,
        ];
        if (conf != null) {
          els.push(
            <BoxConfLabel
              key={`conf-${i}`}
              text={conf}
              boxTop={top}
              boxLeft={left}
              parent={parent}
            />,
          );
        }
        return els;
      })}
    </View>
  );
}

/**
 * Confidence badge for one detection, pinned just ABOVE the box's top-left
 * corner (outside the outline, so it never covers the subject). Smelter Views
 * don't auto-size to content, so the badge gets explicit dimensions hugging the
 * text (same trick as PeopleCountBadge).
 */
function BoxConfLabel({
  text,
  boxTop,
  boxLeft,
  parent,
}: {
  text: string;
  boxTop: number;
  boxLeft: number;
  parent: { width: number; height: number };
}) {
  const fontSize = Math.max(12, Math.round(parent.height * 0.022));
  const padH = Math.round(fontSize * 0.35);
  const padV = Math.round(fontSize * 0.15);
  const width = padH * 2 + Math.round(fontSize * 0.6 * text.length);
  const height = padV * 2 + Math.round(fontSize * 1.2);
  // Sit just above the box. If it would run off the top edge, tuck it just
  // inside the top line instead so the number stays on screen.
  const gap = 2;
  const top = boxTop - height - gap >= 0 ? boxTop - height - gap : boxTop + gap;
  return (
    <View
      style={{
        top,
        left: boxLeft,
        width,
        height,
        backgroundColor: '#00FF66CC',
        borderRadius: Math.round(fontSize * 0.25),
        paddingHorizontal: padH,
        paddingVertical: padV,
        overflow: 'hidden',
      }}>
      <Text style={{ fontSize, color: '#000000FF' }}>{text}</Text>
    </View>
  );
}

// Duck Hunt dog sprite geometry + pop-up timing (must cover DOG_REVEAL_MS from
// the controller so a reveal never lingers as a static image after it's pruned).
const DOG_ASPECT = 40 / 68; // dog-catch.png is 68×40
const DOG_RISE_MS = 220; // spring up from below the bottom edge
const DOG_DROP_MS = 320; // drop back down at the end
const DOG_MS = 6000; // total on-screen time, matches DOG_REVEAL_MS
const DOG_DIM = 0.4; // peak darkening of the rest of the frame while the dog is up

// Hue [0,1] of a hex color, for driving the hsl-adjust colorize shader.
function hexToHue(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let hue: number;
  if (max === r) hue = ((g - b) / d) % 6;
  else if (max === g) hue = (b - r) / d + 2;
  else hue = (r - g) / d + 4;
  hue /= 6;
  return hue < 0 ? hue + 1 : hue;
}

// Ghost Shooter HUD: player crosshairs, hit bursts, and the scoreboard. Aim
// coords are in normalized content space [0,1] (same as the ghost boxes) and
// mapped to tile pixels through the identical rescale 'fill' (cover) transform.
function ShooterHud({
  shooter,
  parent,
  frameW,
  frameH,
}: {
  shooter: ShooterOverlay;
  parent: { width: number; height: number };
  frameW?: number;
  frameH?: number;
}) {
  const fw = frameW && frameW > 0 ? frameW : parent.width;
  const fh = frameH && frameH > 0 ? frameH : parent.height;
  const scale = Math.max(parent.width / fw, parent.height / fh);
  const dispW = fw * scale;
  const dispH = fh * scale;
  const offX = (parent.width - dispW) / 2;
  const offY = (parent.height - dispH) / 2;
  const toPx = (x: number, y: number) => ({
    px: offX + x * dispW,
    py: offY + y * dispH,
  });

  const chSize = Math.max(28, Math.round(parent.width * 0.05));
  const th = Math.max(2, Math.round(chSize * 0.06));
  const now = Date.now();

  return (
    <View
      style={{
        top: 0,
        left: 0,
        width: parent.width,
        height: parent.height,
        overflow: 'hidden',
      }}>
      {/* Shot bursts: expanding ring for a hit, red ✕ for a miss. */}
      {shooter.bursts.map((b) => {
        const { px, py } = toPx(b.x, b.y);
        const t = Math.min(1, Math.max(0, (now - b.at) / 600));
        const alpha = Math.round(255 * (1 - t))
          .toString(16)
          .padStart(2, '0');
        if (b.kind === 'miss') {
          const fs = Math.round(chSize * (1.0 + 0.5 * t));
          const box = Math.round(fs * 1.6);
          return (
            <View
              key={`burst-${b.id}`}
              style={{
                top: Math.round(py - box / 2),
                left: Math.round(px - box / 2),
                width: box,
                height: box,
                overflow: 'visible',
              }}>
              <Text style={{ fontSize: fs, color: `#FF3B3B${alpha}` }}>✕</Text>
            </View>
          );
        }
        const size = Math.round(chSize * (0.6 + 1.8 * t));
        return (
          <View
            key={`burst-${b.id}`}
            style={{
              top: Math.round(py - size / 2),
              left: Math.round(px - size / 2),
              width: size,
              height: size,
              borderRadius: size / 2,
              borderWidth: Math.max(2, Math.round(chSize * 0.12)),
              borderColor: `#FFEE00${alpha}`,
            }}
          />
        );
      })}

      {/* Screen dim behind the dog: while any reveal is on screen, briefly
          darken the rest of the frame so the pop-up stands out. Follows the same
          rise → hold → drop envelope as the dog(s), taking the strongest across
          concurrent reveals. */}
      {(() => {
        const presence = shooter.dogReveals.reduce((m, d) => {
          const e = now - d.at;
          let p = 1;
          if (e < DOG_RISE_MS) p = e / DOG_RISE_MS;
          else if (e > DOG_MS - DOG_DROP_MS)
            p = Math.max(0, (DOG_MS - e) / DOG_DROP_MS);
          return Math.max(m, p);
        }, 0);
        if (presence <= 0) return null;
        const dimA = Math.round(presence * DOG_DIM * 255)
          .toString(16)
          .padStart(2, '0');
        return (
          <View
            style={{
              top: 0,
              left: 0,
              width: parent.width,
              height: parent.height,
              backgroundColor: `#000000${dimA}`,
            }}
          />
        );
      })()}

      {/* Duck Hunt dog: springs up from the bottom holding two ducks, tinted to
          the scoring player's color, then drops back down. Below the crosshairs
          so aiming stays legible. */}
      {shooter.dogReveals.map((d) => {
        const dogW = Math.round(parent.width * 0.28);
        const dogH = Math.round(dogW * DOG_ASPECT);
        const restTop = parent.height - dogH; // sits on the bottom edge
        const cx = toPx(d.x, 0).px;
        const left = Math.round(
          Math.max(0, Math.min(parent.width - dogW, cx - dogW / 2)),
        );
        const e = now - d.at;
        let top = restTop;
        if (e < DOG_RISE_MS) {
          const t = e / DOG_RISE_MS;
          top = restTop + dogH * (1 - t) * (1 - t); // ease-out rise
        } else if (e > DOG_MS - DOG_DROP_MS) {
          const t = (e - (DOG_MS - DOG_DROP_MS)) / DOG_DROP_MS;
          top = restTop + dogH * t * t; // accelerating drop
        }
        return (
          <View
            key={`dog-${d.id}`}
            style={{ top: Math.round(top), left, width: dogW, height: dogH }}>
            <Shader
              shaderId='hsl-adjust'
              resolution={{ width: dogW, height: dogH }}
              shaderParam={{
                type: 'struct',
                value: [
                  { type: 'f32', fieldName: 'hue_shift', value: 0 },
                  { type: 'f32', fieldName: 'saturation', value: 0 },
                  { type: 'f32', fieldName: 'lightness', value: 0 },
                  { type: 'f32', fieldName: 'colorize_enable', value: 1 },
                  {
                    type: 'f32',
                    fieldName: 'colorize_hue',
                    value: hexToHue(d.color),
                  },
                  { type: 'f32', fieldName: 'colorize_saturation', value: 0.6 },
                  { type: 'f32', fieldName: 'mix_amount', value: 1 },
                ],
              }}>
              <Rescaler
                style={{ width: dogW, height: dogH, rescaleMode: 'fit' }}>
                <Image imageId='dog-catch' />
              </Rescaler>
            </Shader>
          </View>
        );
      })}

      {/* Player crosshairs. */}
      {shooter.crosshairs.map((c) => {
        const { px, py } = toPx(c.x, c.y);
        return (
          <View
            key={`ch-${c.clientId}`}
            style={{
              top: Math.round(py - chSize / 2),
              left: Math.round(px - chSize / 2),
              width: chSize,
              height: chSize,
              overflow: 'visible',
            }}>
            <View
              style={{
                top: Math.round(chSize / 2 - th / 2),
                left: 0,
                width: chSize,
                height: th,
                backgroundColor: c.color,
              }}
            />
            <View
              style={{
                top: 0,
                left: Math.round(chSize / 2 - th / 2),
                width: th,
                height: chSize,
                backgroundColor: c.color,
              }}
            />
            <View
              style={{
                top: 0,
                left: 0,
                width: chSize,
                height: chSize,
                borderWidth: 6,
                borderColor: c.color,
                borderRadius: chSize / 2,
              }}
            />
            <PlayerBadge
              player={c}
              px={px}
              py={py}
              chSize={chSize}
              parent={parent}
              now={now}
            />
          </View>
        );
      })}

      {/* Scoreboard, top-right. */}
      {shooter.scores.length > 0 ? (
        <ShooterScoreboard scores={shooter.scores} parent={parent} now={now} />
      ) : null}
    </View>
  );
}

// HUD accents shared by the badge and the scoreboard.
const AMMO_FULL = '#FFDE59';
const AMMO_EMPTY = '#FFFFFF3C';
const HUD_BG = '#000000B8';

function clamp01Hud(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function ammoPipGap(pipSize: number): number {
  return Math.max(2, Math.round(pipSize * 0.5));
}

function ammoPipsWidth(pipSize: number, maxAmmo: number): number {
  return maxAmmo * pipSize + (maxAmmo - 1) * ammoPipGap(pipSize);
}

function ammoBarHeight(pipSize: number): number {
  return Math.max(2, Math.round(pipSize * 0.3));
}

function ammoBlockHeight(pipSize: number): number {
  return (
    pipSize + Math.max(2, Math.round(pipSize * 0.4)) + ammoBarHeight(pipSize)
  );
}

/**
 * Ammo readout for one player: filled pips = rounds left, plus a thin bar that
 * fills while the next round regenerates (empty when the magazine is full, so
 * the height never changes and the layout doesn't jump).
 */
function AmmoPips({
  top,
  left,
  pipSize,
  player,
  now,
}: {
  top: number;
  left: number;
  pipSize: number;
  player: {
    ammo: number;
    maxAmmo: number;
    reloadMs: number;
    reloadEndsAt: number | null;
  };
  now: number;
}) {
  const gap = ammoPipGap(pipSize);
  const width = ammoPipsWidth(pipSize, player.maxAmmo);
  const barH = ammoBarHeight(pipSize);
  const barTop = pipSize + Math.max(2, Math.round(pipSize * 0.4));
  const progress =
    player.reloadEndsAt == null
      ? 0
      : clamp01Hud(1 - (player.reloadEndsAt - now) / player.reloadMs);
  return (
    <View
      style={{
        top,
        left,
        width,
        height: ammoBlockHeight(pipSize),
        overflow: 'visible',
      }}>
      {Array.from({ length: player.maxAmmo }).map((_, i) => (
        <View
          key={`pip-${i}`}
          style={{
            top: 0,
            left: i * (pipSize + gap),
            width: pipSize,
            height: pipSize,
            borderRadius: pipSize / 2,
            backgroundColor: i < player.ammo ? AMMO_FULL : AMMO_EMPTY,
          }}
        />
      ))}
      {player.reloadEndsAt != null ? (
        <>
          <View
            style={{
              top: barTop,
              left: 0,
              width,
              height: barH,
              borderRadius: barH / 2,
              backgroundColor: '#FFFFFF26',
            }}
          />
          <View
            style={{
              top: barTop,
              left: 0,
              width: Math.max(1, Math.round(width * progress)),
              height: barH,
              borderRadius: barH / 2,
              backgroundColor: AMMO_FULL,
            }}
          />
        </>
      ) : null}
    </View>
  );
}

/**
 * Circular live-camera avatar. Shows the player's front camera (a WHIP input,
 * mirrored like a selfie) once the stream is actually playing; until then — or
 * when the camera is off — it falls back to the player's solid color so the
 * layout never jumps. Space is reserved by the caller as soon as the camera is
 * toggled on (camInputId set), independent of when the first frame arrives.
 */
function LiveCamCircle({
  inputId,
  size,
  fallbackColor,
  top,
  left,
}: {
  inputId: string | undefined;
  size: number;
  fallbackColor: string;
  top: number;
  left: number;
}) {
  const streams = useInputStreams();
  const playing = inputId != null && streams[inputId]?.videoState === 'playing';
  return (
    <View
      style={{
        top,
        left,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: playing ? undefined : fallbackColor,
        overflow: 'hidden',
      }}>
      {playing ? (
        <Shader shaderId='mirror-x' resolution={{ width: size, height: size }}>
          <Rescaler style={{ width: size, height: size, rescaleMode: 'fill' }}>
            <InputStream inputId={inputId} />
          </Rescaler>
        </Shader>
      ) : null}
    </View>
  );
}

/**
 * Name badge above a crosshair: rounded dark pill with the player's live camera
 * avatar (when the phone shares one), name and live ammo state. Positioned in
 * crosshair-local coords (the container sits at the crosshair's top-left), but
 * clamped against the tile so it never slides off screen; flips below the
 * crosshair near the top edge.
 */
function PlayerBadge({
  player,
  px,
  py,
  chSize,
  parent,
  now,
}: {
  player: ShooterOverlay['crosshairs'][number];
  px: number;
  py: number;
  chSize: number;
  parent: { width: number; height: number };
  now: number;
}) {
  const fs = Math.max(16, Math.round(chSize * 0.34));
  const hasAvatar = !!player.camInputId;
  const av = Math.round(fs * 2.0);
  const padH = Math.round(fs * 0.45);
  const padV = Math.round(fs * 0.3);
  const gap = Math.round(fs * 0.35);
  const nameH = Math.round(fs * 1.25);
  const pipSize = Math.max(5, Math.round(fs * 0.32));
  const pipRowGap = Math.round(fs * 0.18);
  const textColH = nameH + pipRowGap + ammoBlockHeight(pipSize);
  const contentH = Math.max(hasAvatar ? av : 0, textColH);
  // Smelter Views don't auto-size to content, so estimate the name width.
  const nameW =
    Math.round(fs * 0.56 * player.name.length) + Math.round(fs * 0.3);
  const innerW = Math.max(nameW, ammoPipsWidth(pipSize, player.maxAmmo));
  const badgeW = padH * 2 + (hasAvatar ? av + gap : 0) + innerW;
  const badgeH = padV * 2 + contentH;

  // Clamp within the tile; prefer above the crosshair, flip below near the top.
  const edge = Math.round(parent.width * 0.008);
  const absLeft = Math.round(
    Math.max(edge, Math.min(parent.width - badgeW - edge, px - badgeW / 2)),
  );
  let absTop = Math.round(py - chSize * 0.9 - badgeH);
  if (absTop < edge) absTop = Math.round(py + chSize * 0.9);

  const textLeft = padH + (hasAvatar ? av + gap : 0);
  const textTop = Math.round((badgeH - textColH) / 2);
  return (
    <View
      style={{
        top: absTop - Math.round(py - chSize / 2),
        left: absLeft - Math.round(px - chSize / 2),
        width: badgeW,
        height: badgeH,
        backgroundColor: HUD_BG,
        borderRadius: Math.round(fs * 0.45),
        borderWidth: 3,
        borderColor: player.color,
        overflow: 'visible',
      }}>
      {hasAvatar ? (
        <LiveCamCircle
          inputId={player.camInputId}
          size={av}
          fallbackColor={player.color}
          top={Math.round((badgeH - av) / 2)}
          left={padH}
        />
      ) : null}
      <View
        style={{
          top: textTop,
          left: textLeft,
          width: innerW,
          height: nameH,
          overflow: 'hidden',
        }}>
        <Text style={{ fontSize: fs, color: player.color }}>{player.name}</Text>
      </View>
      <AmmoPips
        top={textTop + nameH + pipRowGap}
        left={textLeft}
        pipSize={pipSize}
        player={player}
        now={now}
      />
    </View>
  );
}

const RANK_MEDALS = ['🥇', '🥈', '🥉'];

/**
 * Scoreboard, top-right: ranked rows with the player's camera avatar, name,
 * ammo pips + reload countdown, and the score right-aligned.
 */
function ShooterScoreboard({
  scores,
  parent,
  now,
}: {
  scores: ShooterOverlay['scores'];
  parent: { width: number; height: number };
  now: number;
}) {
  const margin = Math.round(parent.width * 0.02);
  const fs = Math.max(18, Math.round(parent.height * 0.03));
  const padH = Math.round(fs * 0.6);
  const padV = Math.round(fs * 0.5);
  const av = Math.round(fs * 1.9);
  const rowH = Math.round(av * 1.2);
  const rowGap = Math.round(fs * 0.4);
  const rankW = Math.round(fs * 1.5);
  const gap = Math.round(fs * 0.4);
  const scoreW = Math.round(fs * 2.4);
  const width = Math.round(parent.width * 0.24);
  const height = padV * 2 + scores.length * rowH + (scores.length - 1) * rowGap;
  const pipSize = Math.max(5, Math.round(fs * 0.3));
  const nameLeft = padH + rankW + av + gap;
  const nameW = width - nameLeft - scoreW - padH - gap;
  return (
    <View
      style={{
        top: margin,
        left: parent.width - width - margin,
        width,
        height,
        backgroundColor: HUD_BG,
        borderRadius: Math.round(fs * 0.5),
        overflow: 'hidden',
      }}>
      {scores.map((s, i) => {
        const rowTop = padV + i * (rowH + rowGap);
        const reloadLeftS =
          s.reloadEndsAt == null
            ? null
            : Math.max(0, s.reloadEndsAt - now) / 1000;
        return (
          <View
            key={`row-${s.clientId}`}
            style={{
              top: rowTop,
              left: 0,
              width,
              height: rowH,
              overflow: 'visible',
            }}>
            <View
              style={{
                top: Math.round((rowH - fs * 1.2) / 2),
                left: padH,
                width: rankW,
                height: Math.round(fs * 1.3),
                overflow: 'visible',
              }}>
              <Text style={{ fontSize: fs, color: '#FFFFFFCC' }}>
                {RANK_MEDALS[i] ?? `${i + 1}`}
              </Text>
            </View>
            <LiveCamCircle
              inputId={s.camInputId}
              size={av}
              fallbackColor={s.color}
              top={Math.round((rowH - av) / 2)}
              left={padH + rankW}
            />
            <View
              style={{
                top: 0,
                left: nameLeft,
                width: Math.max(fs, nameW),
                height: Math.round(fs * 1.3),
                overflow: 'hidden',
              }}>
              <Text style={{ fontSize: fs, color: s.color }}>{s.name}</Text>
            </View>
            <AmmoPips
              top={Math.round(fs * 1.45)}
              left={nameLeft}
              pipSize={pipSize}
              player={s}
              now={now}
            />
            {reloadLeftS != null ? (
              <View
                style={{
                  top: Math.round(fs * 1.45),
                  left: nameLeft + ammoPipsWidth(pipSize, s.maxAmmo) + gap,
                  width: Math.round(fs * 2.6),
                  height: Math.round(fs * 0.9),
                  overflow: 'hidden',
                }}>
                <Text
                  style={{
                    fontSize: Math.round(fs * 0.62),
                    color: '#FFFFFF88',
                  }}>
                  {`+1 in ${reloadLeftS.toFixed(1)}s`}
                </Text>
              </View>
            ) : null}
            <View
              style={{
                top: Math.round((rowH - fs * 1.5) / 2),
                left: width - padH - scoreW,
                width: scoreW,
                height: Math.round(fs * 1.6),
                overflow: 'hidden',
              }}>
              <Text
                style={{
                  fontSize: Math.round(fs * 1.3),
                  color: '#FFFFFF',
                  align: 'right',
                  width: scoreW,
                }}>
                {`${s.score}`}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
