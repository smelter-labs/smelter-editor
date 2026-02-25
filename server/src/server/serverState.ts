import type { RegisterInputOptions } from './roomState';
import { RoomState } from './roomState';
import { v4 as uuidv4 } from 'uuid';
import { errorCodes } from 'fastify';
import { SmelterInstance, type Resolution, RESOLUTION_PRESETS } from '../smelter';

export type CreateRoomResult = {
  roomId: string;
  room: RoomState;
};

const ROOM_COUNT_SOFT_LIMIT = 3;
const ROOM_COUNT_HARD_LIMIT = 5;
const SOFT_LIMIT_ROOM_DELETE_DELAY = 20_000;
const whipStaleTtlFromEnv = Number(process.env.WHIP_STALE_TTL_MS);
const WHIP_STALE_TTL_MS =
  Number.isFinite(whipStaleTtlFromEnv) && whipStaleTtlFromEnv > 0
    ? whipStaleTtlFromEnv
    : 15_000;

class ServerState {
  private rooms: Record<string, RoomState> = {};
  public getRooms(): RoomState[] {
    return Object.values(this.rooms);
  }

  public isChannelIdUsed(channelId: string): boolean {
    return this.getRooms().some(room =>
      room
        .getInputs()
        .some(
          input =>
            (input.type === 'kick-channel' || input.type === 'twitch-channel') &&
            input.channelId === channelId
        )
    );
  }

  constructor() {
    setInterval(async () => {
      await this.monitorConnectedRooms();
    }, 1000);

    // Listen for Smelter engine events to auto-touch WHIP monitors.
    // When the engine reports VIDEO_INPUT_DELIVERED or VIDEO_INPUT_PLAYING
    // it means RTP packets are still flowing — the connection is alive
    // regardless of whether the client JS heartbeat is paused (e.g. mobile
    // browser backgrounded).
    SmelterInstance.registerEventListener((event: any) => {
      if (
        event?.type === 'VIDEO_INPUT_DELIVERED' ||
        event?.type === 'VIDEO_INPUT_PLAYING'
      ) {
        const inputId: string | undefined = event.input_id;
        if (!inputId) return;
        this.touchWhipMonitorByInputId(inputId);
      }
    });
  }

  /**
   * Find the WHIP monitor for a given inputId across all rooms and touch it.
   * Called from the Smelter event listener to keep the monitor alive as long
   * as the engine is still receiving media frames.
   */
  private touchWhipMonitorByInputId(inputId: string): void {
    for (const room of Object.values(this.rooms)) {
      try {
        const input = room.getInputs().find(i => i.inputId === inputId);
        if (input?.type === 'whip') {
          input.monitor.touch();
          return;
        }
      } catch {
        // room may have been deleted concurrently
      }
    }
  }

  public async createRoom(
    initInputs: RegisterInputOptions[],
    skipDefaultInputs: boolean = false,
    resolution?: Resolution,
  ): Promise<CreateRoomResult> {
    const roomId = uuidv4();
    const resolvedResolution = resolution ?? RESOLUTION_PRESETS['1440p'];
    const smelterOutput = await SmelterInstance.registerOutput(roomId, resolvedResolution);
    const room = new RoomState(roomId, smelterOutput, initInputs, skipDefaultInputs);
    this.rooms[roomId] = room;
    return { roomId, room };
  }

  public getRoom(roomId: string): RoomState {
    const room = this.rooms[roomId];
    if (!room) {
      throw new errorCodes.FST_ERR_NOT_FOUND(`Room ${roomId} does not exist.`);
    }
    return room;
  }

  public async deleteRoom(roomId: string) {
    const room = this.rooms[roomId];
    delete this.rooms[roomId];
    if (!room) {
      throw new Error(`Room ${roomId} does not exist.`);
    }
    await room.deleteRoom();
  }

  private async monitorConnectedRooms() {
    let rooms = Object.entries(this.rooms);
    rooms.sort(([_aId, aRoom], [_bId, bRoom]) => bRoom.creationTimestamp - aRoom.creationTimestamp);
    // Remove WHIP inputs that haven't acked within configured TTL.
    for (const [_roomId, room] of rooms) {
      await room.removeStaleWhipInputs(WHIP_STALE_TTL_MS);
    }
    for (const [roomId, room] of rooms) {
      if (Date.now() - room.lastReadTimestamp > 60_000) {
        try {
          console.log('Stop from inactivity');
          await this.deleteRoom(roomId);
        } catch (err: any) {
          console.log(err, `Failed to remove room ${roomId}`);
        }
      }
    }

    // recalculate the rooms
    rooms = Object.entries(this.rooms);
    rooms.sort(([_aId, aRoom], [_bId, bRoom]) => bRoom.creationTimestamp - aRoom.creationTimestamp);

    if (rooms.length > ROOM_COUNT_HARD_LIMIT) {
      for (const [roomId, _room] of rooms.slice(ROOM_COUNT_HARD_LIMIT - rooms.length)) {
        try {
          console.log('Stop from hard limit');
          await this.deleteRoom(roomId).catch(() => {});
        } catch (err: any) {
          console.log(err, `Failed to remove room ${roomId}`);
        }
      }
    }

    if (rooms.length > ROOM_COUNT_SOFT_LIMIT) {
      for (const [roomId, room] of rooms.slice(ROOM_COUNT_SOFT_LIMIT - rooms.length)) {
        if (room.pendingDelete) {
          continue;
        }
        try {
          console.log('Schedule stop from soft limit');
          room.pendingDelete = true;
          setTimeout(async () => {
            console.log('Stop from soft limit');
            await this.deleteRoom(roomId).catch(() => {});
          }, SOFT_LIMIT_ROOM_DELETE_DELAY);
        } catch (err: any) {
          console.log(err, `Failed to remove room ${roomId}`);
        }
      }
    }
  }
}

export const state = new ServerState();
