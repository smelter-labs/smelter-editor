import type { InputCard } from "../types/input";
import type { GridLayout } from "../types/layout";
import type {
  LayoutResponse,
  PublicInputState,
  RoomState,
} from "../types/room";

export interface ActiveRoom {
  roomId: string;
  roomName: string | Record<string, string>;
}

/** Get a display-friendly name from a possibly-localized roomName. */
export function getRoomDisplayName(room: ActiveRoom): string {
  if (typeof room.roomName === "string") return room.roomName;
  // Try English first, then first available value, then fall back to roomId
  return room.roomName.en ?? Object.values(room.roomName)[0] ?? room.roomId;
}

/**
 * REST API service for communicating with the Smelter server.
 */
class ApiService {
  /**
   * Build an HTTP base URL from a raw server address.
   * Accepts "host:port", "http://...", "https://...", or "ws://..." / "wss://...".
   */
  private buildHttpUrl(serverUrl: string): string {
    const trimmed = serverUrl.trim().replace(/\/+$/, "");

    if (/^https?:\/\//i.test(trimmed)) return trimmed;

    if (/^wss?:\/\//i.test(trimmed)) {
      const parsed = new URL(trimmed);
      parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
      return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
    }

    return `http://${trimmed}`;
  }

  /**
   * Fetch the list of active rooms from the server.
   * GET /active-rooms -> { rooms: [{ roomId, roomName }] }
   */
  async fetchActiveRooms(serverUrl: string): Promise<ActiveRoom[]> {
    const base = this.buildHttpUrl(serverUrl);
    const res = await fetch(`${base}/active-rooms`);

    if (!res.ok) {
      throw new Error(`Failed to fetch rooms (${res.status})`);
    }

    const data = (await res.json()) as { rooms: ActiveRoom[] };
    return data.rooms;
  }

  /**
   * Fetch the complete room state snapshot.
   * GET /room/:roomId -> full RoomState
   */
  async fetchRoomState(
    serverUrl: string,
    roomId: string,
  ): Promise<{
    inputs: InputCard[];
    layout: GridLayout;
  }> {
    const base = this.buildHttpUrl(serverUrl);
    const res = await fetch(`${base}/room/${encodeURIComponent(roomId)}`);

    if (!res.ok) {
      throw new Error(`Failed to fetch room state (${res.status})`);
    }

    const roomState = (await res.json()) as RoomState;
    console.log(
      "[API] fetchRoomState raw response:",
      JSON.stringify(roomState, null, 2),
    );
    return {
      inputs: this.mapInputsToCards(roomState.inputs),
      layout: this.mapLayoutResponse(roomState.layout),
    };
  }

  /**
   * Hide an input (remove from output).
   * POST /room/:roomId/input/:inputId/hide
   */
  async hideInput(
    serverUrl: string,
    roomId: string,
    inputId: string,
  ): Promise<void> {
    const base = this.buildHttpUrl(serverUrl);
    const res = await fetch(
      `${base}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/hide`,
      {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!res.ok) throw new Error(`hideInput failed (${res.status})`);
  }

  /**
   * Show an input (add back to output).
   * POST /room/:roomId/input/:inputId/show
   */
  async showInput(
    serverUrl: string,
    roomId: string,
    inputId: string,
  ): Promise<void> {
    const base = this.buildHttpUrl(serverUrl);
    const res = await fetch(
      `${base}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/show`,
      {
        method: "POST",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!res.ok) throw new Error(`showInput failed (${res.status})`);
  }

  /**
   * Delete an input from the room.
   * DELETE /room/:roomId/input/:inputId
   */
  async removeInput(
    serverUrl: string,
    roomId: string,
    inputId: string,
  ): Promise<void> {
    const base = this.buildHttpUrl(serverUrl);
    const res = await fetch(
      `${base}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`removeInput failed (${res.status})`);
  }

  /**
   * Map a server input_updated payload to Partial<InputCard> for store updates.
   */
  mapInputUpdateToCardChanges(
    input: Record<string, unknown>,
  ): Partial<InputCard> {
    const changes: Partial<InputCard> = {};
    if (typeof input.title === "string") changes.name = input.title;
    if (typeof input.name === "string") changes.name = input.name;
    if (typeof input.isRunning === "boolean") {
      changes.isRunning = input.isRunning;
    } else if (typeof input.sourceState === "string") {
      changes.isRunning =
        input.sourceState === "live" || input.sourceState === "always-live";
    } else if (typeof input.status === "string") {
      changes.isRunning = input.status === "connected";
    }
    if (input.hidden !== undefined) changes.isHidden = input.hidden as boolean;
    if (typeof input.isMuted === "boolean") {
      changes.isMuted = input.isMuted;
    } else if (typeof input.volume === "number") {
      changes.isMuted = input.volume <= 0;
    }
    if (input.isAudioOnly !== undefined)
      changes.isAudioOnly = input.isAudioOnly as boolean;
    if (typeof input.movementPercent === "number") {
      changes.movementPercent = input.movementPercent;
    } else if (typeof input.motionScore === "number") {
      changes.movementPercent = input.motionScore;
    }
    if (input.audioLevel !== undefined)
      changes.audioLevel = input.audioLevel as number;
    if (input.volume !== undefined)
      changes.inputVolume = input.volume as number;
    if (input.videoStreamUrl !== undefined)
      changes.videoStreamUrl = input.videoStreamUrl as string | null;
    if (input.displaySize !== undefined)
      changes.displaySize = input.displaySize as number;
    return changes;
  }

  /**
   * Map server PublicInputState array to mobile InputCard format.
   */
  private mapInputsToCards(inputs: PublicInputState[]): InputCard[] {
    return inputs.map((input) => ({
      id: input.inputId,
      name: input.title || "Unknown Input",
      isRunning:
        (input as { isRunning?: boolean }).isRunning ??
        (input.sourceState
          ? input.sourceState === "live" || input.sourceState === "always-live"
          : input.status === "connected"),
      isHidden: input.hidden ?? false,
      isMuted:
        (input as { isMuted?: boolean }).isMuted ??
        (typeof input.volume === "number" ? input.volume <= 0 : false),
      isAudioOnly: (input as { isAudioOnly?: boolean }).isAudioOnly ?? false,
      movementPercent:
        (input as { movementPercent?: number }).movementPercent ??
        input.motionScore ??
        0,
      inputVolume: (input.volume as number) ?? 0.7,
      audioLevel: (input as { audioLevel?: number }).audioLevel ?? 0,
      videoStreamUrl:
        (input as { videoStreamUrl?: string | null }).videoStreamUrl ?? null,
      displaySize: (input as { displaySize?: number }).displaySize ?? 0,
    }));
  }

  /**
   * Map server layout response to mobile GridLayout format.
   */
  private mapLayoutResponse(layout: LayoutResponse): GridLayout {
    return {
      items: (layout.items ?? []).map((item) => ({
        id: item.id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        label: item.label || "",
      })),
      columns: layout.columns ?? 4,
      rows: layout.rows ?? 3,
    };
  }
}

export const apiService = new ApiService();
