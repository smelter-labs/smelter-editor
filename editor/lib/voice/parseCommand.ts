import { normalize } from './normalize';
import type { VoiceCommand, Shader, InputType, Direction } from './commandTypes';

const SHADER_MAP: Record<string, Shader> = {
  opacity: 'OPACITY',
  grayscale: 'GRAYSCALE',
  brightness: 'BRIGHTNESS',
  contrast: 'CONTRAST',
  wrapped: 'WRAPPED',
  'remove color': 'REMOVE_COLOR',
  orbiting: 'ORBITING',
  hologram: 'HOLOGRAM',
  shadow: 'SHADOW',
};

const SHADER_TOKENS = Object.keys(SHADER_MAP).sort((a, b) => b.length - a.length);

const INPUT_TYPE_MAP: Record<string, InputType> = {
  stream: 'stream',
  mp4: 'mp4',
  image: 'image',
  text: 'text',
  camera: 'camera',
  screenshare: 'screenshare',
};

const DIRECTION_MAP: Record<string, Direction> = {
  up: 'UP',
  above: 'UP',
  higher: 'UP',
  down: 'DOWN',
  below: 'DOWN',
  lower: 'DOWN',
};

const ADD_VERBS = /\b(add|create|new|apply|put)\b/;
const REMOVE_VERBS = /\b(remove|delete)\b/;
const MOVE_VERBS = /\b(move|swap)\b/;

function isRemoveColorShaderContext(text: string): boolean {
  return text.includes('remove color') && 
    (ADD_VERBS.test(text) || /\bto\b/.test(text) || /\bon\b/.test(text));
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

  const hasRemove = REMOVE_VERBS.test(text);
  const hasAdd = ADD_VERBS.test(text);
  const hasMove = MOVE_VERBS.test(text);

  const shader = findShader(text);
  const inputType = findInputType(text);
  const inputIndex = findInputIndex(text);
  const direction = findDirection(text);
  const steps = findSteps(text);

  const hasShader = shader !== null;
  const hasInputKeyword = /\binput\b/.test(text);
  const hasShaderKeyword = /\bshader\b/.test(text);
  const isAddingRemoveColorShader = isRemoveColorShaderContext(text);

  if (hasRemove && hasShader && !isAddingRemoveColorShader) {
    if (inputIndex === null) {
      return clarify(['inputIndex'], 'Which input number?');
    }
    return { intent: 'REMOVE_SHADER', inputIndex, shader };
  }

  if ((hasAdd || hasShaderKeyword || isAddingRemoveColorShader) && hasShader) {
    if (inputIndex === null) {
      return clarify(['inputIndex'], 'Which input number?');
    }
    return { intent: 'ADD_SHADER', inputIndex, shader };
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

  return null;
}
