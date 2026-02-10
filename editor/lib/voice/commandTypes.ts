export const Shader = {
  ASCII: 'ascii-filter',
  GRAYSCALE: 'grayscale',
  OPACITY: 'opacity',
  BRIGHTNESS_CONTRAST: 'brightness-contrast',
  WRAPPED: 'circle-mask-outline',
  REMOVE_COLOR: 'remove-color',
  ORBITING: 'orbiting',
  STAR_STREAKS: 'star-streaks',
  SHADOW: 'soft-shadow',
  HOLOGRAM: 'sw-hologram',
  PERSPECTIVE: 'perspective',
  ALPHA_STROKE: 'alpha-stroke',
} as const;

export type Shader = (typeof Shader)[keyof typeof Shader];

export const InputType = {
  STREAM: 'stream',
  MP4: 'mp4',
  IMAGE: 'image',
  TEXT: 'text',
  CAMERA: 'camera',
  SCREENSHARE: 'screenshare',
} as const;

export type InputType = (typeof InputType)[keyof typeof InputType];

export const Direction = {
  UP: 'UP',
  DOWN: 'DOWN',
} as const;

export type Direction = (typeof Direction)[keyof typeof Direction];

export type FileMatchInfo = {
  query: string;
  file: string;
  similarity: number;
  matchType: 'substring' | 'fuzzy';
};

export type AddInputCommand = {
  intent: 'ADD_INPUT';
  inputType: InputType;
  mp4FileName?: string;
  mp4MatchInfo?: FileMatchInfo;
  imageFileName?: string;
  imageMatchInfo?: FileMatchInfo;
};

export type MoveInputCommand = {
  intent: 'MOVE_INPUT';
  inputIndex: number;
  direction: Direction;
  steps?: number;
};

export type AddShaderCommand = {
  intent: 'ADD_SHADER';
  inputIndex: number | null;
  shader: Shader;
  targetColor?: string;
};

export type RemoveShaderCommand = {
  intent: 'REMOVE_SHADER';
  inputIndex: number | null;
  shader: Shader;
};

export type RemoveInputCommand = {
  intent: 'REMOVE_INPUT';
  inputIndex: number;
};

export type SelectInputCommand = {
  intent: 'SELECT_INPUT';
  inputIndex: number;
};

export type DeselectInputCommand = {
  intent: 'DESELECT_INPUT';
};

export type StartTypingCommand = {
  intent: 'START_TYPING';
};

export type StopTypingCommand = {
  intent: 'STOP_TYPING';
};

export type StartRoomCommand = {
  intent: 'START_ROOM';
};

export type NextLayoutCommand = {
  intent: 'NEXT_LAYOUT';
};

export type PreviousLayoutCommand = {
  intent: 'PREVIOUS_LAYOUT';
};

export type SetTextColorCommand = {
  intent: 'SET_TEXT_COLOR';
  color: string;
};

export type SetTextMaxLinesCommand = {
  intent: 'SET_TEXT_MAX_LINES';
  maxLines: number;
};

export type ExportConfigurationCommand = {
  intent: 'EXPORT_CONFIGURATION';
};

export type ScrollTextCommand = {
  intent: 'SCROLL_TEXT';
  direction: Direction;
  lines: number;
};

export type ClarifyCommand = {
  intent: 'CLARIFY';
  missing: string[];
  question: string;
};

export type VoiceCommand =
  | AddInputCommand
  | MoveInputCommand
  | AddShaderCommand
  | RemoveShaderCommand
  | RemoveInputCommand
  | SelectInputCommand
  | DeselectInputCommand
  | StartTypingCommand
  | StopTypingCommand
  | StartRoomCommand
  | NextLayoutCommand
  | PreviousLayoutCommand
  | SetTextColorCommand
  | SetTextMaxLinesCommand
  | ExportConfigurationCommand
  | ScrollTextCommand
  | ClarifyCommand;

export type VoiceInput = {
  id: string;
  type: InputType;
  shaders: Shader[];
};

export function validateCommand(cmd: unknown): VoiceCommand | null {
  if (!cmd || typeof cmd !== 'object') return null;
  const c = cmd as Record<string, unknown>;

  switch (c.intent) {
    case 'ADD_INPUT':
      if (
        typeof c.inputType === 'string' &&
        Object.values(InputType).includes(c.inputType as InputType)
      ) {
        const result: AddInputCommand = {
          intent: 'ADD_INPUT',
          inputType: c.inputType as InputType,
        };
        if (typeof c.mp4FileName === 'string') {
          result.mp4FileName = c.mp4FileName;
        }
        if (c.mp4MatchInfo && typeof c.mp4MatchInfo === 'object') {
          const info = c.mp4MatchInfo as Record<string, unknown>;
          if (
            typeof info.query === 'string' &&
            typeof info.file === 'string' &&
            typeof info.similarity === 'number'
          ) {
            result.mp4MatchInfo = {
              query: info.query,
              file: info.file,
              similarity: info.similarity,
              matchType: info.matchType === 'substring' ? 'substring' : 'fuzzy',
            };
          }
        }
        if (typeof c.imageFileName === 'string') {
          result.imageFileName = c.imageFileName;
        }
        if (c.imageMatchInfo && typeof c.imageMatchInfo === 'object') {
          const info = c.imageMatchInfo as Record<string, unknown>;
          if (
            typeof info.query === 'string' &&
            typeof info.file === 'string' &&
            typeof info.similarity === 'number'
          ) {
            result.imageMatchInfo = {
              query: info.query,
              file: info.file,
              similarity: info.similarity,
              matchType: info.matchType === 'substring' ? 'substring' : 'fuzzy',
            };
          }
        }
        return result;
      }
      return null;

    case 'MOVE_INPUT':
      if (
        typeof c.inputIndex === 'number' &&
        typeof c.direction === 'string' &&
        Object.values(Direction).includes(c.direction as Direction)
      ) {
        return {
          intent: 'MOVE_INPUT',
          inputIndex: c.inputIndex,
          direction: c.direction as Direction,
          steps: typeof c.steps === 'number' ? c.steps : 1,
        };
      }
      return null;

    case 'ADD_SHADER':
      if (
        (typeof c.inputIndex === 'number' || c.inputIndex === null) &&
        typeof c.shader === 'string' &&
        Object.values(Shader).includes(c.shader as Shader)
      ) {
        const result: AddShaderCommand = {
          intent: 'ADD_SHADER',
          inputIndex: c.inputIndex as number | null,
          shader: c.shader as Shader,
        };
        if (typeof c.targetColor === 'string') {
          result.targetColor = c.targetColor;
        }
        return result;
      }
      return null;

    case 'REMOVE_SHADER':
      if (
        (typeof c.inputIndex === 'number' || c.inputIndex === null) &&
        typeof c.shader === 'string' &&
        Object.values(Shader).includes(c.shader as Shader)
      ) {
        return {
          intent: 'REMOVE_SHADER',
          inputIndex: c.inputIndex as number | null,
          shader: c.shader as Shader,
        };
      }
      return null;

    case 'REMOVE_INPUT':
      if (typeof c.inputIndex === 'number') {
        return { intent: 'REMOVE_INPUT', inputIndex: c.inputIndex };
      }
      return null;

    case 'SELECT_INPUT':
      if (typeof c.inputIndex === 'number') {
        return { intent: 'SELECT_INPUT', inputIndex: c.inputIndex };
      }
      return null;

    case 'DESELECT_INPUT':
      return { intent: 'DESELECT_INPUT' };

    case 'START_TYPING':
      return { intent: 'START_TYPING' };

    case 'STOP_TYPING':
      return { intent: 'STOP_TYPING' };

    case 'START_ROOM':
      return { intent: 'START_ROOM' };

    case 'NEXT_LAYOUT':
      return { intent: 'NEXT_LAYOUT' };

    case 'PREVIOUS_LAYOUT':
      return { intent: 'PREVIOUS_LAYOUT' };

    case 'SET_TEXT_COLOR':
      if (typeof c.color === 'string') {
        return { intent: 'SET_TEXT_COLOR', color: c.color };
      }
      return null;

    case 'SET_TEXT_MAX_LINES':
      if (typeof c.maxLines === 'number') {
        return { intent: 'SET_TEXT_MAX_LINES', maxLines: c.maxLines };
      }
      return null;

    case 'EXPORT_CONFIGURATION':
      return { intent: 'EXPORT_CONFIGURATION' };

    case 'SCROLL_TEXT':
      if (
        typeof c.direction === 'string' &&
        Object.values(Direction).includes(c.direction as Direction) &&
        typeof c.lines === 'number'
      ) {
        return {
          intent: 'SCROLL_TEXT',
          direction: c.direction as Direction,
          lines: c.lines,
        };
      }
      return null;

    case 'CLARIFY':
      if (Array.isArray(c.missing) && typeof c.question === 'string') {
        return {
          intent: 'CLARIFY',
          missing: c.missing as string[],
          question: c.question,
        };
      }
      return null;

    default:
      return null;
  }
}
