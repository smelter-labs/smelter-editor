'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { parseCommand } from './parseCommand';
import { normalize } from './normalize';
import { validateCommand, type VoiceCommand } from './commandTypes';
import {
  findMatchingMacro,
  createMacroExecutionController,
  type MacroExecutionController,
  type MacroExecutionStatus,
  type MacroExecutionCallbacks,
} from './macroExecutor';
import type { MacroDefinition } from './macroTypes';
import { useAutoPlayMacroSetting } from './macroSettings';
import { emitActionFeedback } from './feedbackEvents';

export type UseVoiceCommandsOptions = {
  mp4Files?: string[];
  imageFiles?: string[];
};

export type UseVoiceCommandsResult = {
  lastCommand: VoiceCommand | null;
  lastError: string | null;
  lastClarify: string | null;
  lastSuccess: string | null;
  lastTranscript: string | null;
  lastNormalizedText: string | null;
  isTypingMode: boolean;
  isMacroMode: boolean;
  isExecutingMacro: boolean;
  autoPlayMacro: boolean;
  macroExecutionStatus: MacroExecutionStatus;
  activeMacro: MacroDefinition | null;
  setAutoPlayMacro: (value: boolean) => void;
  executeNextMacroStep: () => Promise<void>;
  playMacro: () => Promise<void>;
  stopMacro: () => void;
  handleTranscript: (text: string) => void;
};

type EmitContext = {
  mp4Files: string[];
  imageFiles: string[];
};

export type MacroControlCommand =
  | 'ENABLE_AUTO_PLAY'
  | 'DISABLE_AUTO_PLAY'
  | 'NEXT_STEP'
  | 'PLAY_MACRO'
  | 'STOP_EXECUTION';

const ENABLE_AUTO_PLAY_PATTERN =
  /\b(enable|turn on)\s+(?:macro\s+)?auto\s*play\b/i;
const DISABLE_AUTO_PLAY_PATTERN =
  /\b(disable|turn off)\s+(?:macro\s+)?auto\s*play\b/i;
const NEXT_STEP_PATTERN =
  /\b(next step|run next step|continue step|step forward)\b/i;
const PLAY_MACRO_PATTERN = /\b(play macro|resume macro|continue macro)\b/i;
const STOP_EXECUTION_PATTERN =
  /\b(stop macro(?: now)?|cancel macro(?: execution)?|abort macro)\b/i;

export function parseMacroControlCommand(
  text: string,
): MacroControlCommand | null {
  const normalized = normalize(text);

  if (ENABLE_AUTO_PLAY_PATTERN.test(normalized)) {
    return 'ENABLE_AUTO_PLAY';
  }
  if (DISABLE_AUTO_PLAY_PATTERN.test(normalized)) {
    return 'DISABLE_AUTO_PLAY';
  }
  if (NEXT_STEP_PATTERN.test(normalized)) {
    return 'NEXT_STEP';
  }
  if (PLAY_MACRO_PATTERN.test(normalized)) {
    return 'PLAY_MACRO';
  }
  if (STOP_EXECUTION_PATTERN.test(normalized)) {
    return 'STOP_EXECUTION';
  }

  return null;
}

function emitVoiceEvent(command: VoiceCommand, ctx: EmitContext) {
  switch (command.intent) {
    case 'ADD_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-input', {
          detail: {
            inputType: command.inputType,
            mp4FileName: command.mp4FileName || ctx.mp4Files[0],
            imageFileName: command.imageFileName || ctx.imageFiles[0],
          },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: `Add Input`,
        description: command.inputType,
      });
      break;
    case 'REMOVE_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-input', {
          detail: { inputIndex: command.inputIndex },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: `Remove Input #${command.inputIndex}`,
      });
      break;
    case 'MOVE_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:move-input', {
          detail: {
            inputIndex: command.inputIndex,
            direction: command.direction.toLowerCase(),
            steps: command.steps ?? 1,
          },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: `Move Input #${command.inputIndex}`,
        description: `${command.direction.toLowerCase()} ${command.steps ?? 1} step(s)`,
      });
      break;
    case 'ADD_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:add-shader', {
          detail: {
            inputIndex: command.inputIndex,
            shader: command.shader,
            targetColor: command.targetColor,
          },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: `Add Shader`,
        description: `${command.shader} on input ${command.inputIndex ?? 'selected'}`,
      });
      break;
    case 'REMOVE_SHADER':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:remove-shader', {
          detail: { inputIndex: command.inputIndex, shader: command.shader },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: `Remove Shader`,
        description: `${command.shader} from input ${command.inputIndex ?? 'selected'}`,
      });
      break;
    case 'SELECT_INPUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:select-input', {
          detail: { inputIndex: command.inputIndex },
        }),
      );
      emitActionFeedback({
        type: 'select',
        label: 'Select Input',
        value: `Input #${command.inputIndex}`,
      });
      break;
    case 'DESELECT_INPUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:deselect-input'));
      emitActionFeedback({
        type: 'action',
        label: 'Deselect Input',
      });
      break;
    case 'START_TYPING':
      window.dispatchEvent(new CustomEvent('smelter:voice:start-typing'));
      emitActionFeedback({
        type: 'mode',
        label: 'Typing Mode',
        active: true,
      });
      break;
    case 'STOP_TYPING':
      window.dispatchEvent(new CustomEvent('smelter:voice:stop-typing'));
      emitActionFeedback({
        type: 'mode',
        label: 'Typing Mode',
        active: false,
      });
      break;
    case 'START_ROOM':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:start-room', {
          detail: { vertical: command.vertical },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: 'Start Room',
        description: command.vertical ? 'vertical' : 'horizontal',
      });
      break;
    case 'NEXT_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:next-layout'));
      emitActionFeedback({
        type: 'action',
        label: 'Next Layout',
      });
      break;
    case 'PREVIOUS_LAYOUT':
      window.dispatchEvent(new CustomEvent('smelter:voice:previous-layout'));
      emitActionFeedback({
        type: 'action',
        label: 'Previous Layout',
      });
      break;
    case 'SET_LAYOUT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-layout', {
          detail: { layout: command.layout },
        }),
      );
      emitActionFeedback({
        type: 'select',
        label: 'Layout',
        value: command.layout,
      });
      break;
    case 'SET_TEXT_COLOR':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-color', {
          detail: { color: command.color },
        }),
      );
      emitActionFeedback({
        type: 'value',
        label: 'Text Color',
        to: command.color,
      });
      break;
    case 'SET_TEXT_MAX_LINES':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-max-lines', {
          detail: { maxLines: command.maxLines },
        }),
      );
      emitActionFeedback({
        type: 'value',
        label: 'Text Max Lines',
        to: command.maxLines,
      });
      break;
    case 'SET_TEXT_FONT_SIZE':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-text-font-size', {
          detail: { fontSize: command.fontSize },
        }),
      );
      emitActionFeedback({
        type: 'value',
        label: 'Font Size',
        to: command.fontSize,
        unit: 'px',
      });
      break;
    case 'EXPORT_CONFIGURATION':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:export-configuration'),
      );
      emitActionFeedback({
        type: 'action',
        label: 'Export Configuration',
      });
      break;
    case 'SCROLL_TEXT':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:scroll-text', {
          detail: {
            direction: command.direction.toLowerCase(),
            lines: command.lines,
          },
        }),
      );
      emitActionFeedback({
        type: 'action',
        label: 'Scroll Text',
        description: `${command.direction.toLowerCase()} ${command.lines} line(s)`,
      });
      break;
    case 'HIDE_ALL_INPUTS':
      window.dispatchEvent(new CustomEvent('smelter:voice:hide-all-inputs'));
      emitActionFeedback({
        type: 'action',
        label: 'Hide All Inputs',
      });
      break;
    case 'REMOVE_ALL_INPUTS':
      window.dispatchEvent(new CustomEvent('smelter:voice:remove-all-inputs'));
      emitActionFeedback({
        type: 'action',
        label: 'Remove All Inputs',
      });
      break;
    case 'START_RECORDING':
      window.dispatchEvent(new CustomEvent('smelter:voice:start-recording'));
      emitActionFeedback({
        type: 'toggle',
        label: 'Recording',
        value: true,
      });
      break;
    case 'STOP_RECORDING':
      window.dispatchEvent(new CustomEvent('smelter:voice:stop-recording'));
      emitActionFeedback({
        type: 'toggle',
        label: 'Recording',
        value: false,
      });
      break;
    case 'SET_SWAP_DURATION':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-swap-duration', {
          detail: { durationMs: command.durationMs },
        }),
      );
      emitActionFeedback({
        type: 'value',
        label: 'Swap Duration',
        to: command.durationMs,
        unit: 'ms',
      });
      break;
    case 'SET_SWAP_FADE_IN_DURATION':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-swap-fade-in-duration', {
          detail: { durationMs: command.durationMs },
        }),
      );
      emitActionFeedback({
        type: 'value',
        label: 'Swap Fade In',
        to: command.durationMs,
        unit: 'ms',
      });
      break;
    case 'SET_SWAP_FADE_OUT_DURATION':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-swap-fade-out-duration', {
          detail: { durationMs: command.durationMs },
        }),
      );
      emitActionFeedback({
        type: 'value',
        label: 'Swap Fade Out',
        to: command.durationMs,
        unit: 'ms',
      });
      break;
    case 'SET_SWAP_OUTGOING_ENABLED':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-swap-outgoing-enabled', {
          detail: { enabled: command.enabled },
        }),
      );
      emitActionFeedback({
        type: 'toggle',
        label: 'Swap Outgoing',
        value: command.enabled,
      });
      break;
    case 'SET_NEWS_STRIP_ENABLED':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-news-strip-enabled', {
          detail: { enabled: command.enabled },
        }),
      );
      emitActionFeedback({
        type: 'toggle',
        label: 'News Strip',
        value: command.enabled,
      });
      break;
    case 'SET_NEWS_STRIP_FADE_DURING_SWAP':
      window.dispatchEvent(
        new CustomEvent('smelter:voice:set-news-strip-fade-during-swap', {
          detail: { enabled: command.enabled },
        }),
      );
      emitActionFeedback({
        type: 'toggle',
        label: 'News Strip Fade During Swap',
        value: command.enabled,
      });
      break;
  }
}

const STOP_TYPING_PATTERN =
  /\b(stop typing|end typing|stop dictation|end dictation|finish typing)\b/i;
const START_MACRO_PATTERN =
  /\bstart\b.*\bmacro\b|\bbegin\b.*\bmacro\b|\bmacro\s+mode\b/i;
const END_MACRO_PATTERN = /\b(end macro|stop macro|cancel macro|exit macro)\b/i;
const TYPING_MODE_SCROLL_DOWN_PATTERN = /\bmove\s+(down(?:\s+down)*)\b/i;
const TYPING_MODE_SCROLL_UP_PATTERN = /\bmove\s+(up(?:\s+up)*)\b/i;
const SPEED_UP_PATTERN = /\bspeed\s+(up(?:\s+up)*)\b/i;
const SPEED_DOWN_PATTERN = /\bspeed\s+(down(?:\s+down)*)\b/i;

export function useVoiceCommands(
  options: UseVoiceCommandsOptions = {},
): UseVoiceCommandsResult {
  const { mp4Files = [], imageFiles = [] } = options;
  const [lastCommand, setLastCommand] = useState<VoiceCommand | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastClarify, setLastClarify] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [lastNormalizedText, setLastNormalizedText] = useState<string | null>(
    null,
  );
  const [isTypingMode, setIsTypingMode] = useState(false);
  const [isMacroMode, setIsMacroMode] = useState(false);
  const [isExecutingMacro, setIsExecutingMacro] = useState(false);
  const [autoPlayMacro, setAutoPlayMacro] = useAutoPlayMacroSetting();
  const [macroExecutionStatus, setMacroExecutionStatus] =
    useState<MacroExecutionStatus>('idle');
  const [activeMacro, setActiveMacro] = useState<MacroDefinition | null>(null);
  const isTypingModeRef = useRef(false);
  const isMacroModeRef = useRef(false);
  const isExecutingMacroRef = useRef(false);
  const autoPlayMacroRef = useRef(autoPlayMacro);
  const macroControllerRef = useRef<MacroExecutionController | null>(null);
  const mp4FilesRef = useRef(mp4Files);
  const imageFilesRef = useRef(imageFiles);

  useEffect(() => {
    mp4FilesRef.current = mp4Files;
  }, [mp4Files]);

  useEffect(() => {
    imageFilesRef.current = imageFiles;
  }, [imageFiles]);

  useEffect(() => {
    autoPlayMacroRef.current = autoPlayMacro;
  }, [autoPlayMacro]);

  useEffect(() => {
    isExecutingMacroRef.current = isExecutingMacro;
  }, [isExecutingMacro]);

  const stopMacro = useCallback(() => {
    macroControllerRef.current?.stop();
  }, []);

  const executeNextMacroStep = useCallback(async () => {
    const controller = macroControllerRef.current;
    if (!controller) return;
    await controller.nextStep();
  }, []);

  const playMacro = useCallback(async () => {
    const controller = macroControllerRef.current;
    if (!controller) return;
    await controller.play();
  }, []);

  const handleTranscript = useCallback((text: string) => {
    setLastError(null);
    setLastClarify(null);
    setLastSuccess(null);
    setLastCommand(null);

    const normalizedText = normalize(text);

    setLastTranscript(text);
    setLastNormalizedText(normalizedText);

    try {
      if (isTypingModeRef.current) {
        if (STOP_TYPING_PATTERN.test(text.toLowerCase())) {
          isTypingModeRef.current = false;
          setIsTypingMode(false);
          setLastCommand({ intent: 'STOP_TYPING' });
          window.dispatchEvent(new CustomEvent('smelter:voice:stop-typing'));
          return;
        }

        const scrollDownMatch = text.match(TYPING_MODE_SCROLL_DOWN_PATTERN);
        if (scrollDownMatch) {
          const downWords = scrollDownMatch[1]
            .split(/\s+/)
            .filter((w) => w.toLowerCase() === 'down');
          window.dispatchEvent(
            new CustomEvent('smelter:voice:scroll-text', {
              detail: { direction: 'down', lines: downWords.length },
            }),
          );
          return;
        }

        const scrollUpMatch = text.match(TYPING_MODE_SCROLL_UP_PATTERN);
        if (scrollUpMatch) {
          const upWords = scrollUpMatch[1]
            .split(/\s+/)
            .filter((w) => w.toLowerCase() === 'up');
          window.dispatchEvent(
            new CustomEvent('smelter:voice:scroll-text', {
              detail: { direction: 'up', lines: upWords.length },
            }),
          );
          return;
        }

        const speedUpMatch = text.match(SPEED_UP_PATTERN);
        if (speedUpMatch) {
          const upWords = speedUpMatch[1]
            .split(/\s+/)
            .filter((w) => w.toLowerCase() === 'up');
          window.dispatchEvent(
            new CustomEvent('smelter:voice:change-scroll-speed', {
              detail: { direction: 'up', steps: upWords.length },
            }),
          );
          return;
        }

        const speedDownMatch = text.match(SPEED_DOWN_PATTERN);
        if (speedDownMatch) {
          const downWords = speedDownMatch[1]
            .split(/\s+/)
            .filter((w) => w.toLowerCase() === 'down');
          window.dispatchEvent(
            new CustomEvent('smelter:voice:change-scroll-speed', {
              detail: { direction: 'down', steps: downWords.length },
            }),
          );
          return;
        }

        window.dispatchEvent(
          new CustomEvent('smelter:voice:append-text', {
            detail: { text },
          }),
        );
        return;
      }

      if (START_MACRO_PATTERN.test(normalizedText)) {
        isMacroModeRef.current = true;
        setIsMacroMode(true);
        setActiveMacro(null);
        window.dispatchEvent(
          new CustomEvent('smelter:voice:macro-mode-started'),
        );
        emitActionFeedback({
          type: 'mode',
          label: 'Macro Mode',
          active: true,
        });
        return;
      }

      const macroControl = parseMacroControlCommand(text);
      if (macroControl === 'ENABLE_AUTO_PLAY') {
        setAutoPlayMacro(true);
        setLastSuccess('AUTO_PLAY_MACRO -> enabled');
        emitActionFeedback({
          type: 'toggle',
          label: 'Macro Auto Play',
          value: true,
        });
        return;
      }
      if (macroControl === 'DISABLE_AUTO_PLAY') {
        setAutoPlayMacro(false);
        setLastSuccess('AUTO_PLAY_MACRO -> disabled');
        emitActionFeedback({
          type: 'toggle',
          label: 'Macro Auto Play',
          value: false,
        });
        return;
      }

      if (
        macroControl &&
        (isMacroModeRef.current || isExecutingMacroRef.current)
      ) {
        const controller = macroControllerRef.current;
        switch (macroControl) {
          case 'NEXT_STEP':
            if (!controller || !isExecutingMacroRef.current) {
              setLastError('No active macro execution for "next step".');
              return;
            }
            controller.nextStep().catch((err) => {
              setLastError(
                err instanceof Error
                  ? err.message
                  : 'Failed to execute next macro step',
              );
            });
            setLastSuccess('MACRO_CONTROL -> next step');
            return;
          case 'PLAY_MACRO':
            if (!controller || !isExecutingMacroRef.current) {
              setLastError('No active macro execution to resume.');
              return;
            }
            controller.play().catch((err) => {
              setLastError(
                err instanceof Error
                  ? err.message
                  : 'Failed to resume macro execution',
              );
            });
            setLastSuccess('MACRO_CONTROL -> play/resume');
            return;
          case 'STOP_EXECUTION':
            if (controller && isExecutingMacroRef.current) {
              controller.stop();
              setLastSuccess('MACRO_CONTROL -> stop');
            } else if (isMacroModeRef.current) {
              isMacroModeRef.current = false;
              setIsMacroMode(false);
              setActiveMacro(null);
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-mode-ended'),
              );
              setLastSuccess('MACRO_MODE -> ended');
            } else {
              setLastError('No active macro execution to stop.');
            }
            return;
        }
      }

      if (isMacroModeRef.current) {
        if (END_MACRO_PATTERN.test(text.toLowerCase())) {
          isMacroModeRef.current = false;
          setIsMacroMode(false);
          setActiveMacro(null);
          window.dispatchEvent(
            new CustomEvent('smelter:voice:macro-mode-ended'),
          );
          return;
        }

        const matchedMacro = findMatchingMacro(text);
        if (matchedMacro) {
          // Stop any running controller first — stop() is sync so onMacroStopped
          // fires and nulls macroControllerRef before we assign the new one below.
          macroControllerRef.current?.stop();
          isMacroModeRef.current = false;
          setIsMacroMode(false);
          setActiveMacro(matchedMacro);
          setIsExecutingMacro(true);
          isExecutingMacroRef.current = true;
          setMacroExecutionStatus('idle');

          const callbacks: MacroExecutionCallbacks = {
            onStepStart: (step, index, total) => {
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-step-start', {
                  detail: { step, index, total, macro: matchedMacro },
                }),
              );
            },
            onStepComplete: (step, index, total) => {
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-step-complete', {
                  detail: { step, index, total, macro: matchedMacro },
                }),
              );
            },
            onMacroComplete: (macro) => {
              macroControllerRef.current = null;
              setIsExecutingMacro(false);
              isExecutingMacroRef.current = false;
              setMacroExecutionStatus('completed');
              setActiveMacro(null);
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-complete', {
                  detail: { macro },
                }),
              );
            },
            onMacroStopped: () => {
              macroControllerRef.current = null;
              setIsExecutingMacro(false);
              isExecutingMacroRef.current = false;
              setMacroExecutionStatus('stopped');
              setActiveMacro(null);
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-stopped'),
              );
            },
            onStatusChange: (status) => {
              setMacroExecutionStatus(status);
            },
            onError: (error, step, index) => {
              macroControllerRef.current = null;
              setIsExecutingMacro(false);
              isExecutingMacroRef.current = false;
              setMacroExecutionStatus('error');
              setActiveMacro(null);
              setLastError(
                `Macro error at step ${index + 1}: ${error.message}`,
              );
              window.dispatchEvent(
                new CustomEvent('smelter:voice:macro-error', {
                  detail: {
                    error: error.message,
                    step,
                    index,
                    macro: matchedMacro,
                  },
                }),
              );
            },
          };

          const controller = createMacroExecutionController(
            matchedMacro,
            callbacks,
            { autoPlay: autoPlayMacroRef.current },
          );
          macroControllerRef.current = controller;
          controller.start().catch((err) => {
            macroControllerRef.current = null;
            setIsExecutingMacro(false);
            isExecutingMacroRef.current = false;
            setMacroExecutionStatus('error');
            setActiveMacro(null);
            setLastError(
              err instanceof Error ? err.message : 'Macro execution failed',
            );
          });

          return;
        }

        setLastError(
          `No macro found for: "${text}". Say the macro trigger or "end macro" to cancel.`,
        );
        return;
      }

      const parsed = parseCommand(text, {
        mp4Files: mp4FilesRef.current,
        imageFiles: imageFilesRef.current,
      });

      if (!parsed) {
        setLastError(`Could not understand: "${text}"`);
        return;
      }

      const validated = validateCommand(parsed);
      if (!validated) {
        setLastError('Invalid command structure');
        return;
      }

      setLastCommand(validated);

      const emitCtx = {
        mp4Files: mp4FilesRef.current,
        imageFiles: imageFilesRef.current,
      };
      if (validated.intent === 'CLARIFY') {
        setLastClarify(validated.question);
      } else if (validated.intent === 'START_TYPING') {
        isTypingModeRef.current = true;
        setIsTypingMode(true);
        emitVoiceEvent(validated, emitCtx);
      } else {
        emitVoiceEvent(validated, emitCtx);
      }
    } catch (err) {
      setLastError(err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  return {
    lastCommand,
    lastError,
    lastClarify,
    lastSuccess,
    lastTranscript,
    lastNormalizedText,
    isTypingMode,
    isMacroMode,
    isExecutingMacro,
    autoPlayMacro,
    macroExecutionStatus,
    activeMacro,
    setAutoPlayMacro,
    executeNextMacroStep,
    playMacro,
    stopMacro,
    handleTranscript,
  };
}
