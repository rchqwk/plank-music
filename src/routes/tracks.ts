import { Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { invidious } from "../services/invidious";
import { invidiousToTrack } from "../player/normalize";
import type { InvidiousVideo } from "../types/invidious";

const router = Router();

function bestAudio(video: InvidiousVideo) {
  return (video.audioStreams ?? []).length
    ? [...(video.audioStreams ?? [])].sort(
        (a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0),
      )[0]
    : (video.adaptiveFormats ?? [])
        .filter((format) => {
          const type = (format.type ?? "").toLowerCase();
          return type.startsWith("audio/") || Boolean(format.audioQuality);
        })
        .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0))[0];
}

/**
 * Stream the best available audio-only format through this backend so the web
 * player can actually hear music without exposing the private Invidious host.
 * Stream URLs are short-lived and are resolved on every request.
 */
router.get("/stream/:id", async (req, res, next) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const abortUpstream = () => controller.abort();
  req.on("aborted", abortUpstream);
  res.on("close", abortUpstream);

  try {
    const video = await invidious.getVideo(req.params.id);
    const audio = bestAudio(video);

    if (!audio?.url) {
      return res.status(404).json({ error: "No audio stream is available for this track" });
    }

    const headers: Record<string, string> = {
      "User-Agent": "invidious-music-backend/1.0.0",
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(audio.url, {
      signal: controller.signal,
      headers,
    });

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `Audio provider returned ${upstream.status}` });
    }

    const contentType =
      "type" in audio
        ? audio.type.split(";")[0]
        : audio.container === "m4a" || audio.encoding === "aac"
          ? "audio/mp4"
          : "audio/webm";

    res.status(upstream.status === 206 ? 206 : 200);
    res.setHeader("Content-Type", contentType || "audio/webm");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Accept-Ranges", upstream.headers.get("accept-ranges") ?? "bytes");

    for (const header of ["content-length", "content-range"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }

    clearTimeout(timeout);
    await pipeline(Readable.fromWeb(upstream.body as never), res);
  } catch (err) {
    clearTimeout(timeout);
    if (controller.signal.aborted || req.aborted || res.destroyed) {
      if (!res.headersSent && !res.destroyed) {
        res.status(504).json({ error: "Audio stream timed out" });
      }
      return;
    }
    if (res.headersSent) {
      res.destroy(err instanceof Error ? err : undefined);
      return;
    }
    next(err);
  } finally {
    clearTimeout(timeout);
    req.off("aborted", abortUpstream);
    res.off("close", abortUpstream);
  }
});

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
        return type.includes("audio") || type.includes("opus") || type.includes("aac") || type.includes("mp4a") || type.includes("webm");
      })
      .map((f) => ({
        url: f.url,
        itag: f.itag,
        container: f.container,
        encoding: f.encoding,
        bitrate: f.bitrate,
        quality: f.audioQuality ?? f.quality,
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

router.get("/trending", async (req, res, next) => {
  try {
    const type = (req.query.type as string | undefined) ?? "music";
    const videos = await invidious.trending(type as never);
    res.json(videos.map(invidiousToTrack));
  } catch (err) {
    next(err);
  }
});

router.get("/popular", async (_req, res, next) => {
  try {
    const videos = await invidious.popular();
    res.json(videos.map(invidiousToTrack));
  } catch (err) {
    next(err);
  }
});

router.get("/playlists/:id", async (req, res, next) => {
  try {
    const playlist = await invidious.getPlaylist(req.params.id);
    res.json({
      id: playlist.playlistId,
      title: playlist.title,
      author: playlist.author,
      videoCount: playlist.videoCount,
      tracks: (playlist.videos ?? []).map((v) => invidiousToTrack(v as never)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
