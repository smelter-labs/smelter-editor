import { normalize } from './normalize';
import type { VoiceCommand, Shader, InputType, Direction } from './commandTypes';

const SHADER_MAP: Record<string, Shader> = {
  ascii: 'ascii-filter',
  'ascii filter': 'ascii-filter',
  grayscale: 'grayscale',
  'gray scale': 'grayscale',
  'black and white': 'grayscale',
  opacity: 'opacity',
  brightness: 'brightness-contrast',
  contrast: 'brightness-contrast',
  'brightness contrast': 'brightness-contrast',
  wrapped: 'circle-mask-outline',
  'wrapped outline': 'circle-mask-outline',
  circle: 'circle-mask-outline',
  'remove color': 'remove-color',
  'green screen': 'remove-color',
  chroma: 'remove-color',
  orbiting: 'orbiting',
  orbit: 'orbiting',
  stars: 'star-streaks',
  'star streaks': 'star-streaks',
  streaks: 'star-streaks',
  shadow: 'soft-shadow',
  'soft shadow': 'soft-shadow',
  hologram: 'sw-hologram',
  'star wars': 'sw-hologram',
  perspective: 'perspective',
};

const SHADER_TOKENS = Object.keys(SHADER_MAP).sort((a, b) => b.length - a.length);

const INPUT_TYPE_MAP: Record<string, InputType> = {
  stream: 'stream',
  mp4: 'mp4',
  image: 'image',
  text: 'text',
  camera: 'camera',
  newcomer: 'camera',
  screenshare: 'screenshare',
};

const DIRECTION_MAP: Record<string, Direction> = {
  up: 'UP',
  above: 'UP',
  higher: 'UP',
  app: 'UP',
  upwards: 'UP',
  down: 'DOWN',
  below: 'DOWN',
  lower: 'DOWN',
};

const ADD_VERBS = /\b(add|create|new|apply|put|insert|at|of)\b/;
const REMOVE_VERBS = /\b(remove|delete)\b/;
const MOVE_VERBS = /\b(move|swap)\b/;
const SELECT_VERBS = /\b(select|choose|pick|focus)\b/;
const DESELECT_VERBS = /\b(deselect|unselect|clear|unfocus)\b/;
const START_TYPING_PATTERN = /\b(start typing|begin typing|start dictation|begin dictation)\b/;
const STOP_TYPING_PATTERN = /\b(stop typing|end typing|stop dictation|end dictation|finish typing)\b/;
const START_ROOM_PATTERN = /\b(start|starts|open|create|new|starting)\s+(a\s+)?(new\s+)?(in\s+)?(your\s+)?room\b/;
const NEXT_LAYOUT_PATTERN = /\b(next|forward)\s+(layout|view)\b/;
const PREVIOUS_LAYOUT_PATTERN = /\b(previous|prev|back|last)\s+(layout|view)\b/;
const SET_COLOR_PATTERN = /\b(?:set|change)\s+(?:text\s+)?colou?r\s+(?:to\s+)?(\w+)\b/;
const SET_MAX_LINES_PATTERN = /\b(?:set|change)\s+(?:max(?:imum)?\s+)?lines?\s+(?:to\s+)?(\d+)\b/;
const EXPORT_CONFIG_PATTERN = /\b(export|save|download)\s+(config(?:uration)?|settings)\b/;

const TEXT_COLOR_MAP: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  red: '#ff0000',
  green: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  orange: '#ff8000',
  purple: '#800080',
  pink: '#ff69b4',
  cyan: '#00ffff',
  gray: '#808080',
  grey: '#808080',
};

function isRemoveColorShaderContext(text: string): boolean {
  return text.includes('remove color') && 
    (ADD_VERBS.test(text) || /\bto\b/.test(text) || /\bon\b/.test(text));
}

const TARGET_COLOR_MAP: Record<string, string> = {
  yellow: '#ffff00',
  green: '#00ff00',
  blue: '#0000ff',
  red: '#ff0000',
  orange: '#ff8000',
  black: '#000000',
  white: '#ffffff',
  pink: '#ff69b4',
  purple: '#800080',
};

function findTargetColor(text: string): string | null {
  for (const [colorName, hexColor] of Object.entries(TARGET_COLOR_MAP)) {
    if (new RegExp(`\\b${colorName}\\b`).test(text)) {
      return hexColor;
    }
  }
  return null;
}

function findShader(text: string): Shader | null {
  for (const token of SHADER_TOKENS) {
    if (text.includes(token)) {
      return SHADER_MAP[token];
    }
  }
  return null;
}

function findInputType(text: string): InputType | null {
  for (const [token, type] of Object.entries(INPUT_TYPE_MAP)) {
    if (new RegExp(`\\b${token}\\b`).test(text)) {
      return type;
    }
  }
  return null;
}

function findInputIndex(text: string): number | null {
  const match = text.match(/\binput\s+(\d+)\b/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return null;
}

function findDirection(text: string): Direction | null {
  for (const [word, dir] of Object.entries(DIRECTION_MAP)) {
    if (new RegExp(`\\b${word}\\b`).test(text)) {
      return dir;
    }
  }
  return null;
}

function findSteps(text: string): number {
  const patterns = [
    /\b(up|down)\s+(\d+)\b/,
    /\bby\s+(\d+)\b/,
    /\b(\d+)\s+steps?\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const numStr = match[2] || match[1];
      const parsed = parseInt(numStr, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return 1;
}

function clarify(missing: string[], question: string): VoiceCommand {
  return { intent: 'CLARIFY', missing, question };
}

export function parseCommand(rawText: string): VoiceCommand | null {
  const text = normalize(rawText);

  if (!text || text.length < 2) {
    return null;
  }

  if (START_ROOM_PATTERN.test(text)) {
    return { intent: 'START_ROOM' };
  }

  if (NEXT_LAYOUT_PATTERN.test(text)) {
    return { intent: 'NEXT_LAYOUT' };
  }

  if (PREVIOUS_LAYOUT_PATTERN.test(text)) {
    return { intent: 'PREVIOUS_LAYOUT' };
  }

  if (EXPORT_CONFIG_PATTERN.test(text)) {
    return { intent: 'EXPORT_CONFIGURATION' };
  }

  const colorMatch = text.match(SET_COLOR_PATTERN);
  if (colorMatch) {
    const colorName = colorMatch[1].toLowerCase();
    const hexColor = TEXT_COLOR_MAP[colorName];
    if (hexColor) {
      return { intent: 'SET_TEXT_COLOR', color: hexColor };
    }
  }

  const maxLinesMatch = text.match(SET_MAX_LINES_PATTERN);
  if (maxLinesMatch) {
    const maxLines = parseInt(maxLinesMatch[1], 10);
    if (maxLines >= 1 && maxLines <= 20) {
      return { intent: 'SET_TEXT_MAX_LINES', maxLines };
    }
  }

  const hasRemove = REMOVE_VERBS.test(text);
  const hasAdd = ADD_VERBS.test(text);
  const hasMove = MOVE_VERBS.test(text);
  const hasSelect = SELECT_VERBS.test(text);
  const hasDeselect = DESELECT_VERBS.test(text);

  const shader = findShader(text);
  const inputType = findInputType(text);
  const inputIndex = findInputIndex(text);
  const direction = findDirection(text);
  const steps = findSteps(text);

  const hasShader = shader !== null;
  const hasInputKeyword = /\binput\b/.test(text);
  const hasShaderKeyword = /\bshader\b/.test(text);
  const hasEffectKeyword = /\beffect\b/.test(text);
  const isAddingRemoveColorShader = isRemoveColorShaderContext(text);

  if (hasRemove && hasShader && !isAddingRemoveColorShader) {
    return { intent: 'REMOVE_SHADER', inputIndex, shader };
  }

  if ((hasAdd || hasShaderKeyword || isAddingRemoveColorShader) && hasShader) {
    if (shader === 'remove-color') {
      const targetColor = findTargetColor(text);
      if (targetColor) {
        return { intent: 'ADD_SHADER', inputIndex, shader, targetColor };
      }
    }
    return { intent: 'ADD_SHADER', inputIndex, shader };
  }

  // If "effect" or "shader" keyword is present but shader not found, don't do anything
  // This protects inputs from being removed when user meant to remove an effect
  if ((hasShaderKeyword || hasEffectKeyword) && !hasShader) {
    return null;
  }

  if (hasRemove && hasInputKeyword && !hasShader) {
    if (inputIndex === null) {
      return clarify(['inputIndex'], 'Which input number?');
    }
    return { intent: 'REMOVE_INPUT', inputIndex };
  }

  if (hasMove && inputIndex !== null) {
    if (direction === null) {
      return clarify(['direction'], 'Up or down?');
    }
    return { intent: 'MOVE_INPUT', inputIndex, direction, steps };
  }

  if (hasAdd && inputType !== null) {
    return { intent: 'ADD_INPUT', inputType };
  }

  if (hasShaderKeyword && !hasShader && inputIndex !== null) {
    return clarify(['shader'], 'Which shader?');
  }

  if (hasAdd && hasInputKeyword && !hasShader && !inputType) {
    return clarify(['inputType'], 'Which input type: stream, mp4, image, text, camera, screenshare?');
  }

  if (STOP_TYPING_PATTERN.test(text)) {
    return { intent: 'STOP_TYPING' };
  }

  if (START_TYPING_PATTERN.test(text)) {
    return { intent: 'START_TYPING' };
  }

  if (hasDeselect) {
    return { intent: 'DESELECT_INPUT' };
  }

  if (hasSelect && hasInputKeyword) {
    if (inputIndex === null) {
      return clarify(['inputIndex'], 'Which input number?');
    }
    return { intent: 'SELECT_INPUT', inputIndex };
  }

  return null;
}
