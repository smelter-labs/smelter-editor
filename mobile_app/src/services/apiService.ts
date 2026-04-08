import type { InputCard } from "../types/input";
import type { Layer } from "../types/layout";
import type {
  Resolution,
  ShaderConfig,
  ShaderParamDefinition,
} from "@smelter-editor/types";
import type { PublicInputState, RoomState } from "../types/room";

export interface AvailableShader {
  id: string;
  name: string;
  description?: string;
  shaderFile?: string;
  params?: ShaderParamDefinition[];
}

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
  private logSyncSend(method: string, route: string, body?: unknown): void {
    console.log(
      `[${new Date().toISOString()}] [sync][mobile-send] ${method} ${route}`,
      body ?? "",
    );
  }

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
    layers: Layer[];
    resolution: Resolution;
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
      layers: roomState.layers ?? [],
      resolution: roomState.resolution ?? { width: 1920, height: 1080 },
    };
  }

  async updateLayers(
    serverUrl: string,
    roomId: string,
    layers: Layer[],
    sourceId?: string,
  ): Promise<Layer[]> {
    const base = this.buildHttpUrl(serverUrl);
    this.logSyncSend("POST", `/room/${encodeURIComponent(roomId)}`, {
      layers,
      ...(sourceId ? { sourceId } : {}),
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (sourceId) {
      headers["x-source-id"] = sourceId;
    }
    const res = await fetch(`${base}/room/${encodeURIComponent(roomId)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ layers }),
    });
    if (!res.ok) throw new Error(`updateLayers failed (${res.status})`);
    // The server returns the authoritative (possibly recomputed) layers so we
    // can apply any corrections immediately without a second GET round-trip.
    const data = (await res.json()) as { layers?: Layer[] };
    if (!Array.isArray(data.layers)) {
      throw new Error("updateLayers failed: missing layers in response");
    }
    return data.layers;
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
    this.logSyncSend(
      "POST",
      `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/hide`,
      {},
    );
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
    this.logSyncSend(
      "POST",
      `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}/show`,
      {},
    );
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
    this.logSyncSend(
      "DELETE",
      `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
      {},
    );
    const res = await fetch(
      `${base}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error(`removeInput failed (${res.status})`);
  }

  async updateInput(
    serverUrl: string,
    roomId: string,
    inputId: string,
    opts: Record<string, unknown>,
  ): Promise<void> {
    const base = this.buildHttpUrl(serverUrl);
    this.logSyncSend(
      "POST",
      `/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
      opts,
    );
    const res = await fetch(
      `${base}/room/${encodeURIComponent(roomId)}/input/${encodeURIComponent(inputId)}`,
      {
        method: "POST",
        body: JSON.stringify(opts),
        headers: { "Content-Type": "application/json" },
      },
    );
    if (!res.ok) throw new Error(`updateInput failed (${res.status})`);
  }

  async getAvailableShaders(serverUrl: string): Promise<AvailableShader[]> {
    const base = this.buildHttpUrl(serverUrl);
    const res = await fetch(`${base}/shaders`);
    if (!res.ok) {
      throw new Error(`Failed to fetch shaders (${res.status})`);
    }
    const payload = (await res.json()) as { shaders?: AvailableShader[] };
    return payload.shaders ?? [];
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
    if (Array.isArray(input.shaders)) {
      changes.shaders = input.shaders as ShaderConfig[];
    }
    return changes;
  }

  /**
   * Map server PublicInputState array to mobile InputCard format.
   */
  mapInputsToCards(inputs: PublicInputState[]): InputCard[] {
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
      shaders: (input.shaders as ShaderConfig[] | undefined) ?? [],
      nativeWidth: input.nativeWidth,
      nativeHeight: input.nativeHeight,
    }));
  }
}

export const apiService = new ApiService();
