/**
 * OB Van — the "Who Wants to Be a Smelterionaire?" question bank.
 *
 * ABCD questions about Smelter and the AI director, asked in bank order
 * (roughly easy → hard). Twelve mains cover three contestants × four
 * questions; the spares at the end absorb skips and extra players. The host
 * reads from the operator panel, which also marks the correct letter — the
 * program output never shows it before the reveal.
 */
import type { ObQuizLetter } from '@smelter-editor/types';

export type QuizQuestion = {
  id: string;
  /** Keep under ~120 chars — the question plate is one line at 40 px. */
  q: string;
  /** A..D, each under ~48 chars for the answer lozenges. */
  answers: [string, string, string, string];
  correct: ObQuizLetter;
  topic: 'smelter' | 'director';
  difficulty: 1 | 2 | 3;
};

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    id: 'q01',
    q: 'What does Smelter turn React components into?',
    answers: [
      'Static HTML pages',
      'Live video frames',
      'PDF documents',
      'Mobile apps',
    ],
    correct: 'B',
    topic: 'smelter',
    difficulty: 1,
  },
  {
    id: 'q02',
    q: 'What happens to your phone when your camera goes on air?',
    answers: [
      'The screen turns green',
      'It plays a jingle',
      'It turns red and vibrates',
      'It locks itself',
    ],
    correct: 'C',
    topic: 'director',
    difficulty: 1,
  },
  {
    id: 'q03',
    q: 'Which protocol do the phone cameras use to get video into Smelter?',
    answers: ['WHIP', 'RTMP', 'HDMI', 'FTP'],
    correct: 'A',
    topic: 'smelter',
    difficulty: 1,
  },
  {
    id: 'q04',
    q: 'When nobody has said anything for a while, a well-behaved director…',
    answers: [
      'Cuts to a wide shot',
      'Ends the stream',
      'Plays an ad',
      "Zooms into someone's face",
    ],
    correct: 'A',
    topic: 'director',
    difficulty: 1,
  },
  {
    id: 'q05',
    q: 'How far into the future does the AI director see, thanks to the side-channel delay?',
    answers: [
      'About 3 seconds',
      'About 3 minutes',
      'Exactly one frame',
      "It can't — nobody can",
    ],
    correct: 'A',
    topic: 'director',
    difficulty: 2,
  },
  {
    id: 'q06',
    q: 'Which model listens to the audio and decides who is talking right now?',
    answers: ['YOLO', 'Silero VAD', 'Whisper', 'Stable Diffusion'],
    correct: 'B',
    topic: 'director',
    difficulty: 2,
  },
  {
    id: 'q07',
    q: "What does YOLO do in the director's pipeline?",
    answers: [
      'Writes the lower thirds',
      'Finds people and the ball',
      'Mixes the audio',
      'Picks the background music',
    ],
    correct: 'B',
    topic: 'director',
    difficulty: 2,
  },
  {
    id: 'q08',
    q: 'What is the WHY log?',
    answers: [
      'A list of crash reports',
      'The reason behind every cut',
      "The viewers' chat",
      'The git history',
    ],
    correct: 'B',
    topic: 'director',
    difficulty: 2,
  },
  {
    id: 'q09',
    q: 'Which preset refuses to cut a monologue and pushes in with a spotlight instead?',
    answers: ['TALK', 'MATCH', 'GIG', 'STAGE'],
    correct: 'D',
    topic: 'director',
    difficulty: 2,
  },
  {
    id: 'q10',
    q: 'The glows, glitches and vignettes on this very stream are shaders written in…',
    answers: ['CSS', 'GLSL', 'WGSL', 'Excel formulas'],
    correct: 'C',
    topic: 'smelter',
    difficulty: 2,
  },
  {
    id: 'q11',
    q: 'In the rules language, what does a priority of 80 or more let a rule do?',
    answers: [
      'Run twice per tick',
      'Cut through the minimum hold',
      'Change the output resolution',
      'Fire the human operator',
    ],
    correct: 'B',
    topic: 'director',
    difficulty: 3,
  },
  {
    id: 'q12',
    q: 'The anticipated cut lands…',
    answers: [
      'Exactly on the first syllable',
      'A fifth of a second early',
      'Two seconds late, like a human',
      'Only during replays',
    ],
    correct: 'B',
    topic: 'director',
    difficulty: 3,
  },
  // ── Spares ───────────────────────────────────────────────────────────
  {
    id: 'q13',
    q: 'Which preset cuts on the beat?',
    answers: ['GIG', 'TALK', 'MATCH', 'FOLLOW'],
    correct: 'A',
    topic: 'director',
    difficulty: 1,
  },
  {
    id: 'q14',
    q: 'How does the finished program reach the viewers?',
    answers: [
      'WHEP over WebRTC',
      'Emailed frame by frame',
      'A USB stick',
      'Fax',
    ],
    correct: 'A',
    topic: 'smelter',
    difficulty: 2,
  },
  {
    id: 'q15',
    q: 'What does Claude write when you hand it a brief like "panel, moderator on cam one"?',
    answers: [
      'The wrap-up tweet',
      'The ruleset that runs the show',
      'The employment contract',
      'The stream title',
    ],
    correct: 'B',
    topic: 'director',
    difficulty: 2,
  },
];
