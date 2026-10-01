import { Router } from "express";
import { randomBytes, randomInt } from "node:crypto";

type RequestTrack = { id: string; title: string; author?: string; thumbnail?: string; durationMs?: number };
type RequestItem = { id: string; track: RequestTrack; state: "pending" | "approved"; createdAt: number };
type QueueRoom = { code: string; hostToken: string; enabled: boolean; confirmation: boolean; items: RequestItem[] };
const rooms = new Map<string, QueueRoom>();
const router = Router();

function code() { let value = ""; do { value = String(randomInt(0, 10000)).padStart(4, "0"); } while (rooms.has(value)); return value; }
function room(req: { params: { code: string } }, res: { status: (n: number) => { json: (v: unknown) => void } }) {
  const value = rooms.get(req.params.code); if (!value) { res.status(404).json({ error: "Queue not found" }); return; } return value;
}
function host(req: { headers: Record<string, string | string[] | undefined> }, value: QueueRoom) { return req.headers["x-dj-host"] === value.hostToken; }

router.post("/dj-queue", (req, res) => {
  const value: QueueRoom = { code: code(), hostToken: randomBytes(24).toString("hex"), enabled: true, confirmation: Boolean(req.body?.confirmation), items: [] };
  rooms.set(value.code, value);
  res.status(201).json({ code: value.code, hostToken: value.hostToken, enabled: value.enabled, confirmation: value.confirmation });
});
router.get("/dj-queue/:code", (req, res) => {
  const value = room(req, res); if (!value) return;
  const isHost = host(req, value);
  res.json({ code: value.code, enabled: value.enabled, confirmation: value.confirmation, items: value.items.filter(item => isHost || item.state === "approved") });
});
router.patch("/dj-queue/:code", (req, res) => {
  const value = room(req, res); if (!value) return;
  if (!host(req, value)) { res.status(403).json({ error: "Host authorization required" }); return; }
  if (typeof req.body?.enabled === "boolean") value.enabled = req.body.enabled;
  if (typeof req.body?.confirmation === "boolean") value.confirmation = req.body.confirmation;
  res.json({ enabled: value.enabled, confirmation: value.confirmation });
});
router.post("/dj-queue/:code/requests", (req, res) => {
  const value = room(req, res); if (!value) return;
  if (!value.enabled) { res.status(403).json({ error: "Requests are disabled" }); return; }
  const track = req.body?.track as RequestTrack;
  if (!track?.id || !track?.title) { res.status(400).json({ error: "A track is required" }); return; }
  const item: RequestItem = { id: randomBytes(8).toString("hex"), track, state: value.confirmation ? "pending" : "approved", createdAt: Date.now() };
  value.items.push(item); res.status(201).json(item);
});
router.patch("/dj-queue/:code/requests/:id", (req, res) => {
  const value = room(req, res); if (!value) return;
  if (!host(req, value)) { res.status(403).json({ error: "Host authorization required" }); return; }
  const item = value.items.find(entry => entry.id === req.params.id); if (!item) { res.status(404).json({ error: "Request not found" }); return; }
  if (req.body?.action === "approve") item.state = "approved";
  if (req.body?.action === "remove") value.items = value.items.filter(entry => entry.id !== item.id);
  res.json({ items: value.items });
});
export default router;
