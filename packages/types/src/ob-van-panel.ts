// OB Van — "AI PANEL" layer. A live talk segment run through the OB Van
// director: one human host (role `speaker`, a WHIP phone cam with captions
// on) and two AI panelists (role `guest`, puppet cams whose talent names map
// to models). The host asks questions out loud; when a question's transcript
// turn closes, both models answer it via TTS, one after the other, in an
// order that alternates per question. The camera never cuts anyone off
// screen: every shot is `featured` (speaker big, the rest in a strip).

/** The two models on the panel (a subset of `ObQuizModelId`). */
export type ObPanelSpeakerId = "opus" | "gpt";
export const OB_PANEL_SPEAKER_IDS: readonly ObPanelSpeakerId[] = [
  "opus",
  "gpt",
];

/**
 * `idle` waiting for the host · `thinking` a question is out, the models'
 * answers are being fetched/synthesised · `answering` the answers play on
 * air in `order` (back to `idle` after the last one ends).
 */
export type ObPanelPhase = "idle" | "thinking" | "answering";

export type ObPanelSpeakerStatus = "idle" | "thinking" | "speaking" | "done";

export type ObPanelSpeaker = {
  model: ObPanelSpeakerId;
  camId: string;
  /** The cam's display name (what the desk and HUD show). */
  name: string;
  status: ObPanelSpeakerStatus;
  /** The model's last spoken answer (desk display). */
  lastText: string | null;
};

export type ObPanelState = {
  phase: ObPanelPhase;
  /** Monotonic question counter; answers are guarded by it. */
  seq: number;
  /** The question currently out (thinking/answering). */
  question: string | null;
  /** A question the host asked while answers were playing (latest wins). */
  pendingQuestion: string | null;
  speakers: ObPanelSpeaker[];
  /** Cam of the panelist currently speaking on air (drives `quizTurn`). */
  turnCamId: string | null;
};

/** One line of the rolling panel conversation fed back to the models. */
export type ObPanelHistoryEntry = {
  speaker: "host" | ObPanelSpeakerId;
  text: string;
};

/** A host turn closes after this long with no new transcript segment. */
export const OB_PANEL_TURN_CLOSE_MS = 1500;
/** Shorter transcripts are noise (Whisper hallucinates on silence). */
export const OB_PANEL_MIN_QUESTION_CHARS = 8;
/** A model that hasn't answered by then gets a canned line. */
export const OB_PANEL_ANSWER_TIMEOUT_MS = 25000;
/** Rolling conversation history cap (entries, host + models). */
export const OB_PANEL_HISTORY_MAX = 12;
/** First answer starts this long after the question finishes airing. */
export const OB_PANEL_ANSWER_LEAD_MS = 700;
