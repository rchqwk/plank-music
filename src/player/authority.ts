import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
const configured = process.env.PLAYER_SESSION_SECRET || "";
const signingKey = configured.length >= 32 ? configured : process.env.NODE_ENV === "production" ? "" : randomBytes(32).toString("hex");
function equal(a: string, b: string) { const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y); }
function browserIdentity(req: Request): string | null {
  const token = (req.headers.authorization || "").replace(/^Bearer /, "");
  const [data, sig, extra] = token.split(".");
  if (!signingKey || !data || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", signingKey).update(data).digest("base64url");
  if (!equal(expected,sig)) return null;
  try { const body=JSON.parse(Buffer.from(data,"base64url").toString());return typeof body.id === "string" && /^browser_[a-f0-9]{48}$/.test(body.id) && Number.isFinite(body.exp) && body.exp > Date.now() ? body.id : null; } catch { return null; }
}
export function playerSession(req: Request, res: Response) {
  if (!signingKey) return res.status(503).json({error:"Player sessions are unavailable"});
  const id=browserIdentity(req) || "browser_"+randomBytes(24).toString("hex");
  const data=Buffer.from(JSON.stringify({id,exp:Date.now()+24*3600*1000})).toString("base64url");
  res.setHeader("Cache-Control","no-store");
  return res.json({playerId:id,token:data+"."+createHmac("sha256",signingKey).update(data).digest("base64url")});
}
export function authorizePlayer(req: Request, res: Response, next: NextFunction) {
  const requested=String(req.query.playerId ?? req.body?.playerId ?? "");
  const botKey=process.env.PLAYER_BOT_TOKEN || "";
  const supplied=String(req.headers["x-player-bot-token"] || "");
  if (botKey.length>=32 && equal(botKey,supplied)) {
    const prefix=process.env.PLAYER_ID_PREFIX || "";
    const guild=requested.startsWith(prefix)?requested.slice(prefix.length):"";
    if (!/^\d{16,22}$/.test(guild)) return res.status(403).json({error:"Discord player identity required"});
    res.locals.playerId=requested;res.locals.playerKind="bot";return next();
  }
  const identity=browserIdentity(req);
  if (!identity) return res.status(401).json({error:"Player authentication required"});
  if (requested && requested!==identity) return res.status(403).json({error:"Player ownership required"});
  if (req.path==="/voice") return res.status(403).json({error:"Discord bot authorization required"});
  // Replace untrusted caller identity with the authenticated session binding.
  req.query.playerId=identity;
  if(req.body)req.body.playerId=identity;
  res.locals.playerId=identity;res.locals.playerKind="browser";next();
}
