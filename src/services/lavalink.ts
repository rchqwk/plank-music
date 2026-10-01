import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { config } from "../config";
import type {
  LavalinkEvent,
  LavalinkLoadResult,
  LavalinkPlayer,
  LavalinkPlayerState,
  LavalinkTrack,
  LavalinkVoiceState,
} from "../types/lavalink";

/**
 * Thin client for a single Lavalink v4 node.
 *
 * Emits the following events:
 *  - "ready"      (sessionId: string, resumed: boolean)
 *  - "trackStart" (guildId: string, track: LavalinkTrack)
 *  - "trackEnd"   (guildId: string, track: LavalinkTrack, reason: string)
 *  - "trackException" (guildId: string, track: LavalinkTrack, exception: unknown)
 *  - "trackStuck" (guildId: string, track: LavalinkTrack, thresholdMs: number)
 *  - "playerUpdate" (guildId: string, state: LavalinkPlayerState)
 *  - "websocketClosed" (guildId: string, code: number, reason: string, byRemote: boolean)
 *  - "error"      (error: Error)
 *  - "reconnect"  (attempt: number)
 *  - "closed"     (code: number, reason: string)
 */
export class LavalinkClient {
  readonly events = new EventEmitter();

  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private closed = true;

  get baseUrl(): string {
    const scheme = config.lavalink.secure ? "https" : "http";
    return `${scheme}://${config.lavalink.host}:${config.lavalink.port}`;
  }

  get wsUrl(): string {
    const scheme = config.lavalink.secure ? "wss" : "ws";
    return `${scheme}://${config.lavalink.host}:${config.lavalink.port}/v4/websocket`;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  connect(): void {
    this.closed = false;
    this.openSocket();
  }

  private openSocket(): void {
    const headers: Record<string, string> = {
      Authorization: config.lavalink.password,
      "User-Id": config.lavalink.userId,
      "Client-Name": config.lavalink.clientName,
    };
    if (this.sessionId) {
      headers["Session-Id"] = this.sessionId;
    }

    const ws = new WebSocket(this.wsUrl, { headers });
    this.ws = ws;

    ws.on("open", () => {
      this.reconnectAttempts = 0;
    });

    ws.on("message", (data) => {
      let msg: LavalinkEvent;
      try {
        msg = JSON.parse(data.toString()) as LavalinkEvent;
      } catch {
        return;
      }
      this.handleMessage(msg);
    });

    ws.on("error", (err) => {
      this.events.emit("error", err);
    });

    ws.on("close", (code, reasonBuf) => {
      const reason = reasonBuf.toString();
      this.events.emit("closed", code, reason);
      if (!this.closed) {
        this.scheduleReconnect();
      }
    });
  }

  private handleMessage(msg: LavalinkEvent): void {
    switch (msg.op) {
      case "ready":
        this.sessionId = msg.sessionId;
        this.events.emit("ready", msg.sessionId, msg.resumed);
        break;
      case "playerUpdate":
        this.events.emit("playerUpdate", msg.guildId, msg.state);
        break;
      case "stats":
        // Stats are informational; no handler needed by default.
        break;
      case "event":
        switch (msg.type) {
          case "TrackStartEvent":
            this.events.emit("trackStart", msg.guildId, msg.track);
            break;
          case "TrackEndEvent":
            this.events.emit("trackEnd", msg.guildId, msg.track, msg.reason);
            break;
          case "TrackExceptionEvent":
            this.events.emit("trackException", msg.guildId, msg.track, msg.exception);
            break;
          case "TrackStuckEvent":
            this.events.emit("trackStuck", msg.guildId, msg.track, msg.thresholdMs);
            break;
          case "WebSocketClosedEvent":
            this.events.emit("websocketClosed", msg.guildId, msg.code, msg.reason, msg.byRemote);
            break;
        }
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    const attempt = this.reconnectAttempts;
    // Exponential backoff capped at 30s.
    const delay = Math.min(1000 * 2 ** Math.min(attempt - 1, 6), 30_000);
    this.events.emit("reconnect", attempt);
    setTimeout(() => {
      this.reconnecting = false;
      if (!this.closed) {
        this.openSocket();
      }
    }, delay);
  }

  close(): void {
    this.closed = true;
    this.ws?.close(1000, "Client shutting down");
    this.ws = null;
  }

  // ------------------------------------------------------------------
  // REST API
  // ------------------------------------------------------------------
  private async rest<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: config.lavalink.password,
        "Content-Type": "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Lavalink REST ${method} ${path} failed (${res.status}): ${text}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async loadTracks(identifier: string): Promise<LavalinkLoadResult> {
    return this.rest<LavalinkLoadResult>(
      "GET",
      `/v4/loadtracks?identifier=${encodeURIComponent(identifier)}`,
    );
  }

  async decodeTrack(encoded: string): Promise<LavalinkTrack> {
    return this.rest<LavalinkTrack>(
      "GET",
      `/v4/decodetrack?encodedTrack=${encodeURIComponent(encoded)}`,
    );
  }

  async getPlayers(sessionId: string): Promise<LavalinkPlayer[]> {
    return this.rest<LavalinkPlayer[]>("GET", `/v4/sessions/${sessionId}/players`);
  }

  async getPlayer(sessionId: string, guildId: string): Promise<LavalinkPlayer> {
    return this.rest<LavalinkPlayer>(
      "GET",
      `/v4/sessions/${sessionId}/players/${encodeURIComponent(guildId)}`,
    );
  }

  async updatePlayer(
    sessionId: string,
    guildId: string,
    body: Record<string, unknown>,
  ): Promise<LavalinkPlayer> {
    return this.rest<LavalinkPlayer>(
      "PATCH",
      `/v4/sessions/${sessionId}/players/${encodeURIComponent(guildId)}`,
      body,
    );
  }

  async updateVoice(
    sessionId: string,
    guildId: string,
    voice: Partial<LavalinkVoiceState>,
  ): Promise<void> {
    await this.rest<void>(
      "PATCH",
      `/v4/sessions/${sessionId}/players/${encodeURIComponent(guildId)}/voice`,
      voice,
    );
  }

  async destroyPlayer(sessionId: string, guildId: string): Promise<void> {
    await this.rest<void>(
      "DELETE",
      `/v4/sessions/${sessionId}/players/${encodeURIComponent(guildId)}`,
    );
  }
}
