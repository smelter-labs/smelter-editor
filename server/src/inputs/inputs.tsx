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
  fontSize: number;
  color: string;
  align: 'left' | 'center' | 'right';
  containerWidth: number;
  containerHeight: number;
};

function ScrollingText({
  text,
  maxLines,
  scrollSpeed,
  fontSize,
  color,
  align,
  containerWidth,
  containerHeight,
}: ScrollingTextProps) {
  const lineHeight = fontSize * 1.2;
  const visibleHeight = maxLines > 0 ? maxLines * lineHeight : containerHeight;
  const lines = text.split('\n');
  const totalTextHeight = lines.length * lineHeight;
  
  const shouldAnimate = maxLines > 0;
  
  const [scrollOffset, setScrollOffset] = useState(visibleHeight);
  const targetOffsetRef = useRef(visibleHeight);
  const isAnimatingRef = useRef(false);
  const prevLinesCountRef = useRef(0);

  useEffect(() => {
    if (!shouldAnimate) {
      return;
    }

    if (lines.length > prevLinesCountRef.current) {
      const targetPosition = visibleHeight - totalTextHeight;
      targetOffsetRef.current = targetPosition;
      
      if (!isAnimatingRef.current) {
        isAnimatingRef.current = true;
        const intervalMs = 16;
        const pixelsPerFrame = (scrollSpeed / 1000) * intervalMs;
        
        const timer = setInterval(() => {
          setScrollOffset(prev => {
            const target = targetOffsetRef.current;
            if (prev <= target) {
              isAnimatingRef.current = false;
              clearInterval(timer);
              return target;
            }
            return prev - pixelsPerFrame;
          });
        }, intervalMs);
        
        return () => clearInterval(timer);
      }
    }
    prevLinesCountRef.current = lines.length;
  }, [lines.length, shouldAnimate, totalTextHeight, visibleHeight, scrollSpeed]);

  useEffect(() => {
    if (!shouldAnimate) {
      setScrollOffset(0);
      targetOffsetRef.current = 0;
    }
  }, [shouldAnimate]);

  const textTopOffset = shouldAnimate ? scrollOffset : 0;

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
  const resolution = { width: 1920, height: 1080 };

  const inputComponent = (
    <Rescaler style={resolution}>
      <View style={{ ...resolution, direction: 'column' }}>
        {streamState === 'playing' ? (
          isImage ? (
            <Rescaler style={{ rescaleMode: 'fit' }}>
              <Image imageId={input.imageId!} />
            </Rescaler>
          ) : isTextInput ? (
            <View style={{ width: 1920, height: 1080, backgroundColor: '#1a1a2e' }}>
              <ScrollingText
                text={input.text!}
                maxLines={input.textMaxLines ?? 10}
                scrollSpeed={input.textScrollSpeed ?? 100}
                fontSize={80}
                color={input.textColor ?? 'white'}
                align={input.textAlign ?? 'left'}
                containerWidth={resolution.width}
                containerHeight={resolution.height}
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
              <Text style={{ fontSize: 600 }}>Stream offline</Text>
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
            <Text style={{ fontSize: 40, color: 'white' }}>{input?.title}</Text>
            <View style={{ height: 10 }} />

            <Text style={{ fontSize: 25, color: 'white' }}>{input?.description}</Text>
          </View>
        )}
      </View>
    </Rescaler>
  );

  const activeShaders = input.shaders.filter(shader => shader.enabled);

  return wrapWithShaders(inputComponent, activeShaders, resolution);
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
        <View style={{ width: resolution.width, height: resolution.height, backgroundColor: '#1a1a2e' }}>
          <ScrollingText
            text={input.text!}
            maxLines={input.textMaxLines ?? 10}
            scrollSpeed={input.textScrollSpeed ?? 100}
            fontSize={30}
            color={input.textColor ?? 'white'}
            align={input.textAlign ?? 'left'}
            containerWidth={resolution.width}
            containerHeight={resolution.height}
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
          <Text style={{ fontSize: 30, color: 'white' }}>{input.title}</Text>
        </View>
      )}
    </View>
  );

  if (activeShaders.length) {
    return (
      <Rescaler>{wrapWithShaders(smallInputComponent, activeShaders, resolution)}</Rescaler>
    );
  }
  return <Rescaler>{smallInputComponent}</Rescaler>;
}
