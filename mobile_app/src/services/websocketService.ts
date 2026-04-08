import type { WSEventKey, WSEventPayload } from "../types/websocket";

type Listener<K extends WSEventKey> = (payload: WSEventPayload<K>) => void;

/**
 * Central WebSocket client for receiving server-pushed events.
 *
 * The Smelter server exposes a read-only WS endpoint at
 *   /room/:roomId/ws
 * that broadcasts flat JSON messages like:
 *   { type: "input_updated", roomId, inputId, input, sourceId }
 *
 * All mutations go through the REST API, so `emit()` is intentionally removed.
 */
class WebSocketService {
  private ws: WebSocket | null = null;
  private listeners = new Map<WSEventKey, Set<Listener<WSEventKey>>>();
  private connectionTimeout = 8000;

  async connect(serverUrl: string, roomId: string): Promise<void> {
    this.disconnect();

    const wsUrl = this.buildWsUrl(serverUrl, roomId);
    console.log("[WS] Connecting to", wsUrl);
    console.log("[WS] connect:start", {
      serverUrl,
      roomId,
      timeoutMs: this.connectionTimeout,
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let opened = false;

      const socket = new WebSocket(wsUrl);
      this.ws = socket;

      const settleReject = (message: string) => {
        if (settled) return;
        settled = true;
        if (this.ws === socket) {
          this.ws = null;
        }
        console.warn("[WS] connect:reject", {
          message,
          serverUrl,
          roomId,
          wsUrl,
        });
        reject(new Error(message));
      };

      const timeout = setTimeout(() => {
        if (opened) return;
        console.warn("[WS] connect:timeout", {
          wsUrl,
          timeoutMs: this.connectionTimeout,
        });
        socket.close();
        settleReject("Connection timed out");
      }, this.connectionTimeout);

      socket.onopen = () => {
        opened = true;
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        console.log("[WS] Connected");
        console.log("[WS] connect:open", { wsUrl, roomId });

        socket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type) {
              const summary =
                data.type === "room_updated"
                  ? {
                      roomId: data.roomId,
                      layers: Array.isArray(data.layers)
                        ? data.layers.length
                        : 0,
                      inputs: Array.isArray(data.inputs)
                        ? data.inputs.length
                        : 0,
                    }
                  : {
                      roomId: data.roomId,
                      inputId: data.inputId,
                      sourceId: data.sourceId,
                    };
              console.log(
                `[${new Date().toISOString()}] [sync][mobile-recv] ${data.type}`,
                summary,
              );
              this.dispatchEvent(data.type as WSEventKey, data);
            }
          } catch (err) {
            console.warn("[WS] Failed to parse message:", event.data, err);
          }
        };

        socket.onerror = (error) => {
          console.error("[WS] Error:", error);
        };

        socket.onclose = (event) => {
          if (this.ws === socket) {
            this.ws = null;
          }
          console.log("[WS] Disconnected", event.code, event.reason);
          this.dispatchEvent("disconnected", {
            type: "disconnected",
            code: event.code,
            reason: event.reason || "Unknown",
          });
        };
        socket.send(JSON.stringify({ type: "identify", name: "Mobile App" }));
        resolve();
      };

      socket.onerror = (error) => {
        console.error("[WS] Error:", error);
        if (opened || settled) return;
        console.warn("[WS] connect:error-before-open", { wsUrl, error });
        clearTimeout(timeout);
        socket.close();
        settleReject("WebSocket connection was rejected");
      };

      socket.onclose = (event) => {
        if (opened || settled) return;
        console.warn("[WS] connect:closed-before-open", {
          wsUrl,
          code: event.code,
          reason: event.reason,
        });
        clearTimeout(timeout);
        const reason = event.reason || "WebSocket connection was rejected";
        settleReject(reason);
      };
    });

    console.log("[WS] connect:resolved", { wsUrl, roomId });
  }

  private buildWsUrl(serverUrl: string, roomId: string): string {
    const trimmedServerUrl = serverUrl.trim().replace(/\/+$/, "");

    let baseUrl: string;
    if (/^wss?:\/\//i.test(trimmedServerUrl)) {
      baseUrl = trimmedServerUrl;
    } else if (/^https?:\/\//i.test(trimmedServerUrl)) {
      const parsed = new URL(trimmedServerUrl);
      parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
      baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
    } else {
      baseUrl = `ws://${trimmedServerUrl}`;
    }

    return `${baseUrl}/room/${encodeURIComponent(roomId)}/ws`;
  }

  /**
   * Subscribe to a WebSocket event. Returns an unsubscribe function.
   */
  on<K extends WSEventKey>(event: K, handler: Listener<K>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(handler as Listener<WSEventKey>);

    return () => {
      set.delete(handler as Listener<WSEventKey>);
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.onclose = null; // Prevent reconnect on manual disconnect
      this.ws.close();
      this.ws = null;
    }
    console.log("[WS] Manually disconnected");
  }

  private dispatchEvent<K extends WSEventKey>(
    event: K,
    payload: unknown,
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((handler) => {
      try {
        (handler as Listener<K>)(payload as WSEventPayload<K>);
      } catch (err) {
        console.error("[WS] Error in handler for event:", event, err);
      }
    });
  }
}

export const wsService = new WebSocketService();
