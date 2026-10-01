import { invidious } from "../services/invidious";
import { LavalinkClient } from "../services/lavalink";
import type { LavalinkLoadResult, LavalinkTrack } from "../types/lavalink";

export interface PlayRequest {
  query?: string;
  videoId?: string;
  url?: string;
}

/**
 * Resolve a play request into one or more Lavalink tracks.
 *
 * Search goes through Invidious (privacy-friendly catalog), then the resulting
 * YouTube video id is handed to Lavalink, which does the actual stream
 * resolution and playback.
 */
export async function resolveTracks(
  lavalink: LavalinkClient,
  request: PlayRequest,
): Promise<LavalinkTrack[]> {
  if (request.url) {
    return extractTracks(await lavalink.loadTracks(request.url));
  }

  if (request.videoId) {
    return extractTracks(await lavalink.loadTracks(request.videoId));
  }

  if (request.query) {
    const results = await invidious.search(request.query, { type: "video" });
    const video = results.find((r) => r.videoId);
    if (!video) return [];
    return extractTracks(await lavalink.loadTracks(video.videoId));
  }

  throw new Error("Provide one of: query, videoId, or url");
}

export function extractTracks(load: LavalinkLoadResult): LavalinkTrack[] {
  switch (load.loadType) {
    case "track":
      return [load.data as LavalinkTrack];
    case "search":
      return Array.isArray(load.data) ? (load.data as LavalinkTrack[]) : [];
    case "playlist": {
      const data = load.data as { tracks?: LavalinkTrack[] };
      return data.tracks ?? [];
    }
    default:
      return [];
  }
}
