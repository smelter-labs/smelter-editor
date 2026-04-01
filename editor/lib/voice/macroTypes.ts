import type { InputType, Shader, Direction } from './commandTypes';

export type MacroActionParams = {
  inputType?: InputType;
  inputIndex?: number;
  inputId?: string;
  trackIndex?: number;
  shader?: Shader;
  direction?: Direction;
  steps?: number;
  layout?: string;
  color?: string;
  maxLines?: number;
  fontSize?: number;
  scrollSpeed?: number;
  targetColor?: string;
  shaderParams?: Record<string, number | string>;
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
  mp4Name?: string;
  imageName?: string;
  enabled?: boolean;
  durationMs?: number;
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
  | 'SELECT_TRACK'
  | 'REMOVE_TRACK'
  | 'NEXT_BLOCK'
  | 'PREV_BLOCK'
  | 'NEXT_LAYOUT'
  | 'PREVIOUS_LAYOUT'
  | 'SET_LAYOUT'
  | 'SET_TEXT_COLOR'
  | 'SET_TEXT_MAX_LINES'
  | 'SET_TEXT_FONT_SIZE'
  | 'SET_TEXT_SCROLL_SPEED'
  | 'SET_TEXT_ALIGN'
  | 'SET_TEXT'
  | 'START_RECORDING'
  | 'STOP_RECORDING'
  | 'SET_SWAP_DURATION'
  | 'SET_SWAP_FADE_IN_DURATION'
  | 'SET_SWAP_FADE_OUT_DURATION'
  | 'SET_SWAP_OUTGOING_ENABLED'
  | 'SET_NEWS_STRIP_ENABLED'
  | 'SET_NEWS_STRIP_FADE_DURING_SWAP';

export type MacroDefinition = {
  id: string;
  triggers: string[];
  description: string;
  steps: MacroStep[];
  continueListening?: boolean;
};

export type MacrosConfig = {
  macros: MacroDefinition[];
};

type MacroState = {
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
