import type { InputConfig } from '../app/store';
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
        shaderParams.push({
          type: 'f32',
          fieldName: param.paramName,
          value: param.paramValue,
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

export function Input({ input }: { input: InputConfig }) {
  const streams = useInputStreams();
  const isImage = !!input.imageId;
  const isTextInput = !!input.text;
  const streamState = isImage || isTextInput ? 'playing' : (streams[input.inputId]?.videoState ?? 'finished');
  const isVerticalInput = input.orientation === 'vertical';
  const resolution = isVerticalInput ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };

  const inputComponent = (
    <Rescaler style={resolution}>
      <View style={{ ...resolution, direction: 'column' }}>
        {streamState === 'playing' ? (
          isImage ? (
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Image imageId={input.imageId!} />
            </Rescaler>
          ) : isTextInput ? (
            <View style={{ width: resolution.width - 16, height: resolution.height - 16, backgroundColor: '#1a1a2e', borderWidth: 8, borderColor: '#ff0000' }}>
              <ScrollingText
                text={input.text!}
                maxLines={input.textMaxLines ?? 10}
                scrollSpeed={input.textScrollSpeed ?? 40}
                scrollLoop={input.textScrollLoop ?? true}
                fontSize={input.textFontSize ?? 80}
                color={input.textColor ?? 'white'}
                align={input.textAlign ?? 'left'}
                containerWidth={resolution.width - 16}
                containerHeight={resolution.height - 16}
                scrollNudge={input.textScrollNudge}
              />
            </View>
          ) : (
            <Rescaler style={{ rescaleMode: 'fill' }}>
              <InputStream inputId={input.inputId} volume={input.volume} />
            </Rescaler>
          )
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
  const smallInputComponent = (
    <View
      style={{
        width: resolution.width,
        height: resolution.height,
        direction: 'column',
        overflow: 'visible',
      }}>
      {isImage ? (
        <Rescaler style={{ rescaleMode: 'fit' }}>
          <Image imageId={input.imageId!} />
        </Rescaler>
      ) : isTextInput ? (
        <View style={{ width: resolution.width - 8, height: resolution.height - 8, backgroundColor: '#1a1a2e', borderWidth: 4, borderColor: '#ff0000' }}>
          <ScrollingText
            text={input.text!}
            maxLines={input.textMaxLines ?? 10}
            scrollSpeed={input.textScrollSpeed ?? 40}
            scrollLoop={input.textScrollLoop ?? true}
            fontSize={30}
            color={input.textColor ?? 'white'}
            align={input.textAlign ?? 'left'}
            containerWidth={resolution.width - 8}
            containerHeight={resolution.height - 8}
            scrollNudge={input.textScrollNudge}
          />
        </View>
      ) : (
        <Rescaler style={{ rescaleMode: 'fill' }}>
          <InputStream inputId={input.inputId} volume={input.volume} />
        </Rescaler>
      )}
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
