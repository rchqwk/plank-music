import { Client, type VoiceState } from "discord.js";
import { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, type VoiceConnection, type DiscordGatewayAdapterCreator } from "@discordjs/voice";
import { BackendClient } from "./backend.js";
import { playerIdFor } from "./config.js";

interface VoiceData { sessionId?: string; token?: string; endpoint?: string; }

/** Converts Discord's two voice gateway events into Lavalink's voice payload. */
export class VoiceBridge {
  private readonly data = new Map<string, VoiceData>();
  private readonly connections = new Map<string, VoiceConnection>();

  constructor(private readonly client: Client, private readonly backend: BackendClient) {
    client.on("voiceStateUpdate", (oldState, newState) => this.onVoiceState(newState, oldState));
    client.on("voiceServerUpdate", (payload) => this.onVoiceServer(payload));
  }

  async join(state: VoiceState): Promise<VoiceConnection> {
    if (!state.channel || !state.guild) throw new Error("Join a voice channel first.");
    // discord.js and @discordjs/voice can resolve slightly different nested
    // discord-api-types versions; the adapter contract itself is identical.
    const adapterCreator = state.guild.voiceAdapterCreator as unknown as DiscordGatewayAdapterCreator;
    const connection = joinVoiceChannel({ channelId: state.channel.id, guildId: state.guild.id, adapterCreator, selfDeaf: false });
    this.connections.set(state.guild.id, connection);
    connection.on(VoiceConnectionStatus.Disconnected, () => this.connections.delete(state.guild!.id));
    await this.syncWhenReady(state.guild.id, 5_000);
    return connection;
  }

  leave(guildId: string): void { getVoiceConnection(guildId)?.destroy(); this.connections.delete(guildId); this.data.delete(guildId); }
  hasConnection(guildId: string): boolean { return this.connections.has(guildId); }

  private onVoiceState(state: VoiceState, previous: VoiceState): void {
    if (state.id !== this.client.user?.id || !state.guild) return;
    if (state.sessionId) this.patch(state.guild.id, { sessionId: state.sessionId });
    if (previous.channelId && !state.channelId) this.leave(state.guild.id);
  }

  private onVoiceServer(payload: { guild_id?: string; token?: string; endpoint?: string | null }): void {
    if (!payload.guild_id || !payload.token || !payload.endpoint) return;
    this.patch(payload.guild_id, { token: payload.token, endpoint: payload.endpoint });
  }

  private patch(guildId: string, patch: VoiceData): void { const current = this.data.get(guildId) || {}; const next = { ...current, ...patch }; this.data.set(guildId, next); if (next.sessionId && next.token && next.endpoint) void this.backend.voice(playerIdFor(guildId), { sessionId: next.sessionId, token: next.token, endpoint: next.endpoint }).catch((error: Error) => console.error(`[voice:${guildId}] ${error.message}`)); }

  private async syncWhenReady(guildId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) { const value = this.data.get(guildId); if (value?.sessionId && value.token && value.endpoint) { await this.backend.voice(playerIdFor(guildId), { sessionId: value.sessionId, token: value.token, endpoint: value.endpoint }); return; } await new Promise((resolve) => setTimeout(resolve, 250)); }
    console.warn(`[voice:${guildId}] voice gateway data has not arrived yet; it will sync from gateway events`);
  }
}
