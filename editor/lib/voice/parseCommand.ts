import { normalize } from './normalize';
import type {
  VoiceCommand,
  Shader,
  InputType,
  Direction,
} from './commandTypes';

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export type FileMatchResult = {
  file: string;
  query: string;
  similarity: number;
  matchType: 'substring' | 'fuzzy';
} | null;

function findBestFileMatch(
  query: string,
  files: string[],
  extensionPattern: RegExp,
): FileMatchResult {
  if (!query || files.length === 0) return null;

  const normalizedQuery = query.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalizedQuery) return null;

  let bestMatch: FileMatchResult = null;
  let bestScore = Infinity;

  for (const file of files) {
    const baseName = file
      .replace(extensionPattern, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

    if (
      baseName.includes(normalizedQuery) ||
      normalizedQuery.includes(baseName)
    ) {
      const score = Math.abs(baseName.length - normalizedQuery.length);
      if (score < bestScore) {
        bestScore = score;
        const similarity =
          1 - score / Math.max(baseName.length, normalizedQuery.length);
        bestMatch = {
          file,
          query: normalizedQuery,
          similarity,
          matchType: 'substring',
        };
      }
    } else {
      const distance = levenshtein(normalizedQuery, baseName);
      const maxLen = Math.max(normalizedQuery.length, baseName.length);
      const similarity = 1 - distance / maxLen;

      if (similarity > 0.4 && distance < bestScore) {
        bestScore = distance;
        bestMatch = {
          file,
          query: normalizedQuery,
          similarity,
          matchType: 'fuzzy',
        };
      }
    }
  }
  return bestMatch;
}

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
  stroke: 'alpha-stroke',
  'alpha stroke': 'alpha-stroke',
  outline: 'alpha-stroke',
};

const SHADER_TOKENS = Object.keys(SHADER_MAP).sort(
  (a, b) => b.length - a.length,
);

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
const START_TYPING_PATTERN =
  /\b(start typing|begin typing|start dictation|begin dictation)\b/;
const STOP_TYPING_PATTERN =
  /\b(stop typing|end typing|stop dictation|end dictation|finish typing)\b/;
const START_ROOM_PATTERN =
  /\b(start|starts|open|create|new|starting)\s+(a\s+)?(new\s+)?(in\s+)?(your\s+)?room\b/;
const NEXT_LAYOUT_PATTERN = /\b(next|forward)\s+(layout|view)\b/;
const PREVIOUS_LAYOUT_PATTERN = /\b(previous|prev|back|last)\s+(layout|view)\b/;
const SET_COLOR_PATTERN =
  /\b(?:set|change)\s+(?:text\s+)?colou?r\s+(?:to\s+)?(\w+)\b/;
const SET_MAX_LINES_PATTERN =
  /\b(?:set|change)\s+(?:max(?:imum)?\s+)?lines?\s+(?:to\s+)?(\d+)\b/;
const EXPORT_CONFIG_PATTERN =
  /\b(export|save|download)\s+(config(?:uration)?|settings)\b/;

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
  return (
    text.includes('remove color') &&
    (ADD_VERBS.test(text) || /\bto\b/.test(text) || /\bon\b/.test(text))
  );
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

export type ParseCommandOptions = {
  mp4Files?: string[];
  imageFiles?: string[];
};

export function parseCommand(
  rawText: string,
  options: ParseCommandOptions = {},
): VoiceCommand | null {
  const { mp4Files = [], imageFiles = [] } = options;
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
    if (inputType === 'mp4') {
      console.log(
        '[Voice] Parsing mp4 command, available files:',
        mp4Files.length,
        mp4Files,
      );
      const mp4Match = text.match(
        /\bmp4\s+(?:(?:source|input|file|video|called|named)\s+)*(.+)$/,
      );
      console.log('[Voice] Regex match result:', mp4Match);
      if (mp4Match && mp4Files.length > 0) {
        const queryWord = mp4Match[1].trim();
        console.log('[Voice] Query word:', queryWord);
        const matchResult = findBestFileMatch(queryWord, mp4Files, /\.mp4$/i);
        console.log('[Voice] Match result:', matchResult);
        if (matchResult) {
          return {
            intent: 'ADD_INPUT',
            inputType,
            mp4FileName: matchResult.file,
            mp4MatchInfo: {
              query: matchResult.query,
              file: matchResult.file,
              similarity: matchResult.similarity,
              matchType: matchResult.matchType,
            },
          };
        }
      }
    }
    if (inputType === 'image' && imageFiles.length > 0) {
      const imageMatch = text.match(
        /\bimage\s+(?:(?:source|input|file|picture|photo|called|named)\s+)*(.+)$/,
      );
      if (imageMatch) {
        const queryWord = imageMatch[1].trim();
        const matchResult = findBestFileMatch(
          queryWord,
          imageFiles,
          /\.(png|jpg|jpeg|gif|webp|svg)$/i,
        );
        if (matchResult) {
          return {
            intent: 'ADD_INPUT',
            inputType,
            imageFileName: matchResult.file,
            imageMatchInfo: {
              query: matchResult.query,
              file: matchResult.file,
              similarity: matchResult.similarity,
              matchType: matchResult.matchType,
            },
          };
        }
      }
    }
    return { intent: 'ADD_INPUT', inputType };
  }

  if (hasShaderKeyword && !hasShader && inputIndex !== null) {
    return clarify(['shader'], 'Which shader?');
  }

  if (hasAdd && hasInputKeyword && !hasShader && !inputType) {
    return clarify(
      ['inputType'],
      'Which input type: stream, mp4, image, text, camera, screenshare?',
    );
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
