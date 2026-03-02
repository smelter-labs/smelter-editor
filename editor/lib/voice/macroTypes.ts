import type { InputType, Shader, Direction } from './commandTypes';

export type MacroActionParams = {
  inputType?: InputType;
  inputIndex?: number;
  shader?: Shader;
  direction?: Direction;
  steps?: number;
  layout?: string;
  color?: string;
  maxLines?: number;
  fontSize?: number;
  targetColor?: string;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  mp4Name?: string;
  imageName?: string;
};

export type MacroStep = {
  action: MacroAction;
  params?: MacroActionParams;
  delayAfterMs: number;
};

export type MacroAction =
  | 'ADD_INPUT'
  | 'REMOVE_INPUT'
  | 'HIDE_ALL_INPUTS'
  | 'REMOVE_ALL_INPUTS'
  | 'MOVE_INPUT'
  | 'ADD_SHADER'
  | 'REMOVE_SHADER'
  | 'SELECT_INPUT'
  | 'DESELECT_INPUT'
  | 'NEXT_LAYOUT'
  | 'PREVIOUS_LAYOUT'
  | 'SET_LAYOUT'
  | 'SET_TEXT_COLOR'
  | 'SET_TEXT_MAX_LINES'
  | 'SET_TEXT_FONT_SIZE'
  | 'SET_TEXT';

export type MacroDefinition = {
  id: string;
  triggers: string[];
  description: string;
  steps: MacroStep[];
};

export type MacrosConfig = {
  macros: MacroDefinition[];
};

export type MacroState = {
  isListening: boolean;
  activeMacro: MacroDefinition | null;
  isExecuting: boolean;
  currentStepIndex: number;
  autoPlay: boolean;
  executionStatus:
    | 'idle'
    | 'running'
    | 'paused'
    | 'completed'
    | 'stopped'
    | 'error';
};
