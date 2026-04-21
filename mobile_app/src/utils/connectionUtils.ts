/**
 * ConnectionData — utility class for parsing and validating connection data.
 */
export class ConnectionData {
  readonly serverUrl: string;
  readonly roomId: string;

  private constructor(serverUrl: string, roomId: string) {
    this.serverUrl = serverUrl;
    this.roomId = roomId;
  }

  /**
   * Parse connection data from a QR code string.
   * Accepts JSON format: { "serverUrl": "...", "roomId": "..." }
   * URL query format: smelter://connect?serverUrl=...&roomId=...
   * or URL path format: wss://host/room/<roomId>
   */
  static fromQRString(raw: string): ConnectionData | null {
    const normalized = raw.trim();

    try {
      // Try JSON first
      const parsed = JSON.parse(normalized) as Record<string, unknown>;
      if (
        typeof parsed.serverUrl === "string" &&
        typeof parsed.roomId === "string"
      ) {
        return new ConnectionData(parsed.serverUrl, parsed.roomId);
      }
    } catch {
      // Not JSON — try URL format
    }

    try {
      const url = new URL(normalized);
      const serverUrl = url.searchParams.get("serverUrl");
      const roomId = url.searchParams.get("roomId");
      if (serverUrl && roomId) {
        return new ConnectionData(serverUrl, roomId);
      }

      const pathMatch = url.pathname.match(/^\/?room\/([^/?#]+)\/?$/i);
      if (pathMatch?.[1]) {
        return new ConnectionData(url.origin, decodeURIComponent(pathMatch[1]));
      }
    } catch {
      // Not a URL either
    }

    return null;
  }

  static fromManualInput(serverUrl: string, roomId: string): ConnectionData {
    return new ConnectionData(serverUrl.trim(), roomId.trim());
  }

  isValid(): boolean {
    if (!this.serverUrl || !this.roomId) return false;
    try {
      // Accept both http/https and ws/wss schemes
      const urlWithScheme = /^(https?|wss?)/.test(this.serverUrl)
        ? this.serverUrl
        : `http://${this.serverUrl}`;
      new URL(urlWithScheme);
      return this.roomId.length > 0;
    } catch {
      return false;
    }
  }
}
