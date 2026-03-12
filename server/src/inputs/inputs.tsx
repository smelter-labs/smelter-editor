import type { InputConfig } from '../app/store';
import {
  Text,
  View,
  InputStream,
  Image,
  Rescaler,
  useInputStreams,
} from '@swmansion/smelter';

import React from 'react';
import { getInputRenderer } from './rendererRegistry';
import { wrapWithShaders } from '../utils/shaderUtils';
import { ScrollingText } from './scrollingText';
import { TransitionShaderWrapper } from './transitionWrapper';

type Resolution = { width: number; height: number };

function normalizeBorderWidth(borderWidth: number | undefined): number {
  if (borderWidth === undefined || Number.isNaN(borderWidth)) {
    return 0;
  }
  return Math.max(0, Math.round(borderWidth));
}

export function Input({ input }: { input: InputConfig }) {
  const streams = useInputStreams();
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const isGame = !!input.snakeGameState;
  const streamState = isImage || isTextInput || isGame ? 'playing' : (streams[input.inputId]?.videoState ?? 'finished');
  const isVerticalInput = input.orientation === 'vertical';
  const resolution = isVerticalInput ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const borderWidth = normalizeBorderWidth(
    input.borderWidth ?? 0,
  );
  const borderColor = input.borderColor ?? '#ff0000';
  const contentWidth = Math.max(1, resolution.width - borderWidth * 2);
  const contentHeight = Math.max(1, resolution.height - borderWidth * 2);

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
            {isGame && getInputRenderer('game') ? (
              getInputRenderer('game')!(input, { width: contentWidth, height: contentHeight })
            ) : isImage ? (
              <Rescaler style={{ rescaleMode: 'fit' }}>
                <Image imageId={input.imageId!} />
              </Rescaler>
            ) : isTextInput ? (
              <ScrollingText
                text={input.text!}
                maxLines={input.textMaxLines ?? 10}
                scrollSpeed={input.textScrollSpeed ?? 80}
                scrollLoop={input.textScrollLoop ?? true}
                fontSize={input.textFontSize ?? 80}
                color={input.textColor ?? 'white'}
                align={input.textAlign ?? 'left'}
                containerWidth={contentWidth}
                containerHeight={contentHeight}
                scrollNudge={input.textScrollNudge}
              />
            ) : (
              <Rescaler style={{ rescaleMode: 'fill' }}>
                <InputStream inputId={input.inputId} volume={input.volume} />
              </Rescaler>
            )}
          </View>
        ) : streamState === 'ready' ? (
          <View style={{ padding: 300 }}>
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Image imageId="spinner" />
            </Rescaler>
          </View>
        ) : streamState === 'finished' ? (
          <View style={{ padding: 300 }}>
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Text style={{ fontSize: 600, fontFamily: 'Star Jedi' }}></Text>
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
            <Text style={{ fontSize: 40, color: 'white', fontFamily: 'Star Jedi' }}>{input?.title}</Text>
            <View style={{ height: 10 }} />

            <Text style={{ fontSize: 25, color: 'white', fontFamily: 'Star Jedi' }}>{input?.description}</Text>
          </View>
        )}
      </View>
    </Rescaler>
  );

  const activeShaders = input.shaders.filter(shader => shader.enabled);

  let mainRendered = wrapWithShaders(inputComponent, activeShaders, resolution);

  if (input.activeTransition) {
    mainRendered = (
      <TransitionShaderWrapper transition={input.activeTransition} resolution={resolution}>
        {mainRendered}
      </TransitionShaderWrapper>
    );
  }

  if (input.attachedInputs && input.attachedInputs.length > 0) {
    return (
      <View style={{ ...resolution, direction: 'column', overflow: 'visible' }}>
        {input.attachedInputs.map(attached => (
          <Rescaler key={attached.inputId} style={{ ...resolution, top: 0, left: 0 }}>
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

export function SmallInput({
  input,
  resolution = { width: 640, height: 360 },
}: {
  input: InputConfig;
  resolution?: Resolution;
}) {
  const activeShaders = input.shaders.filter(shader => shader.enabled);
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const isGame = !!input.snakeGameState;
  const borderWidth = normalizeBorderWidth(
    input.borderWidth ?? 0,
  );
  const borderColor = input.borderColor ?? '#ff0000';
  const contentWidth = Math.max(1, resolution.width - borderWidth * 2);
  const contentHeight = Math.max(1, resolution.height - borderWidth * 2);
  const smallInputComponent = (
    <View
      style={{
        width: resolution.width,
        height: resolution.height,
        direction: 'column',
        overflow: 'visible',
      }}>
      <View
        style={{
          width: contentWidth,
          height: contentHeight,
          borderWidth,
          borderColor,
          backgroundColor: isTextInput ? '#1a1a2e' : undefined,
        }}>
        {isGame && getInputRenderer('game') ? (
          getInputRenderer('game')!(input, { width: contentWidth, height: contentHeight })
        ) : isImage ? (
          <Rescaler style={{ rescaleMode: 'fit' }}>
            <Image imageId={input.imageId!} />
          </Rescaler>
        ) : isTextInput ? (
          <ScrollingText
            text={input.text!}
            maxLines={input.textMaxLines ?? 10}
            scrollSpeed={input.textScrollSpeed ?? 80}
            scrollLoop={input.textScrollLoop ?? true}
            fontSize={30}
            color={input.textColor ?? 'white'}
            align={input.textAlign ?? 'left'}
            containerWidth={contentWidth}
            containerHeight={contentHeight}
            scrollNudge={input.textScrollNudge}
          />
        ) : (
          <Rescaler style={{ rescaleMode: 'fill' }}>
            <InputStream inputId={input.inputId} volume={input.volume} />
          </Rescaler>
        )}
      </View>
      {input.showTitle !== false && (
        <View
          style={{
            backgroundColor: '#493880',
            height: 40,
            padding: 20,
            borderRadius: 0,
            direction: 'column',
            overflow: 'visible',
            bottom: 0,
            left: 0,
          }}>
          <Text style={{ fontSize: 30, color: 'white', fontFamily: 'Star Jedi' }}>{input.title}</Text>
        </View>
      )}
    </View>
  );

  let mainRendered = activeShaders.length
    ? wrapWithShaders(smallInputComponent, activeShaders, resolution)
    : smallInputComponent;

  if (input.activeTransition) {
    mainRendered = (
      <TransitionShaderWrapper transition={input.activeTransition} resolution={resolution}>
        {mainRendered}
      </TransitionShaderWrapper>
    );
  }

  if (input.attachedInputs && input.attachedInputs.length > 0) {
    return (
      <Rescaler>
        <View style={{ ...resolution, direction: 'column', overflow: 'visible' }}>
          {input.attachedInputs.map(attached => (
            <Rescaler key={attached.inputId} style={{ ...resolution, top: 0, left: 0 }}>
              <SmallInput input={attached} resolution={resolution} />
            </Rescaler>
          ))}
          <Rescaler style={{ ...resolution, top: 0, left: 0 }}>
            {mainRendered}
          </Rescaler>
        </View>
      </Rescaler>
    );
  }

  return <Rescaler>{mainRendered}</Rescaler>;
}
