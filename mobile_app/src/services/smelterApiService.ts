// API service for camera/WHIP-specific calls to the Smelter server.
// General room fetching is still handled by apiService.ts.
import { buildHttpUrl } from "./apiService";

export interface JoinRoomAsWhipResult {
  inputId: string;
  bearerToken: string;
  whipUrl: string;
}

export class SmelterApiService {
  private baseUrl: string;
  private roomId: string;

  private encodePathSegment(value: string): string {
    return encodeURIComponent(value);
  }

  constructor(serverUrl: string, roomId: string) {
    this.baseUrl = buildHttpUrl(serverUrl);
    this.roomId = roomId;
    // console.log("[SmelterAPI] baseUrl:", this.baseUrl, "roomId:", roomId);
  }

  /**
   * The server may return a whipUrl using its own loopback address.
   * Rewrite only the hostname to use the real server hostname so the phone can reach it,
   * while preserving the original protocol and port.
   * e.g. http://127.0.0.1:9000/whip/xxx → http://192.168.x.x:9000/whip/xxx
   */
  fixWhipUrl(whipUrl: string): string {
    try {
      const base = new URL(this.baseUrl);
      const whip = new URL(whipUrl);
      const isLoopbackHost =
        whip.hostname === "127.0.0.1" ||
        whip.hostname === "localhost" ||
        whip.hostname === "::1" ||
        whip.hostname === "[::1]";

      if (!isLoopbackHost) {
        return whipUrl;
      }

      whip.hostname = base.hostname;
      const fixed = whip.toString();
      console.log("[SmelterAPI] fixWhipUrl:", whipUrl, "→", fixed);
      return fixed;
    } catch {
      console.warn(
        "[SmelterAPI] fixWhipUrl: could not parse URL, using as-is:",
        whipUrl,
      );
      return whipUrl;
    }
  }

  /** Register this device as a WHIP input. Returns whipUrl, bearerToken, inputId. */
  async joinRoomAsWhip(username: string): Promise<JoinRoomAsWhipResult> {
    const response = await fetch(
      `${this.baseUrl}/room/${this.encodePathSegment(this.roomId)}/input`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "whip", username }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Failed to register WHIP input (${response.status}): ${body}`,
      );
    }

    return response.json() as Promise<JoinRoomAsWhipResult>;
  }

  /** Acknowledge that the WHIP WebRTC connection is established. */
  async ackWhip(inputId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/room/${this.encodePathSegment(this.roomId)}/input/${this.encodePathSegment(inputId)}/whip/ack`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`WHIP ack failed (${response.status}): ${body}`);
    }
  }

  /** Tell the server to connect this input so the WHIP endpoint accepts streams. */
  async connectInput(inputId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/room/${this.encodePathSegment(this.roomId)}/input/${this.encodePathSegment(inputId)}/connect`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Connect input failed (${response.status}): ${body}`);
    }
  }

  /** Tell the server to disconnect this input. */
  async disconnectInput(inputId: string): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/room/${this.encodePathSegment(this.roomId)}/input/${this.encodePathSegment(inputId)}/disconnect`,
      { method: "POST" },
    );
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Disconnect input failed (${response.status}): ${body}`);
    }
  }
}
