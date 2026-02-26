import type { GameState, InputConfig } from '../app/store';
import type { ShaderParamStructField } from '@swmansion/smelter';
import {
  Text,
  View,
  InputStream,
  Image,
  Rescaler,
  useInputStreams,
  Shader,
} from '@swmansion/smelter';

import React, { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { ShaderConfig, ShaderParamConfig } from '../shaders/shaders';
import shadersController from '../shaders/shaders';

type Resolution = { width: number; height: number };

/**
 * Converts a hex color string to RGB values (0-1 range)
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove # if present
  const cleanHex = hex.replace('#', '');
  
  // Handle 3-digit hex
  const fullHex = cleanHex.length === 3
    ? cleanHex.split('').map(char => char + char).join('')
    : cleanHex;
  
  const r = parseInt(fullHex.substring(0, 2), 16) / 255;
  const g = parseInt(fullHex.substring(2, 4), 16) / 255;
  const b = parseInt(fullHex.substring(4, 6), 16) / 255;
  
  return { r, g, b };
}

/**
 * Converts a color value (hex string or number) to RGB
 * If it's a number, treats it as a packed integer (0xRRGGBB)
 */
function colorToRgb(colorValue: number | string): { r: number; g: number; b: number } {
  if (typeof colorValue === 'string') {
    return hexToRgb(colorValue);
  }
  // Treat as packed integer: 0xRRGGBB
  const r = ((colorValue >> 16) & 0xff) / 255;
  const g = ((colorValue >> 8) & 0xff) / 255;
  const b = (colorValue & 0xff) / 255;
  return { r, g, b };
}

function normalizeBorderWidth(borderWidth: number | undefined): number {
  if (borderWidth === undefined || Number.isNaN(borderWidth)) {
    return 0;
  }
  return Math.max(0, Math.round(borderWidth));
}

function wrapWithShaders(
  component: ReactElement,
  shaders: ShaderConfig[] | undefined,
  resolution: Resolution,
  index?: number
): ReactElement {
  if (!shaders || shaders.length === 0) {
    return component;
  }
  const currentIndex = index ?? shaders.length - 1;
  if (currentIndex < 0) {
    return component;
  }
  const shader = shaders[currentIndex];
  const shaderDef = shadersController.getShaderById(shader.shaderId);
  
  const shaderParams: ShaderParamStructField[] = [];
  
  if (shaderDef?.params && Array.isArray(shader.params)) {
    for (const paramDef of shaderDef.params) {
      const param = shader.params.find(p => p.paramName === paramDef.name);
      if (!param) continue;
      
      if (paramDef.type === 'color') {
        const baseName = param.paramName;
        const colorValue = param.paramValue;
        const rgb = colorToRgb(colorValue);
        
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_r`,
          value: rgb.r,
        } as ShaderParamStructField);
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_g`,
          value: rgb.g,
        } as ShaderParamStructField);
        shaderParams.push({
          type: 'f32',
          fieldName: `${baseName}_b`,
          value: rgb.b,
        } as ShaderParamStructField);
      } else {
        const numValue = typeof param.paramValue === 'string' ? Number(param.paramValue) : param.paramValue;
        shaderParams.push({
          type: 'f32',
          fieldName: param.paramName,
          value: numValue,
        } as ShaderParamStructField);
      }
    }
  }
  
  return (
    <Shader
      shaderId={shader.shaderId}
      resolution={resolution}
      shaderParam={
        shaderParams.length > 0
          ? {
              type: 'struct',
              value: shaderParams,
            }
          : undefined
      }>
      {wrapWithShaders(component, shaders, resolution, currentIndex - 1)}
    </Shader>
  );
}

type ScrollingTextProps = {
  text: string;
  maxLines: number;
  scrollSpeed: number;
  scrollLoop: boolean;
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  containerWidth: number;
  containerHeight: number;
  scrollNudge?: number;
};

function ScrollingText({
  text,
  maxLines,
  scrollSpeed,
  scrollLoop,
  fontSize,
  color,
  align,
  containerWidth,
  containerHeight,
  scrollNudge = 0,
}: ScrollingTextProps) {
  const lineHeight = fontSize * 1.2;
  const visibleHeight = containerHeight;
  const lines = text.split('\n');
  const totalTextHeight = lines.length * lineHeight;
  
  const shouldAnimate = maxLines > 0;
  const startPosition = visibleHeight;
  
  const [scrollOffset, setScrollOffset] = useState(startPosition);
  const [permanentNudgeOffset, setPermanentNudgeOffset] = useState(0);
  const permanentNudgeRef = useRef(0);
  const [animatingNudge, setAnimatingNudge] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const nudgeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevLinesCountRef = useRef(0);
  const initializedRef = useRef(false);
  const prevNudgeRef = useRef(0);

  useEffect(() => {
    if (scrollNudge !== 0 && scrollNudge !== prevNudgeRef.current) {
      prevNudgeRef.current = scrollNudge;
      const nudgeAmount = Math.floor(scrollNudge) * lineHeight;
      const nudgeDuration = 500;
      const intervalMs = 16;
      const steps = nudgeDuration / intervalMs;
      let currentStep = 0;

      if (nudgeTimerRef.current) {
        clearInterval(nudgeTimerRef.current);
      }

      nudgeTimerRef.current = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;
        const eased = progress < 0.5 
          ? 4 * progress * progress * progress 
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;
        
        setAnimatingNudge(nudgeAmount * eased);

        if (currentStep >= steps) {
          if (nudgeTimerRef.current) {
            clearInterval(nudgeTimerRef.current);
            nudgeTimerRef.current = null;
          }
          permanentNudgeRef.current += nudgeAmount;
          setPermanentNudgeOffset(permanentNudgeRef.current);
          setAnimatingNudge(0);
        }
      }, intervalMs);
    }
  }, [scrollNudge, lineHeight]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    if (!shouldAnimate) {
      setScrollOffset(0);
      return;
    }

    const currentLinesCount = lines.length;
    const prevLinesCount = prevLinesCountRef.current;
    const isFirstRun = !initializedRef.current;
    
    prevLinesCountRef.current = currentLinesCount;
    initializedRef.current = true;

    if (isFirstRun) {
      setScrollOffset(startPosition);
    }

    const targetPosition = -totalTextHeight;
    const intervalMs = 16;
    const pixelsPerFrame = (scrollSpeed / 1000) * intervalMs;

    timerRef.current = setInterval(() => {
      setScrollOffset(prev => {
        const effectivePosition = prev + permanentNudgeRef.current;
        if (effectivePosition <= targetPosition) {
          if (scrollLoop) {
            permanentNudgeRef.current = 0;
            setPermanentNudgeOffset(0);
            return startPosition;
          }
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          return targetPosition - permanentNudgeRef.current;
        }
        return prev - pixelsPerFrame;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [text, shouldAnimate, totalTextHeight, startPosition, scrollSpeed, scrollLoop, lines.length]);

  const textTopOffset = shouldAnimate ? scrollOffset + permanentNudgeOffset + animatingNudge : 0;

  return (
    <View style={{ 
      width: containerWidth, 
      height: visibleHeight, 
      overflow: 'hidden',
    }}>
      <View style={{ 
        width: containerWidth,
        height: totalTextHeight,
        top: textTopOffset,
        left: 0,
      }}>
        <Text style={{ 
          fontSize, 
          width: containerWidth,
          color, 
          wrap: 'word',
          align,
          fontFamily: 'Star Jedi',
        }}>
          {text}
        </Text>
      </View>
    </View>
  );
}


function GameBoard({ gameState, resolution }: { gameState: GameState; resolution: Resolution }) {
  const gap = gameState.cellGap ?? 1;
  const totalGapX = gap * (gameState.boardWidth - 1);
  const totalGapY = gap * (gameState.boardHeight - 1);
  const cellPixel = Math.min(
    (resolution.width - totalGapX) / gameState.boardWidth,
    (resolution.height - totalGapY) / gameState.boardHeight,
  );
  const boardW = cellPixel * gameState.boardWidth + totalGapX;
  const boardH = cellPixel * gameState.boardHeight + totalGapY;
  const offsetX = (resolution.width - boardW) / 2;
  const offsetY = (resolution.height - boardH) / 2;

  const borderW = gameState.boardBorderWidth ?? 4;
  const borderC = gameState.boardBorderColor ?? '#ffffff';

  return (
    <View style={{ width: resolution.width, height: resolution.height, backgroundColor: gameState.backgroundColor }}>
      {/* Board border */}
      {borderW > 0 && (
        <View style={{
          width: boardW + borderW * 2,
          height: boardH + borderW * 2,
          top: offsetY - borderW,
          left: offsetX - borderW,
          borderWidth: borderW,
          borderColor: borderC,
        }} />
      )}
      {gameState.cells.map((cell, i) => {
        const size = cell.size ?? gameState.cellSize;
        const w = cellPixel * size;
        const h = cellPixel * size;
        const x = offsetX + cell.x * (cellPixel + gap);
        const y = offsetY + cell.y * (cellPixel + gap);

        // Determine snake direction: prefer explicit `direction` field, fallback to body inference
        let eyePositions: { eye1Top: number; eye1Left: number; eye2Top: number; eye2Left: number;
          pupil1Top: number; pupil1Left: number; pupil2Top: number; pupil2Left: number } | undefined;
        if (cell.isHead) {
          let dir: 'up' | 'down' | 'left' | 'right' = cell.direction ?? 'right';
          if (!cell.direction) {
            const nextBody = gameState.cells.find(c => !c.isHead && c.color === cell.color);
            if (nextBody) {
              let dx = cell.x - nextBody.x;
              let dy = cell.y - nextBody.y;
              if (Math.abs(dx) > 1) dx = -Math.sign(dx);
              if (Math.abs(dy) > 1) dy = -Math.sign(dy);
              if (dx === 1 && dy === 0) dir = 'right';
              else if (dx === -1 && dy === 0) dir = 'left';
              else if (dx === 0 && dy === -1) dir = 'up';
              else dir = 'down';
            }
          }
          const eyeSize = w * 0.28;
          const pupilSize = w * 0.14;
          const pupilOffset = w * 0.07;
          if (dir === 'right') {
            eyePositions = {
              eye1Top: h * 0.15, eye1Left: w * 0.57,
              eye2Top: h * 0.57, eye2Left: w * 0.57,
              pupil1Top: pupilOffset, pupil1Left: eyeSize - pupilSize - pupilOffset,
              pupil2Top: pupilOffset, pupil2Left: eyeSize - pupilSize - pupilOffset,
            };
          } else if (dir === 'left') {
            eyePositions = {
              eye1Top: h * 0.15, eye1Left: w * 0.15,
              eye2Top: h * 0.57, eye2Left: w * 0.15,
              pupil1Top: pupilOffset, pupil1Left: 0,
              pupil2Top: pupilOffset, pupil2Left: 0,
            };
          } else if (dir === 'up') {
            eyePositions = {
              eye1Top: h * 0.15, eye1Left: w * 0.15,
              eye2Top: h * 0.15, eye2Left: w * 0.57,
              pupil1Top: 0, pupil1Left: pupilOffset,
              pupil2Top: 0, pupil2Left: pupilOffset,
            };
          } else {
            eyePositions = {
              eye1Top: h * 0.57, eye1Left: w * 0.15,
              eye2Top: h * 0.57, eye2Left: w * 0.57,
              pupil1Top: eyeSize - pupilSize, pupil1Left: pupilOffset,
              pupil2Top: eyeSize - pupilSize, pupil2Left: pupilOffset,
            };
          }
        }

        return (
          <View key={i} style={{ width: w, height: h, top: y, left: x, backgroundColor: cell.color }}>
            {cell.isHead && eyePositions && (
              <>
                <View style={{
                  width: w * 0.28, height: w * 0.28,
                  top: eyePositions.eye1Top, left: eyePositions.eye1Left,
                  backgroundColor: '#ffffff', borderRadius: w * 0.14,
                }}>
                  <View style={{
                    width: w * 0.14, height: w * 0.14,
                    top: eyePositions.pupil1Top, left: eyePositions.pupil1Left,
                    backgroundColor: '#000000', borderRadius: w * 0.07,
                  }} />
                </View>
                <View style={{
                  width: w * 0.28, height: w * 0.28,
                  top: eyePositions.eye2Top, left: eyePositions.eye2Left,
                  backgroundColor: '#ffffff', borderRadius: w * 0.14,
                }}>
                  <View style={{
                    width: w * 0.14, height: w * 0.14,
                    top: eyePositions.pupil2Top, left: eyePositions.pupil2Left,
                    backgroundColor: '#000000', borderRadius: w * 0.07,
                  }} />
                </View>
              </>
            )}
          </View>
        );
      })}
      {/* Grid overlay: procedural shader generating light gray grid lines */}
      <View style={{ width: boardW, height: boardH, top: offsetY, left: offsetX }}>
        <Shader
          shaderId="grid-overlay"
          resolution={{ width: Math.round(boardW), height: Math.round(boardH) }}
          shaderParam={{
            type: 'struct',
            value: [
              { type: 'f32', fieldName: 'cells_x', value: gameState.boardWidth },
              { type: 'f32', fieldName: 'cells_y', value: gameState.boardHeight },
              { type: 'f32', fieldName: 'gap', value: gap },
              { type: 'f32', fieldName: 'line_r', value: 0.45 },
              { type: 'f32', fieldName: 'line_g', value: 0.45 },
              { type: 'f32', fieldName: 'line_b', value: 0.45 },
              { type: 'f32', fieldName: 'line_a', value: 0.15 },
            ],
          }}
        />
      </View>
    </View>
  );
}

export function Input({ input }: { input: InputConfig }) {
  const streams = useInputStreams();
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const isGame = !!input.gameState;
  const streamState = isImage || isTextInput || isGame ? 'playing' : (streams[input.inputId]?.videoState ?? 'finished');
  const isVerticalInput = input.orientation === 'vertical';
  const resolution = isVerticalInput ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const borderWidth = normalizeBorderWidth(
    input.borderWidth ?? (isTextInput ? 8 : 0),
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
            {isGame ? (
              <GameBoard gameState={input.gameState!} resolution={{ width: contentWidth, height: contentHeight }} />
            ) : isImage ? (
              <Rescaler style={{ rescaleMode: 'fit' }}>
                <Image imageId={input.imageId!} />
              </Rescaler>
            ) : isTextInput ? (
              <ScrollingText
                text={input.text!}
                maxLines={input.textMaxLines ?? 10}
                scrollSpeed={input.textScrollSpeed ?? 40}
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
              <Text style={{ fontSize: 600, fontFamily: 'Star Jedi' }}>Stream offline</Text>
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

  const mainRendered = wrapWithShaders(inputComponent, activeShaders, resolution);

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
  const isGame = !!input.gameState;
  const borderWidth = normalizeBorderWidth(
    input.borderWidth ?? (isTextInput ? 4 : 0),
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
        {isGame ? (
          <GameBoard gameState={input.gameState!} resolution={{ width: contentWidth, height: contentHeight }} />
        ) : isImage ? (
          <Rescaler style={{ rescaleMode: 'fit' }}>
            <Image imageId={input.imageId!} />
          </Rescaler>
        ) : isTextInput ? (
          <ScrollingText
            text={input.text!}
            maxLines={input.textMaxLines ?? 10}
            scrollSpeed={input.textScrollSpeed ?? 40}
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

  const mainRendered = activeShaders.length
    ? wrapWithShaders(smallInputComponent, activeShaders, resolution)
    : smallInputComponent;

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
