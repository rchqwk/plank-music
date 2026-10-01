import { Router, type Request } from "express";
import { PlayerManager, type RepeatMode } from "../player/playerManager";
import { resolveTracks } from "../player/resolve";
import { LavalinkClient } from "../services/lavalink";
import { broadcast } from "../events";

import { authorizePlayer, playerSession } from "../player/authority";

const DEFAULT_PLAYER = "default";

function getPlayerId(req: Request): string {
  return String(req.query.playerId ?? req.body?.playerId ?? DEFAULT_PLAYER);
}

export function playerRouter(players: PlayerManager, lavalink: LavalinkClient): Router {
  const router = Router();
  router.post("/session", playerSession);
  router.use(authorizePlayer);

  router.get("/state", (req, res) => {
    res.json({
      ...players.getSnapshot(getPlayerId(req)),
      lavalinkConnected: lavalink.isConnected,
      sessionId: lavalink.currentSessionId,
    });
  });

  router.get("/queue", (req, res) => {
    const snap = players.getSnapshot(getPlayerId(req));
    res.json({ current: snap.current, queue: snap.queue });
  });

  /** POST /api/player/play  { query | videoId | url, playerId? } */
  router.post("/play", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      const { query, videoId, url } = req.body ?? {};
      const tracks = await resolveTracks(lavalink, { query, videoId, url });
      if (tracks.length === 0) {
        return res.status(404).json({ error: "No playable track found" });
      }
      await players.play(playerId, tracks[0]);
      if (tracks.length > 1) {
        await players.playMany(playerId, tracks.slice(1));
      }
      const snapshot = players.getSnapshot(playerId);
      broadcast("queue", { playerId, ...snapshot });
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/player/queue  { query | videoId | url, playerId? } */
  router.post("/queue", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      const { query, videoId, url } = req.body ?? {};
      const tracks = await resolveTracks(lavalink, { query, videoId, url });
      if (tracks.length === 0) {
        return res.status(404).json({ error: "No playable track found" });
      }
      await players.playMany(playerId, tracks);
      const snapshot = players.getSnapshot(playerId);
      broadcast("queue", { playerId, ...snapshot });
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  router.post("/skip", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      const skippedTo = await players.skip(playerId);
      const snapshot = players.getSnapshot(playerId);
      broadcast("queue", { playerId, ...snapshot });
      res.json({ skippedTo, ...snapshot });
    } catch (err) {
      next(err);
    }
  });

  router.post("/stop", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      await players.stop(playerId);
      const snapshot = players.getSnapshot(playerId);
      broadcast("queue", { playerId, ...snapshot });
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  router.post("/pause", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      await players.pause(playerId);
      const snapshot = players.getSnapshot(playerId);
      broadcast("queue", { playerId, ...snapshot });
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  router.post("/resume", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      await players.resume(playerId);
      const snapshot = players.getSnapshot(playerId);
      broadcast("queue", { playerId, ...snapshot });
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/player/seek  { position (ms) } */
  router.post("/seek", async (req, res, next) => {
    try {
      const position = Number(req.body?.position ?? 0);
      await players.seek(getPlayerId(req), position);
      res.json(players.getSnapshot(getPlayerId(req)));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/player/volume  { volume (0-1000) } */
  router.post("/volume", async (req, res, next) => {
    try {
      const volume = Number(req.body?.volume ?? 100);
      await players.setVolume(getPlayerId(req), volume);
      res.json(players.getSnapshot(getPlayerId(req)));
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/player/repeat  { mode: "none" | "all" | "one" } */
  router.post("/repeat", (req, res, next) => {
    try {
      const mode = (req.body?.mode ?? "none") as RepeatMode;
      players.setRepeat(getPlayerId(req), mode);
      res.json(players.getSnapshot(getPlayerId(req)));
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/player/queue/:index */
  router.delete("/queue/:index", async (req, res, next) => {
    try {
      const removed = await players.removeFromQueue(getPlayerId(req), Number(req.params.index));
      res.json({ removed, ...players.getSnapshot(getPlayerId(req)) });
    } catch (err) {
      next(err);
    }
  });

  /** DELETE /api/player/queue */
  router.delete("/queue", (req, res) => {
    players.clearQueue(getPlayerId(req));
    res.json(players.getSnapshot(getPlayerId(req)));
  });

  /**
   * POST /api/player/voice  { token, endpoint, sessionId }
   * Connects the Lavalink player to a Discord voice channel. This is what a
   * Discord bot frontend supplies from its voice gateway events.
   */
  router.post("/voice", async (req, res, next) => {
    try {
      const playerId = getPlayerId(req);
      const { token, endpoint, sessionId } = req.body ?? {};
      if (!token || !endpoint || !sessionId) {
        return res.status(400).json({ error: "voice update requires token, endpoint and sessionId" });
      }
      const sid = lavalink.currentSessionId;
      if (!sid) {
        return res.status(503).json({ error: "Lavalink is not connected yet" });
      }
      await lavalink.updateVoice(sid, playerId, { token, endpoint, sessionId });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
