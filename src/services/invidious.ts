import { config } from "../config";
import type {
  InvidiousLikeVideo,
  InvidiousPlaylist,
  InvidiousSearchResult,
  InvidiousVideo,
} from "../types/invidious";

export class InvidiousError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "InvidiousError";
  }
}

type ParamValue = string | number | boolean | undefined;

function buildUrl(path: string, params: Record<string, ParamValue> = {}): string {
  const url = new URL(config.invidious.instance + path);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function get<T>(path: string, params?: Record<string, ParamValue>): Promise<T> {
  const url = buildUrl(path, params);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "invidious-music-backend/1.0.0" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new InvidiousError(
      `Could not reach Invidious instance at ${config.invidious.instance}`,
      0,
      err,
    );
  }

  if (!res.ok) {
    throw new InvidiousError(`Invidious API error ${res.status} for ${path}`, res.status);
  }

  return (await res.json()) as T;
}

export interface SearchOptions {
  type?: "video" | "playlist" | "channel" | "all";
  sort?: "relevance" | "views";
  page?: number;
  region?: string;
}

export const invidious = {
  async search(query: string, options: SearchOptions = {}): Promise<InvidiousSearchResult[]> {
    const results = await get<InvidiousSearchResult[]>("/api/v1/search", {
      q: query,
      type: options.type ?? "video",
      sort: options.sort,
      page: options.page ?? 1,
      region: options.region ?? config.invidious.region,
    });
    return Array.isArray(results) ? results : [];
  },

  async getVideo(id: string): Promise<InvidiousVideo> {
    return get<InvidiousVideo>(`/api/v1/videos/${encodeURIComponent(id)}`, {
      region: config.invidious.region,
    });
  },

  async getPlaylist(plid: string): Promise<InvidiousPlaylist> {
    return get<InvidiousPlaylist>(`/api/v1/playlists/${encodeURIComponent(plid)}`);
  },

  async trending(type: "music" | "gaming" | "movies" | "default" = "music"): Promise<InvidiousVideo[]> {
    const results = await get<InvidiousVideo[]>("/api/v1/trending", {
      type,
      region: config.invidious.region,
    });
    return Array.isArray(results) ? results : [];
  },

  async popular(): Promise<InvidiousVideo[]> {
    const results = await get<InvidiousVideo[]>("/api/v1/popular");
    return Array.isArray(results) ? results : [];
  },

  async suggestions(query: string): Promise<string[]> {
    const data = await get<{ query: string; suggestions: string[] }>("/api/v1/search/suggestions", {
      q: query,
    });
    return data.suggestions ?? [];
  },
};
