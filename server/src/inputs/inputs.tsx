import type { InputConfig, PersonBoxes } from '../app/store';
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
import { PacmanGhostsInput } from './PacmanGhostsInput';

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
            {showFrozenImage ? (
              <Rescaler style={{ rescaleMode: 'fill' }}>
                <Image imageId={input.frozenImageId!} />
              </Rescaler>
            ) : isGame && getInputRenderer('game') ? (
              getInputRenderer('game')!(input, {
                width: contentWidth,
                height: contentHeight,
              })
            ) : isImage ? (
              <Rescaler style={{ rescaleMode: 'fit' }}>
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
            ) : peopleBoxes?.ghost && peopleBoxes.boxes.length ? (
              <PacmanGhostsInput
                sourceInputId={input.inputId}
                data={peopleBoxes}
                resolution={{ width: contentWidth, height: contentHeight }}
                volume={input.volume}
              />
            ) : (
              <Rescaler style={{ rescaleMode: 'fill' }}>
                <InputStream inputId={input.inputId} volume={input.volume} />
              </Rescaler>
            )}
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
            {peopleCount != null ? (
              <PeopleCountBadge
                count={peopleCount}
                parent={{ width: contentWidth, height: contentHeight }}
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
      {boxes.map((box, i) => (
        <View
          key={i}
          style={{
            top: Math.round(offY + box.y * dispH),
            left: Math.round(offX + box.x * dispW),
            width: Math.max(2, Math.round(box.w * dispW)),
            height: Math.max(2, Math.round(box.h * dispH)),
            borderWidth: 4,
            borderColor: '#00FF66FF',
            borderRadius: 4,
          }}
        />
      ))}
    </View>
  );
}
