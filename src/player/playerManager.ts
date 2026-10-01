import { randomUUID } from "node:crypto";
import { LavalinkClient } from "../services/lavalink";
import type { LavalinkTrack, LavalinkTrackInfo } from "../types/lavalink";
import type { Track } from "../types/track";

export type RepeatMode = "none" | "all" | "one";

interface PlayerState {
  queue: LavalinkTrack[];
  current: LavalinkTrack | null;
  repeat: RepeatMode;
  volume: number;
  paused: boolean;
  positionMs: number;
}

export interface PlayerSnapshot {
  current: Track | null;
  queue: Track[];
  repeat: RepeatMode;
  volume: number;
  paused: boolean;
  positionMs: number;
}

export function toClientTrack(track: LavalinkTrack): Track {
  const info: LavalinkTrackInfo = track.info;
  return {
    id: info.identifier,
    title: info.title,
    author: info.author,
    durationMs: info.length,
    thumbnail: info.artworkUrl ?? `https://i.ytimg.com/vi/${info.identifier}/hqdefault.jpg`,
    url: info.uri ?? `https://www.youtube.com/watch?v=${info.identifier}`,
    isLive: info.isStream,
  };
}

/**
 * In-memory queue + player state per player id (mapped to Lavalink "guildId").
 * Auto-advances the queue when a track finishes.
 */
export class PlayerManager {
  private players = new Map<string, PlayerState>();
  private transitions = new Map<string, Promise<unknown>>();
  private serialize<T>(id: string, operation: () => Promise<T>, rollback = true): Promise<T> {
    const previous=this.transitions.get(id) || Promise.resolve();
    const pending=previous.catch(()=>{}).then(async()=>{const before=structuredClone(this.getState(id));try{return await operation();}catch(error){if(rollback)this.players.set(id,before);throw error;}});
    this.transitions.set(id,pending);
    void pending.finally(()=>{if(this.transitions.get(id)===pending)this.transitions.delete(id);}).catch(()=>{});
    return pending;
  }
  play(id: string, track: LavalinkTrack) { return this.serialize(id,()=>this.playImpl(id,track)); }
  playMany(id: string, tracks: LavalinkTrack[]) { return this.serialize(id,()=>this.playManyImpl(id,tracks)); }
  skip(id: string) { return this.serialize(id,()=>this.skipImpl(id)); }
  stop(id: string) { return this.serialize(id,()=>this.stopImpl(id)); }
  pause(id: string) { return this.serialize(id,()=>this.pauseImpl(id)); }
  resume(id: string) { return this.serialize(id,()=>this.resumeImpl(id)); }
  seek(id: string, position: number) { return this.serialize(id,()=>this.seekImpl(id,position)); }
  setVolume(id: string, volume: number) { return this.serialize(id,()=>this.setVolumeImpl(id,volume)); }
  removeFromQueue(id: string, index: number) { return this.serialize(id,()=>this.removeFromQueueImpl(id,index)); }

  constructor(private lavalink: LavalinkClient) {
    this.lavalink.events.on("trackEnd", (guildId: string, track: LavalinkTrack, reason: string) => {
      void this.serialize(guildId,()=>this.handleTrackEnd(guildId, track, reason),false).catch(()=>console.error("Queue transition failed"));
    });

    this.lavalink.events.on("playerUpdate", (guildId: string, state: { position: number }) => {
      const player = this.players.get(guildId);
      if (player) {
        player.positionMs = state.position;
      }
    });
  }

  private getState(playerId: string): PlayerState {
    let state = this.players.get(playerId);
    if (!state) {
      state = {
        queue: [],
        current: null,
        repeat: "none",
        volume: 100,
        paused: false,
        positionMs: 0,
      };
      this.players.set(playerId, state);
    }
    return state;
  }

  private sessionId(): string {
    const id = this.lavalink.currentSessionId;
    if (!id) {
      throw new Error("Lavalink is not connected yet");
    }
    return id;
  }

  getSnapshot(playerId: string): PlayerSnapshot {
    const state = this.getState(playerId);
    return {
      current: state.current ? toClientTrack(state.current) : null,
      queue: state.queue.map(toClientTrack),
      repeat: state.repeat,
      volume: state.volume,
      paused: state.paused,
      positionMs: state.positionMs,
    };
  }

  private async playImpl(playerId: string, track: LavalinkTrack): Promise<void> {
    const state = this.getState(playerId);
    state.queue.push(track);
    await this.tryStart(playerId, state);
  }

  private async playManyImpl(playerId: string, tracks: LavalinkTrack[]): Promise<void> {
    const state = this.getState(playerId);
    state.queue.push(...tracks);
    await this.tryStart(playerId, state);
  }

  private async tryStart(playerId: string, state: PlayerState): Promise<void> {
    if (state.current) return; // Already playing, tracks stay queued.
    const next = state.queue.shift();
    if (!next) return;
    try { await this.sendTrack(playerId, next); } catch(error) { state.current=null;state.queue.unshift(next);throw error; }
  }

  private async sendTrack(playerId: string, track: LavalinkTrack): Promise<void> {
    const state = this.getState(playerId);
    const operationId = randomUUID();
    state.current = { ...track, userData: { ...track.userData, operationId } };
    await this.updateLavalinkPlayer(playerId, {
      track: { encoded: track.encoded, userData: state.current.userData },
      volume: state.volume,
      paused: false,
    });
    state.paused = false;
    state.positionMs = 0;
  }

  private async updateLavalinkPlayer(playerId: string, body: Record<string, unknown>): Promise<void> {
    if(playerId.startsWith("browser_"))return;
    await this.lavalink.updatePlayer(this.sessionId(), playerId, body);
  }

  private async skipImpl(playerId: string): Promise<Track | null> {
    const state = this.getState(playerId);
    const next = state.queue.shift();
    if (next) {
      state.current = next;
      await this.sendTrack(playerId, next);
      return toClientTrack(next);
    }

    state.current = null;
    state.positionMs = 0;
    await this.updateLavalinkPlayer(playerId, { track: null });
    return null;
  }

  private async stopImpl(playerId: string): Promise<void> {
    const state = this.getState(playerId);
    state.queue = [];
    state.current = null;
    state.paused = false;
    state.positionMs = 0;
    await this.updateLavalinkPlayer(playerId, { track: null });
  }

  private async pauseImpl(playerId: string): Promise<void> {
    const state = this.getState(playerId);
    state.paused = true;
    await this.updateLavalinkPlayer(playerId, { paused: true });
  }

  private async resumeImpl(playerId: string): Promise<void> {
    const state = this.getState(playerId);
    state.paused = false;
    await this.updateLavalinkPlayer(playerId, { paused: false });
  }

  private async seekImpl(playerId: string, positionMs: number): Promise<void> {
    const state = this.getState(playerId);
    if(!Number.isFinite(positionMs) || positionMs<0)throw new Error("Invalid playback position");
    state.positionMs = positionMs;
    await this.updateLavalinkPlayer(playerId, { position: positionMs });
  }

  private async setVolumeImpl(playerId: string, volume: number): Promise<void> {
    const state = this.getState(playerId);
    if(!Number.isFinite(volume))throw new Error("Invalid volume");
    state.volume = Math.max(0, Math.min(1000, Math.round(volume)));
    await this.updateLavalinkPlayer(playerId, { volume: state.volume });
  }

  setRepeat(playerId: string, mode: RepeatMode): RepeatMode {
    const state = this.getState(playerId);
    if (mode !== "none" && mode !== "all" && mode !== "one") {
      throw new Error('repeat mode must be one of "none", "all", "one"');
    }
    state.repeat = mode;
    return mode;
  }

  clearQueue(playerId: string): void {
    const state = this.getState(playerId);
    state.queue = [];
  }

  private async removeFromQueueImpl(playerId: string, index: number): Promise<Track | null> {
    const state = this.getState(playerId);
    if(!Number.isInteger(index) || index<0 || index>=state.queue.length)throw new Error("Invalid queue index");
    const [removed] = state.queue.splice(index, 1);
    return removed ? toClientTrack(removed) : null;
  }

  private async handleTrackEnd(playerId: string, track: LavalinkTrack, reason: string): Promise<void> {
    const state = this.getState(playerId);

    // Explicit stop/skip/replace should not auto-advance.
    if (reason === "stopped" || reason === "replaced" || reason === "cleanup") {
      return;
    }

    if (!state.current || track.encoded !== state.current.encoded || !track.userData?.operationId || track.userData.operationId !== state.current.userData?.operationId) return;
    const finished = state.current;
    state.current = null;

    if (state.repeat === "one" && finished) {
      state.queue.unshift(finished);
      await this.tryStart(playerId,state);
      return;
    }

    if (finished && state.repeat === "all") {
      state.queue.push(finished);
    }

    if (state.queue.length) {
      await this.tryStart(playerId,state);
    } else {
      state.positionMs = 0;
      state.paused = false;
    }
  }
}
