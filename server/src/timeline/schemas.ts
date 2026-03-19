import { Type, type Static } from '@sinclair/typebox';

const TransitionConfigSchema = Type.Object({
  type: Type.String(),
  durationMs: Type.Number({ minimum: 0 }),
});

const ShaderParamSchema = Type.Object({
  paramName: Type.String(),
  paramValue: Type.Union([Type.Number(), Type.String()]),
});

const ShaderConfigSchema = Type.Object({
  shaderName: Type.String(),
  shaderId: Type.String(),
  enabled: Type.Boolean(),
  params: Type.Array(ShaderParamSchema),
});

const TimelineBlockSettingsSchema = Type.Object({
  timelineColor: Type.Optional(Type.String()),
  volume: Type.Number(),
  showTitle: Type.Boolean(),
  shaders: Type.Array(ShaderConfigSchema),
  orientation: Type.Union([
    Type.Literal('horizontal'),
    Type.Literal('vertical'),
  ]),
  text: Type.Optional(Type.String()),
  textAlign: Type.Optional(
    Type.Union([
      Type.Literal('left'),
      Type.Literal('center'),
      Type.Literal('right'),
    ]),
  ),
  textColor: Type.Optional(Type.String()),
  textMaxLines: Type.Optional(Type.Number()),
  textScrollSpeed: Type.Optional(Type.Number()),
  textScrollLoop: Type.Optional(Type.Boolean()),
  textFontSize: Type.Optional(Type.Number()),
  borderColor: Type.Optional(Type.String()),
  borderWidth: Type.Optional(Type.Number({ minimum: 0 })),
  attachedInputIds: Type.Optional(Type.Array(Type.String())),
  gameBackgroundColor: Type.Optional(Type.String()),
  gameCellGap: Type.Optional(Type.Number({ minimum: 0 })),
  gameBoardBorderColor: Type.Optional(Type.String()),
  gameBoardBorderWidth: Type.Optional(Type.Number({ minimum: 0 })),
  gameGridLineColor: Type.Optional(Type.String()),
  gameGridLineAlpha: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  snakeEventShaders: Type.Optional(Type.Any()),
  snake1Shaders: Type.Optional(Type.Array(ShaderConfigSchema)),
  snake2Shaders: Type.Optional(Type.Array(ShaderConfigSchema)),
  absolutePosition: Type.Optional(Type.Boolean()),
  absoluteTop: Type.Optional(Type.Number()),
  absoluteLeft: Type.Optional(Type.Number()),
  absoluteWidth: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteHeight: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteTransitionDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteTransitionEasing: Type.Optional(Type.String()),
  mp4PlayFromMs: Type.Optional(Type.Number({ minimum: 0 })),
  mp4Loop: Type.Optional(Type.Boolean()),
  introTransition: Type.Optional(TransitionConfigSchema),
  outroTransition: Type.Optional(TransitionConfigSchema),
});

const TimelineKeyframeSchema = Type.Object({
  id: Type.String(),
  timeMs: Type.Number({ minimum: 0 }),
  blockSettings: TimelineBlockSettingsSchema,
});

const TimelineClipSchema = Type.Object({
  id: Type.String(),
  inputId: Type.String(),
  startMs: Type.Number({ minimum: 0 }),
  endMs: Type.Number({ minimum: 0 }),
  blockSettings: TimelineBlockSettingsSchema,
  keyframes: Type.Array(TimelineKeyframeSchema),
});

const TimelineTrackSchema = Type.Object({
  id: Type.String(),
  clips: Type.Array(TimelineClipSchema),
});

export const TimelinePlaySchema = Type.Object({
  tracks: Type.Array(TimelineTrackSchema),
  totalDurationMs: Type.Number({ minimum: 0 }),
  keyframeInterpolationMode: Type.Union([
    Type.Literal('step'),
    Type.Literal('smooth'),
  ]),
  fromMs: Type.Optional(Type.Number({ minimum: 0 })),
});

export const TimelineSeekSchema = Type.Object({
  ms: Type.Number({ minimum: 0 }),
});

export const TimelineApplySchema = Type.Object({
  tracks: Type.Array(TimelineTrackSchema),
  totalDurationMs: Type.Number({ minimum: 0 }),
  keyframeInterpolationMode: Type.Union([
    Type.Literal('step'),
    Type.Literal('smooth'),
  ]),
  playheadMs: Type.Number({ minimum: 0 }),
});

export type TimelinePlayBody = Static<typeof TimelinePlaySchema>;
export type TimelineSeekBody = Static<typeof TimelineSeekSchema>;
export type TimelineApplyBody = Static<typeof TimelineApplySchema>;
