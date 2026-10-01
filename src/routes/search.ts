import { Router } from "express";
import { invidious } from "../services/invidious";
import { invidiousToTrack } from "../player/normalize";

const router = Router();

/**
 * GET /api/search?q=...&type=video
 * Search Invidious and return normalized video tracks.
 */
router.get("/search", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "");
    if (!q) {
      return res.status(400).json({ error: "Missing query parameter `q`" });
    }
    const type = (req.query.type as string) ?? "video";
    const results = await invidious.search(q, {
      type: type as "video" | "playlist" | "channel" | "all",
      sort: (req.query.sort as "relevance" | "views") ?? undefined,
      page: req.query.page ? Number(req.query.page) : 1,
    });
    const tracks = results
      .filter((r) => r.type === "video" && r.videoId)
      .map(invidiousToTrack);
    res.json(tracks);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/suggestions?q=...
 * Autocomplete suggestions from Invidious.
 */
router.get("/suggestions", async (req, res, next) => {
  try {
    const q = String(req.query.q ?? "");
    if (!q) {
      return res.status(400).json({ error: "Missing query parameter `q`" });
    }
    res.json(await invidious.suggestions(q));
  } catch (err) {
    next(err);
  }
});

export default router;
