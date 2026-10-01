import express, { type ErrorRequestHandler } from "express";
import cors from "cors";
import { config } from "./config";
import { InvidiousError } from "./services/invidious";
import { LavalinkClient } from "./services/lavalink";
import { PlayerManager, toClientTrack } from "./player/playerManager";
import { broadcast, subscribe } from "./events";
import { authorizePlayer } from "./player/authority";
import searchRouter from "./routes/search";
import tracksRouter from "./routes/tracks";
import { playerRouter } from "./routes/player";
import djQueueRouter from "./routes/djQueue";
import path from "node:path";

const app = express();
app.use(cors());
app.use(express.json());

const lavalink = new LavalinkClient();
const players = new PlayerManager(lavalink);

// ------------------------------------------------------------------
// Health
// ------------------------------------------------------------------
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    lavalink: lavalink.isConnected ? "connected" : "disconnected",
    sessionId: lavalink.currentSessionId,
  });
});

// ------------------------------------------------------------------
// Realtime event stream (Server-Sent Events)
// ------------------------------------------------------------------
app.get("/api/events", authorizePlayer, (req, res) => {
  subscribe(res,res.locals.playerId);
  res.write(`event: hello\ndata: ${JSON.stringify({ connected: lavalink.isConnected })}\n\n`);
  req.on("close", () => {
    /* handled inside subscribe() */
  });
});

// ------------------------------------------------------------------
// Routers
// ------------------------------------------------------------------
app.use("/api", searchRouter);
app.use("/api", tracksRouter);
app.use("/api/player", playerRouter(players, lavalink));
app.use("/api", djQueueRouter);

// Serve the bundled static web player from the same origin as the API.
// This keeps browser requests same-origin in production and still allows the
// frontend to be developed independently from its own folder.
const projectRoot = path.resolve(__dirname, "..");
app.use(express.static(path.join(projectRoot, "frontend")));
app.get("/", (_req, res) => {
  res.sendFile(path.join(projectRoot, "frontend", "index.html"));
});
app.get("/terms", (_req, res) => {
  res.sendFile(path.join(projectRoot, "frontend", "terms.html"));
});
app.get("/privacy", (_req, res) => {
  res.sendFile(path.join(projectRoot, "frontend", "privacy.html"));
});

// ------------------------------------------------------------------
// Lavalink event logging + realtime broadcast
// ------------------------------------------------------------------
lavalink.events.on("ready", (sessionId, resumed) => {
  console.log(`[lavalink] ready (session=${sessionId}, resumed=${resumed})`);
  broadcast("lavalink", { status: "ready", sessionId, resumed });
});

lavalink.events.on("error", (err: NodeJS.ErrnoException) => {
  console.error("[lavalink] error:", err?.message || err?.code || String(err));
});

lavalink.events.on("reconnect", (attempt) => {
  console.log(`[lavalink] reconnecting (attempt ${attempt})`);
  broadcast("lavalink", { status: "reconnecting", attempt });
});

lavalink.events.on("trackStart", (guildId, track) => {
  console.log(`[player:${guildId}] now playing: ${track.info.title} — ${track.info.author}`);
  broadcast("trackStart", { guildId, track: toClientTrack(track) });
});

lavalink.events.on("trackEnd", (guildId, _track, reason) => {
  broadcast("trackEnd", { guildId, reason });
});

// ------------------------------------------------------------------
// Error handler
// ------------------------------------------------------------------
const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof InvidiousError) {
    const hint =
      err.status === 401 || err.status === 403
        ? 'This Invidious instance appears to have its public API disabled. Set INVIDIOUS_INSTANCE to an instance with "api": true on https://api.invidious.io/instances.json, or self-host Invidious.'
        : undefined;
    res.status(502).json({ error: err.message, hint });
    return;
  }

  console.error("[error]", err);
  res.status(500).json({ error: err?.message ?? "Internal server error" });
};
app.use(errorHandler);

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------
app.listen(config.port, () => {
  console.log(`Music backend listening on http://localhost:${config.port}`);
  console.log(`Invidious instance : ${config.invidious.instance}`);
  console.log(`Lavalink node      : ${lavalink.baseUrl}`);
  lavalink.connect();
});

// Graceful shutdown
function shutdown(): void {
  console.log("\nShutting down...");
  lavalink.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
