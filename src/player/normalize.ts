import type { InvidiousLikeVideo } from "../types/invidious";
import type { Track } from "../types/track";

function pickThumbnail(thumbs?: { url: string; quality: string }[]): string | null {
  if (!thumbs || thumbs.length === 0) return null;
  const preferred =
    thumbs.find((t) => t.quality.includes("maxres")) ??
    thumbs.find((t) => t.quality.includes("high")) ??
    thumbs[0];
  return preferred.url;
}

/** Normalize an Invidious video/search result into the client-facing Track shape. */
export function invidiousToTrack(video: InvidiousLikeVideo): Track {
  return {
    id: video.videoId,
    title: video.title,
    author: video.author ?? "",
    durationMs: (video.lengthSeconds ?? 0) * 1000,
    // Invidious search results contain instance-relative thumbnail URLs. Those
    // are not reachable from a public browser when the instance is private,
    // so use YouTube's public thumbnail CDN for client-facing artwork.
    thumbnail: `https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${video.videoId}`,
    isLive: video.liveNow ?? false,
  };
}
