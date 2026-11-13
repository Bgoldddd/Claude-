// COURTSIDE game server: Colyseus rooms (WebSockets) + REST API + (optionally) the built client.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { defineServer, defineRoom, WebSocketTransport } from "colyseus";
import { CourtRoom } from "./CourtRoom";
import { mountApi } from "./api";
import { db } from "./db";

const PORT = Number(process.env.PORT ?? 2567);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const transport = new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 } as any);
const app = transport.getExpressApp();
app.use(express.json({ limit: "64kb" }));
mountApi(app);

if (process.argv.includes("--serve-client")) {
  const dist = path.join(root, "dist");
  if (fs.existsSync(dist)) {
    app.use(express.static(dist, { maxAge: "1h" }));
    app.get(/^\/(?!api|matchmake).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
    console.log("[courtside] serving the built game from /dist");
  } else console.warn("[courtside] no dist/ folder. Run `npm run build` first.");
}

const server = defineServer({
  transport,
  greet: false,
  rooms: { court: defineRoom(CourtRoom).filterBy(["mode", "visibility"] as any) },
});

await server.listen(PORT);
console.log(`[courtside] server ready on http://localhost:${PORT}  (players: ${Object.keys(db.data.profiles).length})`);

const shutdown = () => { try { db.flush(); } catch { /* ignore */ } process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
