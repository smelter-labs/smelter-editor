import { Type } from '@sinclair/typebox';
import type { Static } from '@fastify/type-provider-typebox';
import type { FastifyInstance } from 'fastify';
import { state } from '../core/serverState';
import { setGlobalSnakeGameState } from './snakeGameDashboard';

let snakeGameRoomCreationInProgress: Promise<void> | null = null;
const snakeGameInputOwnerMap = new Map<string, string>(); // "<roomId>::<inputId>" -> source key
const snakeGameSourceRouteMap = new Map<
  string,
  { roomId: string; inputId: string }
>();
const snakeGameLastSeqMap = new Map<string, number>();
const snakeGameLastSeenAtMap = new Map<string, number>();
const snakeGameLastMovementAtMap = new Map<string, number>();
const snakeGameLastBoardSignatureMap = new Map<string, string>();
const SNAKE_GAME_STATE_TIMEOUT_MS = 5_000;
const snakeGameRoomInactivityTimers = new Map<
  string,
  ReturnType<typeof setTimeout>
>();

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  if (!value) return undefined;
  return Array.isArray(value) ? value[0] : value;
}

function resolveSnakeGameSourceKey(
  req: { headers: Record<string, unknown>; ip: string },
  bodyGameId?: string,
): string {
  const fromBody = typeof bodyGameId === 'string' ? bodyGameId.trim() : '';
  if (fromBody) return `game-id:${fromBody}`;

  const headerGameId = firstHeaderValue(
    req.headers['x-game-id'] as string | string[] | undefined,
  )?.trim();
  if (headerGameId) return `game-id:${headerGameId}`;

  const forwardedFor = firstHeaderValue(
    req.headers['x-forwarded-for'] as string | string[] | undefined,
  );
  const ip = forwardedFor?.split(',')[0]?.trim() || req.ip || 'unknown';
  const userAgent =
    firstHeaderValue(
      req.headers['user-agent'] as string | string[] | undefined,
    )?.trim() || 'unknown';

  return `ip:${ip}|ua:${userAgent}`;
}

function findSnakeGameInputId(roomId: string): string | undefined {
  try {
    const room = state.getRoom(roomId);
    return room.getInputs().find((input) => input.type === 'game')?.inputId;
  } catch {
    return undefined;
  }
}

function cleanupSnakeGameTrackingForSourceKey(sourceKey: string): void {
  const target = snakeGameSourceRouteMap.get(sourceKey);
  if (target) {
    snakeGameInputOwnerMap.delete(`${target.roomId}::${target.inputId}`);
    clearSnakeGameRoomInactivityTimer(target.roomId);
  }
  snakeGameSourceRouteMap.delete(sourceKey);
  snakeGameLastSeqMap.delete(sourceKey);
  snakeGameLastSeenAtMap.delete(sourceKey);
  snakeGameLastMovementAtMap.delete(sourceKey);
  snakeGameLastBoardSignatureMap.delete(sourceKey);
}

export function clearSnakeGameRoomInactivityTimer(roomId: string): void {
  const existing = snakeGameRoomInactivityTimers.get(roomId);
  if (existing) {
    clearTimeout(existing);
    snakeGameRoomInactivityTimers.delete(roomId);
  }
}

function resetSnakeGameRoomInactivityTimer(roomId: string): void {
  // Sticky snake rooms: do not auto-delete on inactivity.
  // Keep only one explicit timer state by clearing any previous timer.
  clearSnakeGameRoomInactivityTimer(roomId);
}

type SnakeGameMovementPayload = {
  board: {
    width: number;
    height: number;
    cellSize: number;
    cellGap?: number;
  };
  cells: Array<{
    x: number;
    y: number;
    color: string;
    size?: number;
    isHead?: boolean;
    direction?: 'up' | 'down' | 'left' | 'right';
    progress?: number;
  }>;
};

function buildSnakeGameBoardSignature(
  payload: SnakeGameMovementPayload,
): string {
  const sortedCells = payload.cells
    .map((cell) =>
      [
        cell.x,
        cell.y,
        cell.color,
        cell.size ?? '',
        cell.isHead ? 1 : 0,
        cell.direction ?? '',
        cell.progress ?? '',
      ].join(':'),
    )
    .sort();

  return [
    payload.board.width,
    payload.board.height,
    payload.board.cellSize,
    payload.board.cellGap ?? '',
    sortedCells.join('|'),
  ].join('#');
}

function evaluateSnakeGameMovement(
  sourceKey: string,
  payload: SnakeGameMovementPayload,
): { movementTimedOut: boolean; idleMs: number } {
  const now = Date.now();
  const signature = buildSnakeGameBoardSignature(payload);
  const lastSignature = snakeGameLastBoardSignatureMap.get(sourceKey);

  if (lastSignature === undefined || lastSignature !== signature) {
    snakeGameLastBoardSignatureMap.set(sourceKey, signature);
    snakeGameLastMovementAtMap.set(sourceKey, now);
    return { movementTimedOut: false, idleMs: 0 };
  }

  const lastMovementAt = snakeGameLastMovementAtMap.get(sourceKey) ?? now;
  const idleMs = now - lastMovementAt;
  // Sticky snake rooms: movement idling should not close/recreate rooms.
  return { movementTimedOut: false, idleMs };
}

async function closeInactiveSnakeGameRoomForSourceKey(
  sourceKey: string,
  idleMs: number,
): Promise<string | undefined> {
  const target = snakeGameSourceRouteMap.get(sourceKey);
  if (!target) {
    cleanupSnakeGameTrackingForSourceKey(sourceKey);
    return undefined;
  }

  console.info('[game-state] Closing inactive game room', {
    sourceKey,
    roomId: target.roomId,
    inputId: target.inputId,
    idleMs,
  });

  try {
    await state.deleteRoom(target.roomId);
  } catch (err) {
    console.warn('[game-state] Failed to close inactive game room', {
      sourceKey,
      roomId: target.roomId,
      error: err,
    });
  } finally {
    cleanupSnakeGameTrackingForSourceKey(sourceKey);
  }

  return target.roomId;
}

type SnakeGameSeqDecision = {
  shouldProcess: boolean;
  outOfOrder: boolean;
};

function evaluateSnakeGameSequence(
  sourceKey: string,
  seq: number,
): SnakeGameSeqDecision {
  const now = Date.now();
  const lastSeenAt = snakeGameLastSeenAtMap.get(sourceKey);
  if (lastSeenAt && now - lastSeenAt > SNAKE_GAME_STATE_TIMEOUT_MS) {
    console.info('[game-state] Source timed out, resetting sequence state', {
      sourceKey,
      idleMs: now - lastSeenAt,
    });
    // Keep source->room route ownership so the next game continues in the same room.
    // Reset only transient sequencing/movement state.
    snakeGameLastSeqMap.delete(sourceKey);
    snakeGameLastMovementAtMap.delete(sourceKey);
    snakeGameLastBoardSignatureMap.delete(sourceKey);
  }

  const lastSeq = snakeGameLastSeqMap.get(sourceKey);
  snakeGameLastSeenAtMap.set(sourceKey, now);

  if (seq === 1) {
    if (lastSeq !== undefined) {
      console.info(
        '[game-state] New game sequence started, keeping routed room',
        {
          sourceKey,
          lastSeq,
        },
      );
      // Keep route ownership so "play again" continues in the same room/input.
      // Reset only sequence/movement tracking for the fresh run.
      snakeGameLastBoardSignatureMap.delete(sourceKey);
      snakeGameLastMovementAtMap.set(sourceKey, now);
    }
    snakeGameLastSeqMap.set(sourceKey, 1);
    return { shouldProcess: true, outOfOrder: false };
  }

  if (lastSeq === undefined) {
    // Allow processing to avoid dropping first packet from a late/reconnected sender.
    snakeGameLastSeqMap.set(sourceKey, seq);
    if (seq > 1) {
      console.warn('[game-state] First packet has non-initial seq', {
        sourceKey,
        seq,
      });
      return { shouldProcess: true, outOfOrder: true };
    }
    return { shouldProcess: true, outOfOrder: false };
  }

  if (seq <= lastSeq) {
    console.info('[game-state] Ignoring stale/duplicate packet', {
      sourceKey,
      seq,
      lastSeq,
    });
    return { shouldProcess: false, outOfOrder: false };
  }

  if (seq > lastSeq + 1) {
    console.warn('[game-state] Sequence gap detected', {
      sourceKey,
      lastSeq,
      seq,
      missed: seq - lastSeq - 1,
    });
    snakeGameLastSeqMap.set(sourceKey, seq);
    return { shouldProcess: true, outOfOrder: true };
  }

  snakeGameLastSeqMap.set(sourceKey, seq);
  return { shouldProcess: true, outOfOrder: false };
}

const SnakeGameStateSchema = Type.Object({
  gameId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  seq: Type.Integer({ minimum: 1 }),
  smoothMove: Type.Optional(Type.Boolean()),
  smoothMoveSpeed: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  smoothMoveAccel: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  smoothMoveDecel: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
  board: Type.Object({
    width: Type.Number({ minimum: 1 }),
    height: Type.Number({ minimum: 1 }),
    cellSize: Type.Number({ minimum: 1 }),
    cellGap: Type.Optional(Type.Number({ minimum: 0 })),
  }),
  cells: Type.Array(
    Type.Object({
      x: Type.Number(),
      y: Type.Number(),
      color: Type.String(),
      size: Type.Optional(Type.Number({ minimum: 1 })),
      isHead: Type.Optional(Type.Boolean()),
      direction: Type.Optional(
        Type.Union([
          Type.Literal('up'),
          Type.Literal('down'),
          Type.Literal('left'),
          Type.Literal('right'),
        ]),
      ),
      progress: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    }),
  ),
  backgroundColor: Type.String(),
  events: Type.Optional(
    Type.Array(
      Type.Object({
        type: Type.Union([
          Type.Literal('speed_up'),
          Type.Literal('cut_opponent'),
          Type.Literal('got_cut'),
          Type.Literal('cut_self'),
          Type.Literal('eat_block'),
          Type.Literal('bounce_block'),
          Type.Literal('no_moves'),
          Type.Literal('game_over'),
        ]),
      }),
    ),
  ),
  gameOverData: Type.Optional(
    Type.Object({
      winnerName: Type.String(),
      reason: Type.String(),
      players: Type.Array(
        Type.Object({
          name: Type.String(),
          score: Type.Number(),
          eaten: Type.Number(),
          cuts: Type.Number(),
          color: Type.String(),
        }),
      ),
    }),
  ),
});

async function createDedicatedSnakeGameRoom(
  gs: Static<typeof SnakeGameStateSchema>,
): Promise<{
  roomId: string;
  roomName: { pl: string; en: string };
  inputId: string;
}> {
  const { roomId, roomName, room } = await state.createRoom(
    [{ type: 'game', title: 'Snake' }],
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));

  const inputId = room
    .getInputs()
    .find((input) => input.type === 'game')?.inputId;
  if (!inputId) {
    throw new Error('Failed to create game input in new room');
  }

  const { width, height } = room.getResolution();
  await room.updateLayers([
    {
      id: 'snake-layer',
      inputs: [
        {
          inputId,
          x: 0,
          y: 0,
          width,
          height,
        },
      ],
    },
  ]);

  room.updateSnakeGameState(inputId, gs, gs.events);

  return { roomId, roomName, inputId };
}

const RoomAndInputIdParamsSchema = Type.Object({
  roomId: Type.String({ maxLength: 64, minLength: 1 }),
  inputId: Type.String({ maxLength: 512, minLength: 1 }),
});

type RoomAndInputIdParams = { Params: { roomId: string; inputId: string } };

export function registerSnakeGameRoutes(routes: FastifyInstance): void {
  routes.post<
    RoomAndInputIdParams & { Body: Static<typeof SnakeGameStateSchema> }
  >(
    '/room/:roomId/input/:inputId/game-state',
    {
      schema: {
        params: RoomAndInputIdParamsSchema,
        body: SnakeGameStateSchema,
      },
    },
    async (req, res) => {
      const { roomId, inputId } = req.params;
      const gs = req.body;
      const sourceKey = resolveSnakeGameSourceKey(req, gs.gameId);
      const seqDecision = evaluateSnakeGameSequence(sourceKey, gs.seq);
      if (!seqDecision.shouldProcess) {
        res.status(200).send({
          status: 'ignored',
          reason: 'stale_or_duplicate',
          roomId,
          inputId,
        });
        return;
      }
      const targetKey = `${roomId}::${inputId}`;
      const currentOwner = snakeGameInputOwnerMap.get(targetKey);

      if (currentOwner && currentOwner !== sourceKey) {
        const ownerRoute = snakeGameSourceRouteMap.get(currentOwner);
        const ownerRouteMatchesTarget =
          ownerRoute?.roomId === roomId && ownerRoute?.inputId === inputId;
        const ownerLastSeenAt = snakeGameLastSeenAtMap.get(currentOwner);
        const ownerTimedOut =
          ownerLastSeenAt !== undefined &&
          Date.now() - ownerLastSeenAt > SNAKE_GAME_STATE_TIMEOUT_MS;
        // Never allow two active game sources to write into the same input.
        // New sequence alone (seq=1) is not enough to take ownership.
        const shouldTakeOverOwner = !ownerRouteMatchesTarget || ownerTimedOut;

        if (shouldTakeOverOwner) {
          console.info(
            '[game-state] Taking over explicit room input ownership',
            {
              roomId,
              inputId,
              previousOwner: currentOwner,
              sourceKey,
              reason: !ownerRouteMatchesTarget
                ? 'stale_owner_route'
                : 'owner_timed_out',
            },
          );
          cleanupSnakeGameTrackingForSourceKey(currentOwner);
        } else {
          // Another game stream is trying to update the same input.
          // Route this stream into a dedicated room with a single game input.
          const {
            roomId: newRoomId,
            roomName: newRoomName,
            inputId: newInputId,
          } = await createDedicatedSnakeGameRoom(gs);
          const newTargetKey = `${newRoomId}::${newInputId}`;
          snakeGameInputOwnerMap.set(newTargetKey, sourceKey);
          snakeGameSourceRouteMap.set(sourceKey, {
            roomId: newRoomId,
            inputId: newInputId,
          });
          res.status(200).send({
            status: 'ok',
            rerouted: true,
            outOfOrder: seqDecision.outOfOrder,
            roomId: newRoomId,
            roomName: newRoomName,
            inputId: newInputId,
            roomUrl: `/room/${newRoomId}`,
          });
          return;
        }
      }

      snakeGameInputOwnerMap.set(targetKey, sourceKey);
      snakeGameSourceRouteMap.set(sourceKey, { roomId, inputId });
      const movement = evaluateSnakeGameMovement(sourceKey, gs);
      if (movement.movementTimedOut) {
        const closedRoomId = await closeInactiveSnakeGameRoomForSourceKey(
          sourceKey,
          movement.idleMs,
        );
        res.status(200).send({
          status: 'room_closed_inactive',
          idleMs: movement.idleMs,
          roomId: closedRoomId,
          inputId,
        });
        return;
      }

      const room = state.getRoom(roomId);
      room.updateSnakeGameState(inputId, gs, gs.events);
      resetSnakeGameRoomInactivityTimer(roomId);
      res.status(200).send({
        status: 'ok',
        outOfOrder: seqDecision.outOfOrder,
        roomId,
        roomName: room.roomName,
        inputId,
        roomUrl: `/room/${roomId}`,
      });
    },
  );

  // Global game state — no room needed, broadcasts to all game inputs
  routes.post<{ Body: Static<typeof SnakeGameStateSchema> }>(
    '/game-state',
    { schema: { body: SnakeGameStateSchema } },
    async (req, res) => {
      const gs = req.body;
      const sourceKey = resolveSnakeGameSourceKey(req, gs.gameId);
      const seqDecision = evaluateSnakeGameSequence(sourceKey, gs.seq);
      if (!seqDecision.shouldProcess) {
        res
          .status(200)
          .send({ status: 'ignored', reason: 'stale_or_duplicate' });
        return;
      }
      setGlobalSnakeGameState({
        boardWidth: gs.board.width,
        boardHeight: gs.board.height,
        cellSize: gs.board.cellSize,
        cellGap: gs.board.cellGap ?? 0,
        cells: gs.cells,
        smoothMove: gs.smoothMove === true,
        smoothMoveSpeed: gs.smoothMoveSpeed ?? 1,
        smoothMoveAccel: gs.smoothMoveAccel ?? 3.2,
        smoothMoveDecel: gs.smoothMoveDecel ?? 1.18,
        backgroundColor: gs.backgroundColor,
        boardBorderColor: '#111111',
        boardBorderWidth: 4,
        gridLineColor: '#111111',
        gridLineAlpha: 0.15,
        gameOverData: gs.gameOverData,
      });

      // Wait for any in-progress game room creation to finish before checking
      if (snakeGameRoomCreationInProgress) {
        await snakeGameRoomCreationInProgress;
      }

      let target = snakeGameSourceRouteMap.get(sourceKey);
      let targetRoomId = target?.roomId;
      let targetInputId = target?.inputId;
      const movement = evaluateSnakeGameMovement(sourceKey, gs);
      if (movement.movementTimedOut) {
        const closedRoomId = await closeInactiveSnakeGameRoomForSourceKey(
          sourceKey,
          movement.idleMs,
        );
        res.status(200).send({
          status: 'room_closed_inactive',
          idleMs: movement.idleMs,
          roomId: closedRoomId,
        });
        return;
      }

      // If route became stale (room deleted/input removed), rebuild it.
      if (targetRoomId && targetInputId) {
        const existingInputId = findSnakeGameInputId(targetRoomId);
        if (existingInputId !== targetInputId) {
          targetRoomId = undefined;
          targetInputId = undefined;
          snakeGameSourceRouteMap.delete(sourceKey);
        }
      }

      // Safety guard: never allow two different sources to write into one input.
      if (targetRoomId && targetInputId) {
        const targetKey = `${targetRoomId}::${targetInputId}`;
        const owner = snakeGameInputOwnerMap.get(targetKey);
        if (owner && owner !== sourceKey) {
          targetRoomId = undefined;
          targetInputId = undefined;
          snakeGameSourceRouteMap.delete(sourceKey);
        } else {
          snakeGameInputOwnerMap.set(targetKey, sourceKey);
        }
      }

      if (!targetRoomId || !targetInputId) {
        const createPromise = (async () => {
          const created = await createDedicatedSnakeGameRoom(gs);
          snakeGameSourceRouteMap.set(sourceKey, created);
          snakeGameInputOwnerMap.set(
            `${created.roomId}::${created.inputId}`,
            sourceKey,
          );
          return created;
        })();

        snakeGameRoomCreationInProgress = createPromise.then(() => {});
        try {
          const created = await createPromise;
          targetRoomId = created.roomId;
          targetInputId = created.inputId;
        } finally {
          snakeGameRoomCreationInProgress = null;
        }
      } else {
        const room = state.getRoom(targetRoomId);
        room.updateSnakeGameState(targetInputId, gs, gs.events);
      }

      if (targetRoomId) {
        resetSnakeGameRoomInactivityTimer(targetRoomId);
      }

      const roomUrl = targetRoomId ? `/room/${targetRoomId}` : undefined;
      let targetRoomName: { pl: string; en: string } | undefined;
      if (targetRoomId) {
        try {
          targetRoomName = state.getRoom(targetRoomId).roomName;
        } catch {
          /* room may have been deleted */
        }
      }
      res.status(200).send({
        status: 'ok',
        outOfOrder: seqDecision.outOfOrder,
        roomId: targetRoomId,
        roomName: targetRoomName,
        inputId: targetInputId,
        roomUrl,
      });
    },
  );
}
