export type ToggleFeedback = {
  type: 'toggle';
  label: string;
  value: boolean;
};

export type ValueFeedback = {
  type: 'value';
  label: string;
  from?: string | number;
  to: string | number;
  unit?: string;
};

export type SelectFeedback = {
  type: 'select';
  label: string;
  value: string;
};

export type ActionFeedback = {
  type: 'action';
  label: string;
  description?: string;
};

export type ModeFeedback = {
  type: 'mode';
  label: string;
  active: boolean;
};

export type ActionFeedbackDetail =
  | ToggleFeedback
  | ValueFeedback
  | SelectFeedback
  | ActionFeedback
  | ModeFeedback;

export const ACTION_FEEDBACK_EVENT = 'smelter:voice:action-feedback' as const;

export function emitActionFeedback(detail: ActionFeedbackDetail) {
  window.dispatchEvent(new CustomEvent(ACTION_FEEDBACK_EVENT, { detail }));
}
