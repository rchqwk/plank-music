import { config } from "./config.js";

export interface Track { id: string; title: string; author: string; durationMs: number; thumbnail: string | null; url: string; }
export interface PlayerState { current: Track | null; queue: Track[]; paused: boolean; positionMs: number; repeat: string; volume: number; }

export class BackendClient {
  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${config.backendUrl}${path}`, { ...options, headers: { "Content-Type": "application/json", "x-player-bot-token": config.playerBotToken, ...(options.headers || {}) }, signal: AbortSignal.timeout(15_000) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error((data as { error?: string }).error || `Backend request failed (${response.status})`);
    return data as T;
  }

  state(playerId: string): Promise<PlayerState> { return this.request(`/api/player/state?playerId=${encodeURIComponent(playerId)}`); }
  play(playerId: string, query: string): Promise<PlayerState> { return this.command("play", playerId, { query }); }
  queue(playerId: string, query: string): Promise<PlayerState> { return this.command("queue", playerId, { query }); }
  command(action: string, playerId: string, body: Record<string, unknown> = {}): Promise<PlayerState> { return this.request(`/api/player/${action}`, { method: "POST", body: JSON.stringify({ ...body, playerId }) }); }
  voice(playerId: string, voice: { token: string; endpoint: string; sessionId: string }): Promise<{ ok: boolean }> { return this.request(`/api/player/voice?playerId=${encodeURIComponent(playerId)}`, { method: "POST", body: JSON.stringify(voice) }); }
}
