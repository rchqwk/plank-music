export interface LavalinkTrackInfo {
  identifier: string;
  isSeekable: boolean;
  author: string;
  length: number;
  isStream: boolean;
  position: number;
  title: string;
  uri?: string | null;
  artworkUrl?: string | null;
  isrc?: string | null;
  sourceName: string;
}

export interface LavalinkTrack {
  encoded: string;
  info: LavalinkTrackInfo;
  pluginInfo?: Record<string, unknown>;
  userData?: Record<string, unknown>;
}

export interface LavalinkPlaylistInfo {
  name: string;
  selectedTrack: number;
}

export type LavalinkLoadType = "track" | "playlist" | "search" | "empty" | "error";

export interface LavalinkException {
  message?: string;
  severity: "common" | "suspicious" | "fault";
  cause: string;
  causeStackTrace?: string;
}

export interface LavalinkLoadResult {
  loadType: LavalinkLoadType;
  data:
    | LavalinkTrack
    | { info: LavalinkPlaylistInfo; pluginInfo?: unknown; tracks: LavalinkTrack[] }
    | LavalinkTrack[]
    | LavalinkException
    | null;
}

export interface LavalinkPlayerState {
  time: number;
  position: number;
  connected: boolean;
  ping: number;
}

export interface LavalinkVoiceState {
  token: string;
  endpoint: string;
  sessionId: string;
  channelId?: string | null;
}

export interface LavalinkPlayer {
  guildId: string;
  track?: LavalinkTrack | null;
  volume: number;
  paused: boolean;
  state: LavalinkPlayerState;
  voice: LavalinkVoiceState;
  filters?: Record<string, unknown>;
}

export type LavalinkEvent =
  | { op: "ready"; resumed: boolean; sessionId: string }
  | { op: "playerUpdate"; guildId: string; state: LavalinkPlayerState }
  | { op: "stats"; players: number; playingPlayers: number; uptime: number; memory: unknown; cpu: unknown; frameStats: unknown }
  | { op: "event"; type: "TrackStartEvent"; guildId: string; track: LavalinkTrack }
  | { op: "event"; type: "TrackEndEvent"; guildId: string; track: LavalinkTrack; reason: string }
  | { op: "event"; type: "TrackExceptionEvent"; guildId: string; track: LavalinkTrack; exception: LavalinkException }
  | { op: "event"; type: "TrackStuckEvent"; guildId: string; track: LavalinkTrack; thresholdMs: number }
  | { op: "event"; type: "WebSocketClosedEvent"; guildId: string; code: number; reason: string; byRemote: boolean };
