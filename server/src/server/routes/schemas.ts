import { Type } from '@sinclair/typebox';

export const RoomIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
});

export const RoomAndInputIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
  inputId: Type.String({ maxLength: 512, minLength: 1 }),
});

export const ActiveTransitionSchema = Type.Object({
  type: Type.String(),
  durationMs: Type.Number(),
  direction: Type.Union([Type.Literal('in'), Type.Literal('out')]),
});

export const InputSchema = Type.Union([
  Type.Object({
    type: Type.Literal('twitch-channel'),
    channelId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('kick-channel'),
    channelId: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('whip'),
    username: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('local-mp4'),
    source: Type.Union([
      Type.Object({ fileName: Type.String() }),
      Type.Object({ url: Type.String() }),
    ]),
  }),
  Type.Object({
    type: Type.Literal('image'),
    fileName: Type.Optional(Type.String()),
    imageId: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('text-input'),
    text: Type.String(),
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
  }),
  Type.Object({
    type: Type.Literal('game'),
    title: Type.Optional(Type.String()),
  }),
]);

export const CreateRoomSchema = Type.Object({
  initInputs: Type.Optional(Type.Array(InputSchema)),
  skipDefaultInputs: Type.Optional(Type.Boolean()),
  resolution: Type.Optional(
    Type.Union([
      Type.Object({
        width: Type.Number({ minimum: 1 }),
        height: Type.Number({ minimum: 1 }),
      }),
      Type.Union([
        Type.Literal('720p'),
        Type.Literal('1080p'),
        Type.Literal('1440p'),
        Type.Literal('4k'),
        Type.Literal('720p-vertical'),
        Type.Literal('1080p-vertical'),
        Type.Literal('1440p-vertical'),
        Type.Literal('4k-vertical'),
      ]),
    ]),
  ),
});

const LayerInputSchema = Type.Object({
  inputId: Type.String(),
  x: Type.Number(),
  y: Type.Number(),
  width: Type.Number({ minimum: 0 }),
  height: Type.Number({ minimum: 0 }),
  transitionDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
  transitionEasing: Type.Optional(Type.String()),
});

const ObjectFitSchema = Type.Union([
  Type.Literal('fill'),
  Type.Literal('cover'),
  Type.Literal('contain'),
]);

const SpacingProps = {
  horizontalSpacing: Type.Optional(Type.Number({ minimum: 0 })),
  verticalSpacing: Type.Optional(Type.Number({ minimum: 0 })),
};

const LayerBehaviorSchema = Type.Union([
  Type.Object({
    type: Type.Literal('equal-grid'),
    autoscale: Type.Optional(Type.Boolean()),
    rows: Type.Optional(Type.Integer({ minimum: 1 })),
    cols: Type.Optional(Type.Integer({ minimum: 1 })),
    objectFit: Type.Optional(ObjectFitSchema),
    resolveCollisions: Type.Optional(Type.Boolean()),
    ...SpacingProps,
  }),
  Type.Object({
    type: Type.Literal('approximate-aspect-grid'),
    resolveCollisions: Type.Optional(Type.Boolean()),
    ...SpacingProps,
  }),
  Type.Object({
    type: Type.Literal('exact-aspect-grid'),
    ...SpacingProps,
  }),
  Type.Object({
    type: Type.Literal('picture-in-picture'),
    ...SpacingProps,
  }),
]);

const LayerSchema = Type.Object({
  id: Type.String(),
  inputs: Type.Array(LayerInputSchema),
  behavior: Type.Optional(LayerBehaviorSchema),
});

export const UpdateRoomSchema = Type.Object({
  inputOrder: Type.Optional(Type.Array(Type.String())),
  layers: Type.Optional(Type.Array(LayerSchema, { minItems: 1 })),
  isPublic: Type.Optional(Type.Boolean()),
  swapDurationMs: Type.Optional(Type.Number({ minimum: 0, maximum: 5000 })),
  swapOutgoingEnabled: Type.Optional(Type.Boolean()),
  swapFadeInDurationMs: Type.Optional(
    Type.Number({ minimum: 0, maximum: 5000 }),
  ),
  swapFadeOutDurationMs: Type.Optional(
    Type.Number({ minimum: 0, maximum: 5000 }),
  ),
  newsStripFadeDuringSwap: Type.Optional(Type.Boolean()),
  newsStripEnabled: Type.Optional(Type.Boolean()),
});

export const PendingWhipInputSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  volume: Type.Number(),
  showTitle: Type.Boolean(),
  shaders: Type.Array(Type.Any()),
  orientation: Type.Union([
    Type.Literal('horizontal'),
    Type.Literal('vertical'),
  ]),
  position: Type.Number(),
});

export const SetPendingWhipInputsSchema = Type.Object({
  pendingWhipInputs: Type.Array(PendingWhipInputSchema),
});

const SharedInputTextStyleProps = {
  text: Type.Optional(Type.String()),
  textColor: Type.Optional(Type.String()),
  textMaxLines: Type.Optional(Type.Number()),
  textScrollSpeed: Type.Optional(Type.Number()),
  textScrollLoop: Type.Optional(Type.Boolean()),
  textFontSize: Type.Optional(Type.Number()),
  borderColor: Type.Optional(Type.String()),
  gameBackgroundColor: Type.Optional(Type.String()),
  gameBoardBorderColor: Type.Optional(Type.String()),
  gameGridLineColor: Type.Optional(Type.String()),
};

const SharedInputAbsolutePositionProps = {
  absolutePosition: Type.Optional(Type.Boolean()),
  absoluteTop: Type.Optional(Type.Number()),
  absoluteLeft: Type.Optional(Type.Number()),
  absoluteTransitionEasing: Type.Optional(Type.String()),
};

export const UpdateInputSchema = Type.Object({
  volume: Type.Optional(Type.Number({ maximum: 1, minimum: 0 })),
  showTitle: Type.Optional(Type.Boolean()),
  shaders: Type.Optional(
    Type.Array(
      Type.Object({
        shaderName: Type.String(),
        shaderId: Type.String(),
        enabled: Type.Boolean(),
        params: Type.Array(
          Type.Object({
            paramName: Type.String(),
            paramValue: Type.Union([Type.Number(), Type.String()]),
          }),
        ),
      }),
    ),
  ),
  orientation: Type.Optional(
    Type.Union([Type.Literal('horizontal'), Type.Literal('vertical')]),
  ),
  ...SharedInputTextStyleProps,
  textAlign: Type.Optional(
    Type.Union([
      Type.Literal('left'),
      Type.Literal('center'),
      Type.Literal('right'),
    ]),
  ),
  textScrollNudge: Type.Optional(Type.Number()),
  borderWidth: Type.Optional(Type.Number({ minimum: 0 })),
  gameCellGap: Type.Optional(Type.Number({ minimum: 0 })),
  gameBoardBorderWidth: Type.Optional(Type.Number({ minimum: 0 })),
  gameGridLineAlpha: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
  snakeEventShaders: Type.Optional(Type.Any()),
  snake1Shaders: Type.Optional(Type.Any()),
  snake2Shaders: Type.Optional(Type.Any()),
  attachedInputIds: Type.Optional(Type.Array(Type.String())),
  ...SharedInputAbsolutePositionProps,
  absoluteWidth: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteHeight: Type.Optional(Type.Number({ minimum: 0 })),
  absoluteTransitionDurationMs: Type.Optional(Type.Number({ minimum: 0 })),
  activeTransition: Type.Optional(ActiveTransitionSchema),
});

export const HideInputBodySchema = Type.Object({
  activeTransition: Type.Optional(ActiveTransitionSchema),
});

export const ShowInputBodySchema = Type.Object({
  activeTransition: Type.Optional(ActiveTransitionSchema),
});

export const Mp4RestartSchema = Type.Object({
  playFromMs: Type.Number({ minimum: 0 }),
  loop: Type.Boolean(),
});

export const MotionDetectionSchema = Type.Object({
  enabled: Type.Boolean(),
});

// Storage schemas

const ShaderParamConfigSchema = Type.Object({
  paramName: Type.String(),
  paramValue: Type.Union([Type.Number(), Type.String()]),
});

export const ShaderConfigSchema = Type.Object({
  shaderName: Type.String(),
  shaderId: Type.String(),
  enabled: Type.Boolean(),
  params: Type.Array(ShaderParamConfigSchema),
});

const RoomConfigInputSchema = Type.Object({
  type: Type.String(),
  title: Type.String(),
  description: Type.Optional(Type.String()),
  volume: Type.Optional(Type.Number()),
  showTitle: Type.Optional(Type.Boolean()),
  shaders: Type.Optional(Type.Array(ShaderConfigSchema)),
  channelId: Type.Optional(Type.String()),
  imageId: Type.Optional(Type.String()),
  mp4FileName: Type.Optional(Type.String()),
  ...SharedInputTextStyleProps,
  textAlign: Type.Optional(Type.String()),
  orientation: Type.Optional(Type.String()),
  borderWidth: Type.Optional(Type.Number()),
  gameCellGap: Type.Optional(Type.Number()),
  gameBoardBorderWidth: Type.Optional(Type.Number()),
  gameGridLineAlpha: Type.Optional(Type.Number()),
  snakeEventShaders: Type.Optional(Type.Record(Type.String(), Type.Any())),
  snake1Shaders: Type.Optional(Type.Array(ShaderConfigSchema)),
  snake2Shaders: Type.Optional(Type.Array(ShaderConfigSchema)),
  attachedInputIndices: Type.Optional(Type.Array(Type.Number())),
  ...SharedInputAbsolutePositionProps,
  absoluteWidth: Type.Optional(Type.Number()),
  absoluteHeight: Type.Optional(Type.Number()),
  absoluteTransitionDurationMs: Type.Optional(Type.Number()),
});

export const RoomConfigSchema = Type.Object({
  version: Type.Number(),
  layout: Type.String(),
  inputs: Type.Array(RoomConfigInputSchema),
  resolution: Type.Optional(
    Type.Object({
      width: Type.Number(),
      height: Type.Number(),
    }),
  ),
  transitionSettings: Type.Optional(
    Type.Object({
      swapDurationMs: Type.Optional(Type.Number()),
      swapOutgoingEnabled: Type.Optional(Type.Boolean()),
      swapFadeInDurationMs: Type.Optional(Type.Number()),
      swapFadeOutDurationMs: Type.Optional(Type.Number()),
      newsStripFadeDuringSwap: Type.Optional(Type.Boolean()),
      newsStripEnabled: Type.Optional(Type.Boolean()),
    }),
  ),
  timeline: Type.Optional(
    Type.Object({
      totalDurationMs: Type.Number(),
      pixelsPerSecond: Type.Number(),
      keyframeInterpolationMode: Type.Optional(Type.String()),
      tracks: Type.Array(
        Type.Object({
          label: Type.String(),
          clips: Type.Array(
            Type.Object({
              inputIndex: Type.Number(),
              startMs: Type.Number(),
              endMs: Type.Number(),
              blockSettings: Type.Optional(
                Type.Record(Type.String(), Type.Any()),
              ),
              keyframes: Type.Optional(Type.Record(Type.String(), Type.Any())),
            }),
          ),
        }),
      ),
    }),
  ),
});

const LayoutItemSchema = Type.Object({
  i: Type.String(),
  x: Type.Number(),
  y: Type.Number(),
  w: Type.Number(),
  h: Type.Number(),
  minW: Type.Optional(Type.Number()),
  minH: Type.Optional(Type.Number()),
  maxW: Type.Optional(Type.Number()),
  maxH: Type.Optional(Type.Number()),
});

export const DashboardLayoutSchema = Type.Object({
  layouts: Type.Record(Type.String(), Type.Array(LayoutItemSchema)),
  visiblePanels: Type.Optional(Type.Array(Type.String())),
});

export type RoomIdParams = { Params: { roomId: string } };
export type RoomAndInputIdParams = {
  Params: { roomId: string; inputId: string };
};
export type RecordingFileParams = { Params: { fileName: string } };
