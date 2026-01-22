export const Shader = {
  OPACITY: 'OPACITY',
  GRAYSCALE: 'GRAYSCALE',
  BRIGHTNESS: 'BRIGHTNESS',
  CONTRAST: 'CONTRAST',
  WRAPPED: 'WRAPPED',
  REMOVE_COLOR: 'REMOVE_COLOR',
  ORBITING: 'ORBITING',
  HOLOGRAM: 'HOLOGRAM',
  SHADOW: 'SHADOW',
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

export type AddInputCommand = {
  intent: 'ADD_INPUT';
  inputType: InputType;
};

export type MoveInputCommand = {
  intent: 'MOVE_INPUT';
  inputIndex: number;
  direction: Direction;
  steps?: number;
};

export type AddShaderCommand = {
  intent: 'ADD_SHADER';
  inputIndex: number;
  shader: Shader;
};

export type RemoveShaderCommand = {
  intent: 'REMOVE_SHADER';
  inputIndex: number;
  shader: Shader;
};

export type RemoveInputCommand = {
  intent: 'REMOVE_INPUT';
  inputIndex: number;
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
      if (typeof c.inputType === 'string' && Object.values(InputType).includes(c.inputType as InputType)) {
        return { intent: 'ADD_INPUT', inputType: c.inputType as InputType };
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
        typeof c.inputIndex === 'number' &&
        typeof c.shader === 'string' &&
        Object.values(Shader).includes(c.shader as Shader)
      ) {
        return { intent: 'ADD_SHADER', inputIndex: c.inputIndex, shader: c.shader as Shader };
      }
      return null;

    case 'REMOVE_SHADER':
      if (
        typeof c.inputIndex === 'number' &&
        typeof c.shader === 'string' &&
        Object.values(Shader).includes(c.shader as Shader)
      ) {
        return { intent: 'REMOVE_SHADER', inputIndex: c.inputIndex, shader: c.shader as Shader };
      }
      return null;

    case 'REMOVE_INPUT':
      if (typeof c.inputIndex === 'number') {
        return { intent: 'REMOVE_INPUT', inputIndex: c.inputIndex };
      }
      return null;

    case 'CLARIFY':
      if (Array.isArray(c.missing) && typeof c.question === 'string') {
        return { intent: 'CLARIFY', missing: c.missing as string[], question: c.question };
      }
      return null;

    default:
      return null;
  }
}
