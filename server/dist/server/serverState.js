"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.state = void 0;
const roomState_1 = require("./roomState");
const uuid_1 = require("uuid");
const fastify_1 = require("fastify");
const smelter_1 = require("../smelter");
const ROOM_COUNT_SOFT_LIMIT = 3;
const ROOM_COUNT_HARD_LIMIT = 5;
const SOFT_LIMIT_ROOM_DELETE_DELAY = 20000;
const WHIP_STALE_TTL_MS = 15000;
class ServerState {
    getRooms() {
        return Object.values(this.rooms);
    }
    isChannelIdUsed(channelId) {
        return this.getRooms().some(room => room
            .getInputs()
            .some(input => (input.type === 'kick-channel' || input.type === 'twitch-channel') &&
            input.channelId === channelId));
    }
    constructor() {
        this.rooms = {};
        setInterval(async () => {
            await this.monitorConnectedRooms();
        }, 1000);
    }
    async createRoom(initInputs) {
        const roomId = (0, uuid_1.v4)();
        const smelterOutput = await smelter_1.SmelterInstance.registerOutput(roomId);
        const room = new roomState_1.RoomState(roomId, smelterOutput, initInputs);
        this.rooms[roomId] = room;
        return { roomId, room };
    }
    getRoom(roomId) {
        const room = this.rooms[roomId];
        if (!room) {
            throw new fastify_1.errorCodes.FST_ERR_NOT_FOUND(`Room ${roomId} does not exists.`);
        }
        return room;
    }
    async deleteRoom(roomId) {
        const room = this.rooms[roomId];
        delete this.rooms[roomId];
        if (!room) {
            throw new Error(`Room ${roomId} does not exists.`);
        }
        await room.deleteRoom();
    }
    async monitorConnectedRooms() {
        let rooms = Object.entries(this.rooms);
        rooms.sort(([_aId, aRoom], [_bId, bRoom]) => bRoom.creationTimestamp - aRoom.creationTimestamp);
        // Remove WHIP inputs that haven't acked within 15 s
        for (const [_roomId, room] of rooms) {
            await room.removeStaleWhipInputs(WHIP_STALE_TTL_MS);
        }
        for (const [roomId, room] of rooms) {
            if (Date.now() - room.lastReadTimestamp > 60000) {
                try {
                    console.log('Stop from inactivity');
                    await this.deleteRoom(roomId);
                }
                catch (err) {
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
                    await this.deleteRoom(roomId).catch(() => { });
                }
                catch (err) {
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
                        await this.deleteRoom(roomId).catch(() => { });
                    }, SOFT_LIMIT_ROOM_DELETE_DELAY);
                }
                catch (err) {
                    console.log(err, `Failed to remove room ${roomId}`);
                }
            }
        }
    }
}
exports.state = new ServerState();
