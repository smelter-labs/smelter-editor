import type { RegisterInputOptions } from './roomState';
import { RoomState } from './roomState';
export type CreateRoomResult = {
    roomId: string;
    room: RoomState;
};
declare class ServerState {
    private rooms;
    getRooms(): RoomState[];
    isChannelIdUsed(channelId: string): boolean;
    constructor();
    createRoom(initInputs: RegisterInputOptions[]): Promise<CreateRoomResult>;
    getRoom(roomId: string): RoomState;
    deleteRoom(roomId: string): Promise<void>;
    private monitorConnectedRooms;
}
export declare const state: ServerState;
export {};
