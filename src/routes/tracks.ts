import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveYtDlpAudio } from "../services/audioResolver";
import { invidious } from "../services/invidious";
import { invidiousToTrack } from "../player/normalize";
import type { InvidiousLikeVideo } from "../types/invidious";

const router = Router();

/**
 * Stream the best available audio-only format through this backend so the web
 * player can actually hear music without exposing the private Invidious host.
 * Stream URLs are short-lived and are resolved on every request.
 */
router.get("/stream/:id", async (req, res, next) => {
  const controller = new AbortController();
  const onClose = () => controller.abort();
  res.once("close", onClose);
  try {
    let video;
    let fallbackAudio: { url: string; type: string } | null = null;
    try {
      video = await invidious.getVideo(req.params.id);
    } catch {
      fallbackAudio = await resolveYtDlpAudio(req.params.id);
    }
    if (controller.signal.aborted) return;
    let audio = fallbackAudio ?? [
        ...(video?.audioStreams ?? []),
        ...(video?.adaptiveFormats ?? [])
        .filter((format) => {
          const type = (format.type ?? "").toLowerCase();
          return type.startsWith("audio/") || Boolean(format.audioQuality);
        }),
      ]
        .filter((format) => Boolean(format.url))
        .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0))[0];

    if (!audio?.url) {
      return res.status(404).json({ error: "No audio stream is available for this track" });
    }

    // Limit the wait for response headers, not the lifetime of a song.
    const fetchAudio = async (url: string): Promise<Response> => {
      const attempt = new AbortController();
      const abort = () => attempt.abort();
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) attempt.abort();
      const timeout = setTimeout(abort, 20_000);
      try { return await fetch(url, {
        signal: attempt.signal,
        headers: {
          // googlevideo URLs returned by Invidious validate normal YouTube
          // navigation headers; a custom backend user-agent is rejected 403.
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          "Referer": "https://www.youtube.com/",
          "Origin": "https://www.youtube.com",
          "Accept-Encoding": "identity",
          ...(req.headers.range ? { Range: req.headers.range } : {}),
        },
      }); } finally {
        clearTimeout(timeout);
        controller.signal.removeEventListener('abort', abort);
      }
    };
    let upstream = await fetchAudio(audio.url);
    // Refresh a rejected signed URL through the independent resolver once.
    // Never retry after audio bytes have already been sent to the browser.
    if ([401, 403, 410, 500, 502, 503, 504].includes(upstream.status)) {
      await upstream.body?.cancel();
      if (controller.signal.aborted) return;
      audio = await resolveYtDlpAudio(req.params.id);
      if (controller.signal.aborted) return;
      upstream = await fetchAudio(audio.url);
    }
    if (upstream.status === 416) {
      const range = upstream.headers.get("content-range");
      if (range) res.setHeader("Content-Range", range);
      await upstream.body?.cancel();
      return res.status(416).end();
    }
    if (!upstream.ok || !upstream.body) {
      await upstream.body?.cancel();
      return res.status(502).json({ error: `Audio provider returned ${upstream.status}` });
    }

    res.status(upstream.status);
    const contentType = "type" in audio
      ? audio.type?.split(";")[0]
      : audio.container === "m4a" || audio.encoding === "aac"
        ? "audio/mp4"
        : "audio/webm";
    const providerType = upstream.headers.get("content-type");
    res.setHeader("Content-Type", providerType?.startsWith("audio/") ? providerType : contentType || "audio/webm");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") || (upstream.status === 206 ? "bytes" : "none"));
    const contentRange = upstream.headers.get("content-range");
    if (contentRange) res.setHeader("Content-Range", contentRange);
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);
    await pipeline(Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream), res);
  } catch (err) {
    if (res.destroyed) return;
    if (res.headersSent) res.destroy();
    else {
      res.setHeader('Retry-After', '10');
      res.status(503).json({ error: 'Audio provider temporarily unavailable. Please retry this track.', retryable: true });
    }
  } finally {
    res.off("close", onClose);
    controller.abort();
  }
});

/**
 * GET /api/tracks/:id
 * Full video details plus the direct audio streams Invidious exposes.
 */
router.get("/tracks/:id", async (req, res, next) => {
  try {
    const video = await invidious.getVideo(req.params.id);

    const audioStreams = [
      ...(video.audioStreams ?? []),
      ...(video.adaptiveFormats ?? []),
      ...(video.formatStreams ?? []),
    ]
      .filter((f) => {
        const type = `${"type" in f ? f.type ?? "" : ""} ${f.encoding ?? ""}`.toLowerCase();
        return (
          type.includes("audio") ||
          type.includes("opus") ||
          type.includes("aac") ||
          type.includes("mp4a") ||
          type.includes("webm")
        );
      })
      .map((f) => ({
        url: f.url,
        itag: f.itag,
        container: f.container,
        encoding: f.encoding,
        bitrate: f.bitrate,
        quality: (f as { audioQuality?: string; quality?: string }).audioQuality ?? (f as { quality: string }).quality,
      }));

    res.json({
      ...invidiousToTrack(video),
      description: video.description ?? null,
      genre: video.genre ?? null,
      musicTracks: video.musicTracks ?? [],
      audioStreams,
      hlsUrl: video.hlsUrl ?? null,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/trending?type=music|gaming|movies|default
 */
router.get("/trending", async (req, res, next) => {
  try {
    const type = (req.query.type as string) ?? "music";
    const videos = await invidious.trending(type as "music" | "gaming" | "movies" | "default");
    res.json(videos.map(invidiousToTrack));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/popular
 */
router.get("/popular", async (req, res, next) => {
  try {
    const videos = await invidious.popular();
    res.json(videos.map(invidiousToTrack));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/playlists/:id
 */
router.get("/playlists/:id", async (req, res, next) => {
  try {
    const playlist = await invidious.getPlaylist(req.params.id);
    res.json({
      id: playlist.playlistId,
      title: playlist.title,
      author: playlist.author,
      videoCount: playlist.videoCount,
      tracks: (playlist.videos ?? []).map((v) =>
        invidiousToTrack(v as InvidiousLikeVideo),
      ),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
