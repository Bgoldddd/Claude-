// Starts the game server and the Vite dev client together. Ctrl+C stops both.
import { spawn } from "node:child_process";
const isWin = process.platform === "win32";
const npx = isWin ? "npx.cmd" : "npx";
const procs = [
  spawn(npx, ["tsx", "watch", "server/index.ts"], { stdio: "inherit" }),
  spawn(npx, ["vite"], { stdio: "inherit" }),
];
const stop = () => { for (const p of procs) p.kill("SIGINT"); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
for (const p of procs) p.on("exit", (code) => { if (code) console.log("[dev] a process exited with code", code); });
