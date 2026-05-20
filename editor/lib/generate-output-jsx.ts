import type {
  Layer,
  LayerInput,
  Resolution,
  ShaderConfig,
  ViewportProperties,
} from '@smelter-editor/types';
import type { Input } from '@/lib/types';

export type OutputJsxState = {
  inputs: Input[];
  layers: Layer[];
  resolution: Resolution;
  outputShaders?: ShaderConfig[];
} & Partial<ViewportProperties>;

function indent(level: number): string {
  return '  '.repeat(level);
}

function escapeString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${escapeString(value)}'`;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatValue).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}: ${formatValue(v)}`);
    return `{ ${entries.join(', ')} }`;
  }
  return String(value);
}

function formatShaderParams(shader: ShaderConfig): string {
  if (!shader.params?.length) return '';
  const fields = shader.params.map(
    (p) =>
      `{ type: 'f32', fieldName: '${p.paramName}', value: ${formatValue(p.paramValue)} }`,
  );
  return `shaderParam={{ type: 'struct', value: [${fields.join(', ')}] }}`;
}

function wrapWithShadersJsx(
  inner: string,
  shaders: ShaderConfig[],
  resolution: Resolution,
  level: number,
): string {
  const enabled = shaders.filter((s) => s.enabled);
  if (enabled.length === 0) return inner;

  let result = inner;
  for (const shader of enabled) {
    const params = formatShaderParams(shader);
    const res = `{ width: ${resolution.width}, height: ${resolution.height} }`;
    result = `${indent(level)}<Shader shaderId='${shader.shaderId}' resolution={${res}}${params ? ` ${params}` : ''}>\n${result}\n${indent(level)}</Shader>`;
  }
  return result;
}

function buildEasingLiteral(easing?: string): string {
  if (easing === 'bounce') return "'bounce'";
  if (easing === 'cubic_bezier_ease_in_out') {
    return "{ functionName: 'cubic_bezier', points: [0.65, 0, 0.35, 1] }";
  }
  return "'linear'";
}

function generateCropShader(
  item: LayerInput,
  width: number,
  height: number,
  level: number,
): string | null {
  const cT = item.cropTop ?? 0;
  const cL = item.cropLeft ?? 0;
  const cR = item.cropRight ?? 0;
  const cB = item.cropBottom ?? 0;
  if (!cT && !cL && !cR && !cB) return null;

  const res = `{ width: ${Math.max(1, width)}, height: ${height} }`;
  return `${indent(level)}<Shader shaderId='crop' resolution={${res}} shaderParam={{ type: 'struct', value: [
${indent(level + 1)}{ type: 'f32', fieldName: 'crop_top', value: ${cT / height} },
${indent(level + 1)}{ type: 'f32', fieldName: 'crop_left', value: ${cL / Math.max(1, width)} },
${indent(level + 1)}{ type: 'f32', fieldName: 'crop_right', value: ${cR / Math.max(1, width)} },
${indent(level + 1)}{ type: 'f32', fieldName: 'crop_bottom', value: ${cB / height} },
${indent(level)}] }}>`;
}

function generateInputContent(input: Input, level: number): string {
  if (input.hidden) {
    return `${indent(level)}{/* input ${input.inputId} hidden */}`;
  }

  if (input.mp4ShowsFrozenFrame) {
    return `${indent(level)}<Image imageId='frozen-frame' />`;
  }

  if (input.type === 'image' && input.imageId) {
    return `${indent(level)}<Rescaler style={{ rescaleMode: 'fit' }}>
${indent(level + 1)}<Image imageId='${escapeString(input.imageId)}' />
${indent(level)}</Rescaler>`;
  }

  if (input.type === 'text-input' && input.text) {
    return `${indent(level)}<ScrollingText
${indent(level + 1)}text='${escapeString(input.text)}'
${indent(level + 1)}fontSize={${input.textFontSize ?? 80}}
${indent(level + 1)}color='${input.textColor ?? 'white'}'
${indent(level + 1)}align='${input.textAlign ?? 'left'}'
${indent(level)}/>`;
  }

  if (input.type === 'game') {
    return `${indent(level)}<GameBoard inputId='${input.inputId}' />`;
  }

  if (input.type === 'hands' && input.handsSourceInputId) {
    return `${indent(level)}<HandsInput sourceInputId='${input.handsSourceInputId}' />`;
  }

  if (input.attachedInputIds && input.attachedInputIds.length > 0) {
    const attached = input.attachedInputIds
      .map((id) => {
        return `${indent(level + 1)}<Rescaler key='${id}' style={{ top: 0, left: 0 }}>
${indent(level + 2)}<Input inputId='${id}' />
${indent(level + 1)}</Rescaler>`;
      })
      .join('\n');
    const main = generateInputInner(input, level + 2);
    return `${indent(level)}<View style={{ direction: 'column', overflow: 'visible' }}>
${attached}
${indent(level + 1)}<Rescaler style={{ top: 0, left: 0 }}>
${main}
${indent(level + 1)}</Rescaler>
${indent(level)}</View>`;
  }

  return generateInputInner(input, level);
}

function generateInputInner(input: Input, level: number): string {
  let content = '';

  if (
    input.type === 'local-mp4' ||
    input.type === 'twitch-channel' ||
    input.type === 'kick-channel' ||
    input.type === 'hls' ||
    input.type === 'whip'
  ) {
    const vol =
      input.volume !== undefined && input.volume !== 1
        ? ` volume={${input.volume}}`
        : '';
    content = `${indent(level)}<Rescaler style={{ rescaleMode: 'fill' }}>
${indent(level + 1)}<InputStream inputId='${input.inputId}'${vol} />
${indent(level)}</Rescaler>`;
  } else {
    content = generateInputContent(input, level);
  }

  const resolution = `{ width: 1920, height: 1080 }`;
  const activeShaders = (input.shaders ?? []).filter((s) => s.enabled);
  if (activeShaders.length > 0) {
    content = wrapWithShadersJsx(
      content,
      activeShaders,
      { width: 1920, height: 1080 },
      level,
    );
  }

  if (input.activeTransition) {
    const t = input.activeTransition;
    content = `${indent(level)}<TransitionShaderWrapper transition={{ type: '${t.type}' }} resolution={${resolution}}>
${content}
${indent(level)}</TransitionShaderWrapper>`;
  }

  if (input.showTitle !== false) {
    content = `${indent(level)}<View style={{ direction: 'column' }}>
${content}
${indent(level + 1)}<View style={{ backgroundColor: '#493880', height: 90 }}>
${indent(level + 2)}<Text style={{ fontSize: 40, color: 'white' }}>${escapeString(input.title)}</Text>
${indent(level + 1)}</View>
${indent(level)}</View>`;
  }

  return content;
}

function generateInputJsx(input: Input, level: number): string {
  return `${indent(level)}<Input input={{ inputId: '${input.inputId}', type: '${input.type}', title: '${escapeString(input.title)}' }}>
${generateInputContent(input, level + 1)}
${indent(level)}</Input>`;
}

function generateLayerInputJsx(
  layer: Layer,
  item: LayerInput,
  input: Input,
  level: number,
): string {
  const layerItemKey = `${layer.id}:${item.inputId}`;
  const easing = buildEasingLiteral(item.transitionEasing);
  const duration = item.transitionDurationMs ?? 300;

  let inner = `${indent(level + 2)}<Input input={{ inputId: '${item.inputId}' }} />`;
  const expanded = generateInputContent(input, level + 3);
  if (expanded.trim()) {
    inner = `${indent(level + 2)}<Input input={{ inputId: '${item.inputId}', type: '${input.type}' }}>\n${expanded}\n${indent(level + 2)}</Input>`;
  }

  const cropOpen = generateCropShader(item, item.width, item.height, level + 2);
  if (cropOpen) {
    inner = `${cropOpen}
${inner}
${indent(level + 2)}</Shader>`;
  }

  return `${indent(level)}<Rescaler
${indent(level + 1)}key='${layerItemKey}'
${indent(level + 1)}id='layer-${layer.id}-${item.inputId}'
${indent(level + 1)}transition={{ durationMs: ${duration}, easingFunction: ${easing} }}
${indent(level + 1)}style={{ top: ${item.y}, left: ${item.x}, width: ${item.width}, height: ${item.height} }}
${indent(level)}>
${inner}
${indent(level)}</Rescaler>`;
}

function generateCarouselLayer(
  layer: Layer,
  inputMap: Map<string, Input>,
  width: number,
  height: number,
  level: number,
): string {
  const carousel = layer.carousel!;
  const slot = layer.inputs[0];
  if (!slot) return '';

  const visibleCount = Math.max(
    1,
    Math.min(carousel.visibleCount ?? 1, layer.inputs.length),
  );
  const easing = buildEasingLiteral(carousel.easing);

  const slides = layer.inputs
    .map((item, i) => {
      const input = inputMap.get(item.inputId);
      if (!input || input.hidden) return null;
      let inner = generateInputJsx(input, level + 3);
      const cropOpen = generateCropShader(
        item,
        Math.max(1, slot.width / visibleCount),
        slot.height,
        level + 3,
      );
      if (cropOpen) {
        inner = `${cropOpen}
${inner}
${indent(level + 3)}</Shader>`;
      }
      return `${indent(level + 2)}<Rescaler key='carousel-${layer.id}-${item.inputId}' style={{ left: ${i * (slot.width / visibleCount)} }}>
${inner}
${indent(level + 2)}</Rescaler>`;
    })
    .filter(Boolean)
    .join('\n');

  return `${indent(level)}<View key='${layer.id}' style={{ top: ${slot.y}, left: ${slot.x}, width: ${slot.width}, height: ${slot.height}, overflow: 'hidden' }}>
${indent(level + 1)}{/* carousel activeIndex=${carousel.activeIndex} visibleCount=${visibleCount} durationMs=${carousel.durationMs} easing=${easing} */}
${slides}
${indent(level)}</View>`;
}

function generateLayerJsx(
  layer: Layer,
  inputMap: Map<string, Input>,
  width: number,
  height: number,
  level: number,
): string {
  if (layer.enabled === false) {
    return `${indent(level)}{/* layer ${layer.id} disabled */}`;
  }

  if (layer.carousel && layer.inputs.length > 0) {
    return generateCarouselLayer(layer, inputMap, width, height, level);
  }

  const behaviorComment = layer.behavior
    ? `${indent(level)}{/* behavior: ${layer.behavior.type} */}\n`
    : '';

  const items = layer.inputs
    .map((item) => {
      const input = inputMap.get(item.inputId);
      if (!input || input.hidden) return null;
      return generateLayerInputJsx(layer, item, input, level + 1);
    })
    .filter(Boolean)
    .join('\n');

  return `${behaviorComment}${indent(level)}<View key='${layer.id}' style={{ top: 0, left: 0, width: ${width}, height: ${height}, overflow: 'visible' }}>
${items}
${indent(level)}</View>`;
}

export function generateOutputJsx(state: OutputJsxState): string {
  const { width, height } = state.resolution;
  const inputMap = new Map(state.inputs.map((i) => [i.inputId, i]));
  const layersReversed = [...state.layers].reverse();
  const activeOutputShaders = (state.outputShaders ?? []).filter(
    (s) => s.enabled,
  );

  const vT = state.viewportTop ?? 0;
  const vL = state.viewportLeft ?? 0;
  const vW = state.viewportWidth ?? width;
  const vH = state.viewportHeight ?? height;
  const hasViewport = vT !== 0 || vL !== 0 || vW !== width || vH !== height;

  const layerBlocks = layersReversed
    .map((layer) => generateLayerJsx(layer, inputMap, width, height, 2))
    .join('\n');

  let innerScene = `${indent(1)}<View style={{ backgroundColor: '#000000', width: ${width}, height: ${height}, overflow: 'visible' }}>
${layerBlocks || `${indent(2)}{/* no layers */}`}
${indent(1)}</View>`;

  if (hasViewport) {
    const vpEasing = buildEasingLiteral(state.viewportTransitionEasing);
    const vpDuration = state.viewportTransitionDurationMs ?? 300;
    innerScene = `${indent(1)}<View style={{ width: ${width}, height: ${height}, backgroundColor: '#000000' }}>
${indent(2)}<Rescaler
${indent(3)}id='viewport'
${indent(3)}transition={{ durationMs: ${vpDuration}, easingFunction: ${vpEasing} }}
${indent(3)}style={{ top: ${vT}, left: ${vL}, width: ${vW}, height: ${vH} }}
${indent(2)}>
${innerScene}
${indent(2)}</Rescaler>
${indent(1)}</View>`;
  }

  let scene = innerScene;
  if (activeOutputShaders.length > 0) {
    scene = wrapWithShadersJsx(
      scene,
      activeOutputShaders,
      { width, height },
      1,
    );
  }

  return `// Generated from current room state — mirrors server/src/app/App.tsx OutputScene
<App store={roomStore}>
  <OutputScene resolution={{ width: ${width}, height: ${height} }}>
${scene}
  </OutputScene>
</App>`;
}
