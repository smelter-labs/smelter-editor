/**
 * OB Van LLM — tool schemas.
 *
 * Both tools are `strict: true`, so the schemas follow the structured-outputs
 * subset: no recursion, `additionalProperties: false` on every object,
 * optional properties = left out of `required`, no numeric / string bounds
 * (`minimum`, `maximum`, `maxLength`, `maxItems`, `pattern` — those are
 * stripped by `toStrictSchema()` and appended to the description instead;
 * `parseObRuleset()` and the analyst clamp them on our side), `minItems` only
 * 0 or 1, `enum` / `const` / `anyOf` allowed.
 *
 * `propose_ruleset` mirrors the rules DSL in `@smelter-editor/types`
 * (`ObRuleset`) with one change: keyword groups are a list of
 * `{group, words}` (a free-form record cannot be expressed with
 * `additionalProperties: false`). `rulesetFromToolInput()` converts back.
 */
import {
  OB_CAM_ROLES,
  OB_GRADES,
  OB_OPS,
  OB_RULESET_LIMITS,
  OB_SIGNAL_KINDS,
  OB_TRANSITION_TYPES,
} from '@smelter-editor/types';

export type ObJsonSchemaType =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'null';

/** The JSON Schema subset used here (authoring form: may carry bounds). */
export type ObJsonSchema = {
  type?: ObJsonSchemaType | ObJsonSchemaType[];
  description?: string;
  properties?: Record<string, ObJsonSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: ObJsonSchema;
  enum?: readonly (string | number | boolean)[];
  const?: string | number | boolean;
  anyOf?: ObJsonSchema[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
};

/** An object schema suitable as a tool's `input_schema`. */
export type ObToolInputSchema = ObJsonSchema & {
  type: 'object';
  properties: Record<string, ObJsonSchema>;
};

export type ObLlmToolDef = {
  name: string;
  description: string;
  inputSchema: ObToolInputSchema;
};

function boundsNote(s: ObJsonSchema): string | null {
  const parts: string[] = [];
  if (s.minimum !== undefined && s.maximum !== undefined)
    parts.push(`${s.minimum}..${s.maximum}`);
  else if (s.minimum !== undefined) parts.push(`≥ ${s.minimum}`);
  else if (s.maximum !== undefined) parts.push(`≤ ${s.maximum}`);
  if (s.maxLength !== undefined) parts.push(`≤ ${s.maxLength} chars`);
  if (s.maxItems !== undefined) parts.push(`≤ ${s.maxItems} items`);
  if (s.minItems !== undefined && s.minItems > 1)
    parts.push(`≥ ${s.minItems} items`);
  if (s.pattern !== undefined) parts.push(`pattern ${s.pattern}`);
  return parts.length ? parts.join(', ') : null;
}

/**
 * Deep copy of `schema` in the strict-tool subset: `additionalProperties:
 * false` on every object, unsupported bounds removed (and appended to the
 * description so the model still sees them), `minItems` clamped to 0 / 1.
 */
export function toStrictSchema(schema: ObToolInputSchema): ObToolInputSchema;
export function toStrictSchema(schema: ObJsonSchema): ObJsonSchema;
export function toStrictSchema(schema: ObJsonSchema): ObJsonSchema {
  const walk = (s: ObJsonSchema): ObJsonSchema => {
    const out: ObJsonSchema = {};
    if (s.type !== undefined)
      out.type = Array.isArray(s.type) ? [...s.type] : s.type;
    const note = boundsNote(s);
    if (s.description !== undefined || note)
      out.description = [s.description, note ? `(${note})` : null]
        .filter((x): x is string => !!x)
        .join(' ');
    if (s.enum) out.enum = [...s.enum];
    if (s.const !== undefined) out.const = s.const;
    if (s.anyOf) out.anyOf = s.anyOf.map(walk);
    if (s.items) out.items = walk(s.items);
    if (s.minItems !== undefined) out.minItems = s.minItems >= 1 ? 1 : 0;
    const isObject =
      s.type === 'object' ||
      (Array.isArray(s.type) && s.type.includes('object'));
    if (s.properties || isObject) {
      out.properties = Object.fromEntries(
        Object.entries(s.properties ?? {}).map(([k, v]) => [k, walk(v)]),
      );
      out.required = [...(s.required ?? [])];
      out.additionalProperties = false;
    }
    return out;
  };
  return walk(schema);
}

// ── Building blocks ─────────────────────────────────────────────────────

const obj = (
  properties: Record<string, ObJsonSchema>,
  required: string[],
  description?: string,
): ObJsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
  ...(description ? { description } : {}),
});
const str = (description?: string, maxLength?: number): ObJsonSchema => ({
  type: 'string',
  ...(description ? { description } : {}),
  ...(maxLength ? { maxLength } : {}),
});
const num = (min: number, max: number, description?: string): ObJsonSchema => ({
  type: 'number',
  minimum: min,
  maximum: max,
  ...(description ? { description } : {}),
});
const int = (min: number, max: number, description?: string): ObJsonSchema => ({
  type: 'integer',
  minimum: min,
  maximum: max,
  ...(description ? { description } : {}),
});
const bool = (description?: string): ObJsonSchema => ({
  type: 'boolean',
  ...(description ? { description } : {}),
});
const list = (
  items: ObJsonSchema,
  description?: string,
  maxItems?: number,
): ObJsonSchema => ({
  type: 'array',
  items,
  ...(description ? { description } : {}),
  ...(maxItems ? { maxItems } : {}),
});
const enumOf = (
  values: readonly string[],
  description?: string,
): ObJsonSchema => ({
  type: 'string',
  enum: [...values],
  ...(description ? { description } : {}),
});

const L = OB_RULESET_LIMITS;

const SELECTOR = str(
  `Camera selector: a role (${OB_CAM_ROLES.join(', ')}, or custom:<name>), ` +
    '"any", "program", "not-program", "trigger" (the camera that met the condition) ' +
    'or "cam:<number>" for one specific camera from the camera list.',
);

const LEAF = obj(
  {
    signal: enumOf(OB_SIGNAL_KINDS),
    cam: SELECTOR,
    op: enumOf(OB_OPS),
    value: {
      type: ['number', 'string', 'boolean'],
      description: 'Threshold, keyword group or flag.',
    },
    forMs: num(
      L.forMs.min,
      L.forMs.max,
      'Condition must hold continuously this long.',
    ),
  },
  ['signal'],
);

const CONDITION: ObJsonSchema = {
  description:
    'One leaf, or ONE level of all / any / not over leaves (no nesting).',
  anyOf: [
    LEAF,
    obj({ all: { ...list(LEAF), minItems: 1 } }, ['all']),
    obj({ any: { ...list(LEAF), minItems: 1 } }, ['any']),
    obj({ not: LEAF }, ['not']),
  ],
};

const SHOT: ObJsonSchema = {
  description: 'What to put on air; camera references are selectors.',
  anyOf: [
    obj({ kind: { type: 'string', const: 'solo' }, cam: SELECTOR }, [
      'kind',
      'cam',
    ]),
    obj(
      {
        kind: { type: 'string', const: 'split' },
        cams: list(SELECTOR, 'Exactly two selectors.'),
      },
      ['kind', 'cams'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'pip' },
        main: SELECTOR,
        inset: SELECTOR,
        corner: enumOf(['tl', 'tr', 'bl', 'br']),
        size: enumOf(['S', 'M', 'L']),
      },
      ['kind', 'main', 'inset'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'quad' },
        cams: list(SELECTOR, '1 to 4 selectors.', 4),
      },
      ['kind', 'cams'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'grid' },
        cams: list(SELECTOR, 'Empty = every live camera.', 8),
      },
      ['kind', 'cams'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'speaker-slides' },
        speaker: SELECTOR,
        slides: SELECTOR,
      },
      ['kind', 'speaker', 'slides'],
    ),
    obj(
      {
        kind: { type: 'string', const: 'virtual' },
        cam: SELECTOR,
        target: enumOf(['speaker', 'largest', 'ball', 'centroid', 'motion']),
        zoom: enumOf(['tight', 'normal', 'wide']),
      },
      ['kind', 'cam'],
    ),
  ],
};

const PACING_PATCH = obj(
  {
    minHoldMs: int(L.minHoldMs.min, L.minHoldMs.max),
    maxHoldMs: int(L.maxHoldMs.min, L.maxHoldMs.max),
    transition: enumOf(OB_TRANSITION_TYPES),
    transitionMs: int(L.transitionMs.min, L.transitionMs.max),
    anticipateMs: int(L.anticipateMs.min, L.anticipateMs.max),
  },
  [],
);

const ACTION = obj(
  {
    shot: SHOT,
    transition: obj(
      {
        type: enumOf(OB_TRANSITION_TYPES),
        durationMs: int(L.transitionMs.min, L.transitionMs.max),
      },
      ['type'],
    ),
    effects: obj(
      { grade: enumOf(OB_GRADES), spotlight: bool(), softBackground: bool() },
      [],
    ),
    lowerThird: obj(
      {
        cam: SELECTOR,
        mode: enumOf(['talent', 'off']),
        holdMs: int(1000, 30000),
      },
      ['cam', 'mode'],
      "Show / hide the camera's talent name.",
    ),
    replay: obj(
      { cam: SELECTOR, beforeMs: int(1000, 10000), afterMs: int(0, 5000) },
      ['cam', 'beforeMs', 'afterMs'],
      'Replay (file cameras only).',
    ),
    pacing: PACING_PATCH,
  },
  [],
  'At least one of shot / effects / lowerThird / replay / pacing.',
);

const RULE = obj(
  {
    id: str('Short kebab-case id.', 40),
    name: str('Human-readable name.', 60),
    when: CONDITION,
    then: ACTION,
    priority: int(
      L.priority.min,
      L.priority.max,
      '≥ 80 cuts through the minimum hold.',
    ),
    cooldownMs: int(L.cooldownMs.min, L.cooldownMs.max),
    holdMs: int(
      L.holdMs.min,
      L.holdMs.max,
      'Hold the result at least this long.',
    ),
    enabled: bool(),
  },
  ['id', 'name', 'when', 'then', 'priority'],
);

const WEIGHT = num(L.weight.min, L.weight.max);

const RULESET = obj(
  {
    name: str('Short name for the ruleset.', 60),
    pacing: obj(
      {
        minHoldMs: int(L.minHoldMs.min, L.minHoldMs.max),
        maxHoldMs: int(L.maxHoldMs.min, L.maxHoldMs.max),
        transition: enumOf(OB_TRANSITION_TYPES),
        transitionMs: int(L.transitionMs.min, L.transitionMs.max),
        anticipateMs: int(L.anticipateMs.min, L.anticipateMs.max),
      },
      ['minHoldMs', 'maxHoldMs', 'transition'],
    ),
    weights: obj(
      {
        speech: WEIGHT,
        motion: WEIGHT,
        people: WEIGHT,
        ball: WEIGHT,
        novelty: WEIGHT,
        stay: WEIGHT,
        roleBias: obj(
          Object.fromEntries(OB_CAM_ROLES.map((r) => [r, WEIGHT])),
          [],
          'Score bias per camera role.',
        ),
      },
      ['speech', 'motion', 'people', 'ball', 'novelty', 'stay'],
    ),
    behaviours: obj(
      {
        monologueLock: bool(),
        dialogueSplit: bool(),
        onsetCuts: bool(),
        anticipate: bool(),
        burstReplay: bool(),
      },
      [],
    ),
    keywords: list(
      obj(
        {
          group: str('Group name used as `keyword has <group>`.', 24),
          words: list(str(undefined, 40), undefined, L.keywordsPerGroup.max),
        },
        ['group', 'words'],
      ),
      'Keyword groups matched in live transcripts (lowercase words / short phrases).',
      L.keywordGroups.max,
    ),
    rules: list(
      RULE,
      'Rules, any order (sorted by priority on our side).',
      L.rules.max,
    ),
  },
  ['name', 'pacing', 'weights', 'rules'],
);

// ── Tools ───────────────────────────────────────────────────────────────

export const OB_PROPOSE_RULESET_TOOL: ObLlmToolDef = {
  name: 'propose_ruleset',
  description:
    'Propose the auto pilot ruleset for this event (rules DSL). Call exactly once with the complete ruleset and a short rationale.',
  inputSchema: toStrictSchema({
    type: 'object',
    properties: {
      ruleset: RULESET,
      rationale: str(
        '2–4 sentences for the host: what the rules do and why.',
        600,
      ),
    },
    required: ['ruleset', 'rationale'],
    additionalProperties: false,
  }),
};

export const OB_DIRECT_MAX_ACTIONS = 3;

const WHY = str('Why, in a few words (shown in the log).', 80);
const DIRECT_ACTION: ObJsonSchema = {
  anyOf: [
    obj(
      { type: { type: 'string', const: 'advance_segment' }, why: WHY },
      ['type', 'why'],
      'Go to the next rundown segment (only when the talk clearly moved on).',
    ),
    obj(
      {
        type: { type: 'string', const: 'set_lower_third' },
        cam: int(1, 8, 'Camera number.'),
        name: str(
          'Name exactly as spoken or as in the talent field (keep diacritics).',
          48,
        ),
        subtitle: str('Role / affiliation, only if known.', 64),
        ms: int(2000, 15000, 'How long to show it.'),
        why: WHY,
      },
      ['type', 'cam', 'name', 'why'],
      'Lower third for the person on this camera.',
    ),
    obj(
      {
        type: { type: 'string', const: 'set_pacing' },
        minHoldMs: int(L.minHoldMs.min, L.minHoldMs.max),
        maxHoldMs: int(L.maxHoldMs.min, L.maxHoldMs.max),
        why: WHY,
      },
      ['type', 'why'],
      'Override the pacing (at least one of the two holds).',
    ),
    obj(
      {
        type: { type: 'string', const: 'prefer_cam' },
        cam: int(1, 8, 'Camera number.'),
        forMs: int(3000, 60000),
        why: WHY,
      },
      ['type', 'cam', 'forMs', 'why'],
      'Bias the auto pilot toward this camera for a while (it still decides when to cut).',
    ),
    obj(
      {
        type: { type: 'string', const: 'note' },
        text: str('Note for the director.', 120),
      },
      ['type', 'text'],
      'A short note for the director (no on-air effect).',
    ),
  ],
};

export const OB_DIRECT_TOOL: ObLlmToolDef = {
  name: 'direct',
  description:
    'Nudge the show with at most 3 bounded actions. An empty list means "all good, keep going".',
  inputSchema: toStrictSchema({
    type: 'object',
    properties: {
      actions: list(
        DIRECT_ACTION,
        'At most 3 actions, most important first.',
        OB_DIRECT_MAX_ACTIONS,
      ),
    },
    required: ['actions'],
    additionalProperties: false,
  }),
};

// ── DSL doc for the system prompt ───────────────────────────────────────

export const OB_RULES_DSL_DOC = `RULES DSL (the auto pilot)
A ruleset = pacing + scoring weights + behaviours + keyword groups + rules.
Every 100 ms the auto pilot scores each live camera (weights × signals, roleBias per role) and cuts to the best one, respecting pacing; rules fire on top of scoring.
- pacing: minHoldMs (${L.minHoldMs.min}..${L.minHoldMs.max}) never cut sooner; maxHoldMs (${L.maxHoldMs.min}..${L.maxHoldMs.max}) cut away by then; transition (${OB_TRANSITION_TYPES.join('|')}); transitionMs; anticipateMs (pull a speech cut earlier, ≤ ${L.anticipateMs.max}).
- weights (${L.weight.min}..${L.weight.max}): speech, motion, people, ball, novelty (prefer cameras not seen lately), stay (inertia), roleBias {role: bias}.
- behaviours (booleans): monologueLock (never leave a long monologue), dialogueSplit (split on a back-and-forth), onsetCuts (cut on musical onsets / beats), anticipate (cut just before speech starts), burstReplay (replay after a burst of action).
- keywords: groups of lowercase words / phrases matched in live captions; a leaf {signal:"keyword", op:"has", value:"<group>"} fires when a group word is heard.
- rule: {id, name, priority 0..100 (≥ 80 ignores minHoldMs), cooldownMs, holdMs, enabled, when, then}.
- when: a leaf {signal, cam?, op?, value?, forMs?} or ONE level of {all:[leaves]} / {any:[leaves]} / {not: leaf}. No nesting.
  signals: speech (someone talks; bool), silence (nobody talks), speechShare (0..1 of last 10 s), rms (dBFS, −90..0), onset (audio onset now), onsetsPerSec, motion (0..1), motionSpike, burst (sustained action), people (count), ball (ball visible), ballAge (ms since ball seen), keyword (op "has", value = group), hold (ms current shot has been on air), segment (rundown index), dialogue (two cams alternating speech; bool).
  ops: ${OB_OPS.join(' ')}; leaving op/value out = "is true".
- cam selectors: a role (${OB_CAM_ROLES.join(', ')}, custom:<name>) = first live camera with that role; "any"; "program" (on air); "not-program" (best camera off air); "trigger" (the camera that met the condition); "cam:<n>" = camera number n.
- then: {shot?, transition?, effects?, lowerThird?, replay?, pacing?} — at least one of shot/effects/lowerThird/replay/pacing.
  shots: solo{cam} · split{cams:[a,b]} · pip{main, inset, corner tl|tr|bl|br, size S|M|L} · quad{cams ≤ 4} · grid{cams, [] = all} · speaker-slides{speaker, slides} · virtual{cam, target speaker|largest|ball|centroid|motion, zoom tight|normal|wide} (digital pan/zoom of a wide camera).
  effects: grade (${OB_GRADES.join('|')}), spotlight, softBackground. lowerThird {cam, mode talent|off, holdMs} shows the camera's talent name. replay {cam, beforeMs, afterMs} (file cameras only). pacing: a temporary pacing patch.
Example rule: {"id":"slides-kw","name":"Slides when mentioned","priority":80,"cooldownMs":15000,"holdMs":8000,"when":{"all":[{"signal":"keyword","op":"has","value":"slides"},{"signal":"speech","cam":"any"}]},"then":{"shot":{"kind":"speaker-slides","speaker":"trigger","slides":"slides"},"transition":{"type":"cut"}}}`;
