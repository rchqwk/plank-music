import type { Response } from "express";

const clients = new Map<Response,string>();

/** Attach an SSE response so the client can stream realtime events. */
export function subscribe(res: Response, playerId: string): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  clients.set(res,playerId);
  res.on("close", () => clients.delete(res));
}

/** Broadcast an event to every connected SSE client. */
export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [client,playerId] of clients) {
    const owner=(data as any)?.playerId || (data as any)?.guildId;
    if(owner && owner!==playerId)continue;
    client.write(payload);
  }
}
