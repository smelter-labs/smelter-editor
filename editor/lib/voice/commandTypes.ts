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

export type SelectTrackCommand = {
  intent: 'SELECT_TRACK';
  trackIndex: number;
};

export type RemoveTrackCommand = {
  intent: 'REMOVE_TRACK';
  trackIndex: number;
};

export type NextBlockCommand = {
  intent: 'NEXT_BLOCK';
};

export type PrevBlockCommand = {
  intent: 'PREV_BLOCK';
};

export type StartTypingCommand = {
  intent: 'START_TYPING';
};

export type StopTypingCommand = {
  intent: 'STOP_TYPING';
};

export type StartRoomCommand = {
  intent: 'START_ROOM';
  vertical?: boolean;
};

export type NextLayoutCommand = {
  intent: 'NEXT_LAYOUT';
};

export type PreviousLayoutCommand = {
  intent: 'PREVIOUS_LAYOUT';
};

export type SetLayoutCommand = {
  intent: 'SET_LAYOUT';
  layout:
    | 'grid'
    | 'primary-on-left'
    | 'primary-on-top'
    | 'picture-in-picture'
    | 'wrapped'
    | 'wrapped-static'
    | 'picture-on-picture';
};

export type SetTextColorCommand = {
  intent: 'SET_TEXT_COLOR';
  color: string;
};

export type SetTextMaxLinesCommand = {
  intent: 'SET_TEXT_MAX_LINES';
  maxLines: number;
};

export type SetTextFontSizeCommand = {
  intent: 'SET_TEXT_FONT_SIZE';
  fontSize: number;
};

export type SetTextScrollSpeedCommand = {
  intent: 'SET_TEXT_SCROLL_SPEED';
  scrollSpeed: number;
};

export type SetTextAlignCommand = {
  intent: 'SET_TEXT_ALIGN';
  textAlign: 'left' | 'center' | 'right';
};

export type ExportConfigurationCommand = {
  intent: 'EXPORT_CONFIGURATION';
};

export type ScrollTextCommand = {
  intent: 'SCROLL_TEXT';
  direction: Direction;
  lines: number;
};

export type HideAllInputsCommand = {
  intent: 'HIDE_ALL_INPUTS';
};

export type RemoveAllInputsCommand = {
  intent: 'REMOVE_ALL_INPUTS';
};

export type StartRecordingCommand = {
  intent: 'START_RECORDING';
};

export type StopRecordingCommand = {
  intent: 'STOP_RECORDING';
};

export type SetSwapDurationCommand = {
  intent: 'SET_SWAP_DURATION';
  durationMs: number;
};

export type SetSwapFadeInDurationCommand = {
  intent: 'SET_SWAP_FADE_IN_DURATION';
  durationMs: number;
};

export type SetSwapFadeOutDurationCommand = {
  intent: 'SET_SWAP_FADE_OUT_DURATION';
  durationMs: number;
};

export type SetSwapOutgoingEnabledCommand = {
  intent: 'SET_SWAP_OUTGOING_ENABLED';
  enabled: boolean;
};

export type SetNewsStripEnabledCommand = {
  intent: 'SET_NEWS_STRIP_ENABLED';
  enabled: boolean;
};

export type SetNewsStripFadeDuringSwapCommand = {
  intent: 'SET_NEWS_STRIP_FADE_DURING_SWAP';
  enabled: boolean;
};

export type InputOrientation = 'horizontal' | 'vertical';

export type SetOrientationCommand = {
  intent: 'SET_ORIENTATION';
  orientation?: InputOrientation;
  inputIndex?: number;
};

export type SetDefaultOrientationCommand = {
  intent: 'SET_DEFAULT_ORIENTATION';
  orientation: InputOrientation;
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
  | SelectTrackCommand
  | RemoveTrackCommand
  | NextBlockCommand
  | PrevBlockCommand
  | StartTypingCommand
  | StopTypingCommand
  | StartRoomCommand
  | NextLayoutCommand
  | PreviousLayoutCommand
  | SetLayoutCommand
  | SetTextColorCommand
  | SetTextMaxLinesCommand
  | SetTextFontSizeCommand
  | SetTextScrollSpeedCommand
  | SetTextAlignCommand
  | ExportConfigurationCommand
  | ScrollTextCommand
  | HideAllInputsCommand
  | RemoveAllInputsCommand
  | StartRecordingCommand
  | StopRecordingCommand
  | SetSwapDurationCommand
  | SetSwapFadeInDurationCommand
  | SetSwapFadeOutDurationCommand
  | SetSwapOutgoingEnabledCommand
  | SetNewsStripEnabledCommand
  | SetNewsStripFadeDuringSwapCommand
  | SetOrientationCommand
  | SetDefaultOrientationCommand
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

    case 'SELECT_TRACK':
      if (typeof c.trackIndex === 'number') {
        return { intent: 'SELECT_TRACK', trackIndex: c.trackIndex };
      }
      return null;

    case 'REMOVE_TRACK':
      if (typeof c.trackIndex === 'number') {
        return { intent: 'REMOVE_TRACK', trackIndex: c.trackIndex };
      }
      return null;

    case 'NEXT_BLOCK':
      return { intent: 'NEXT_BLOCK' };

    case 'PREV_BLOCK':
      return { intent: 'PREV_BLOCK' };

    case 'START_TYPING':
      return { intent: 'START_TYPING' };

    case 'STOP_TYPING':
      return { intent: 'STOP_TYPING' };

    case 'START_ROOM':
      return {
        intent: 'START_ROOM',
        vertical: c.vertical === true ? true : undefined,
      };

    case 'NEXT_LAYOUT':
      return { intent: 'NEXT_LAYOUT' };

    case 'PREVIOUS_LAYOUT':
      return { intent: 'PREVIOUS_LAYOUT' };

    case 'SET_LAYOUT':
      if (typeof c.layout === 'string') {
        return {
          intent: 'SET_LAYOUT',
          layout: c.layout as SetLayoutCommand['layout'],
        };
      }
      return null;

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

    case 'SET_TEXT_FONT_SIZE':
      if (typeof c.fontSize === 'number') {
        return { intent: 'SET_TEXT_FONT_SIZE', fontSize: c.fontSize };
      }
      return null;

    case 'SET_TEXT_SCROLL_SPEED':
      if (typeof c.scrollSpeed === 'number') {
        return { intent: 'SET_TEXT_SCROLL_SPEED', scrollSpeed: c.scrollSpeed };
      }
      return null;

    case 'SET_TEXT_ALIGN':
      if (
        typeof c.textAlign === 'string' &&
        ['left', 'center', 'right'].includes(c.textAlign)
      ) {
        return {
          intent: 'SET_TEXT_ALIGN',
          textAlign: c.textAlign as 'left' | 'center' | 'right',
        };
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

    case 'HIDE_ALL_INPUTS':
      return { intent: 'HIDE_ALL_INPUTS' };

    case 'REMOVE_ALL_INPUTS':
      return { intent: 'REMOVE_ALL_INPUTS' };

    case 'START_RECORDING':
      return { intent: 'START_RECORDING' };

    case 'STOP_RECORDING':
      return { intent: 'STOP_RECORDING' };

    case 'SET_SWAP_DURATION':
      if (typeof c.durationMs === 'number') {
        return { intent: 'SET_SWAP_DURATION', durationMs: c.durationMs };
      }
      return null;

    case 'SET_SWAP_FADE_IN_DURATION':
      if (typeof c.durationMs === 'number') {
        return {
          intent: 'SET_SWAP_FADE_IN_DURATION',
          durationMs: c.durationMs,
        };
      }
      return null;

    case 'SET_SWAP_FADE_OUT_DURATION':
      if (typeof c.durationMs === 'number') {
        return {
          intent: 'SET_SWAP_FADE_OUT_DURATION',
          durationMs: c.durationMs,
        };
      }
      return null;

    case 'SET_SWAP_OUTGOING_ENABLED':
      if (typeof c.enabled === 'boolean') {
        return { intent: 'SET_SWAP_OUTGOING_ENABLED', enabled: c.enabled };
      }
      return null;

    case 'SET_NEWS_STRIP_ENABLED':
      if (typeof c.enabled === 'boolean') {
        return { intent: 'SET_NEWS_STRIP_ENABLED', enabled: c.enabled };
      }
      return null;

    case 'SET_NEWS_STRIP_FADE_DURING_SWAP':
      if (typeof c.enabled === 'boolean') {
        return {
          intent: 'SET_NEWS_STRIP_FADE_DURING_SWAP',
          enabled: c.enabled,
        };
      }
      return null;

    case 'SET_ORIENTATION': {
      const result: SetOrientationCommand = { intent: 'SET_ORIENTATION' };
      if (c.orientation === 'horizontal' || c.orientation === 'vertical') {
        result.orientation = c.orientation;
      }
      if (typeof c.inputIndex === 'number') {
        result.inputIndex = c.inputIndex;
      }
      return result;
    }

    case 'SET_DEFAULT_ORIENTATION':
      if (c.orientation === 'horizontal' || c.orientation === 'vertical') {
        return {
          intent: 'SET_DEFAULT_ORIENTATION',
          orientation: c.orientation,
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
