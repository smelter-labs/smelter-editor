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
  index: number = 0
): ReactElement {
  if (!shaders || index >= shaders.length) {
    return component;
  }
  const shader = shaders[index];
  const shaderDef = shadersController.getShaderById(shader.shaderId);
  
  const shaderParams: ShaderParamStructField[] = [];
  
  if (Array.isArray(shader.params)) {
    for (const param of shader.params) {
      // Check if this param is a color type in the shader definition
      const paramDef = shaderDef?.params?.find(p => p.name === param.paramName);
      
      if (paramDef?.type === 'color') {
        // Convert color param to r, g, b values
        // Remove '_color' suffix from param name if present, then add _r, _g, _b
        // e.g., 'target_color' -> 'target_r', 'target_g', 'target_b'
        const baseName = param.paramName;
        const colorValue = param.paramValue;
        const rgb = colorToRgb(colorValue);
        
        // Add the three RGB components
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
        // Regular param, pass through
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
      {wrapWithShaders(component, shaders, resolution, index + 1)}
    </Shader>
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
            <View style={{ width: 1920, height: 1080, backgroundColor: '#1a1a2e', padding: 100 }}>
              <Text style={{ 
                fontSize: 80, 
                width:resolution.width, 
                height:resolution.height, 
                maxHeight:resolution.height,
                maxWidth:resolution.width,
                color: input.textColor ?? 'white', 
                wrap:'word',
                align: input.textAlign ?? 'left' }}>
                  {input.text}
                </Text>
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

  return wrapWithShaders(inputComponent, activeShaders, resolution, 0);
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
        <View style={{ width: resolution.width, height: resolution.height, backgroundColor: '#1a1a2e', padding: 30 }}>
          <Text style={{ fontSize: 30, color: input.textColor ?? 'white', align: input.textAlign ?? 'left' }}>{input.text}</Text>
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
      <Rescaler>{wrapWithShaders(smallInputComponent, activeShaders, resolution, 0)}</Rescaler>
    );
  }
  return <Rescaler>{smallInputComponent}</Rescaler>;
}
