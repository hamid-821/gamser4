import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import fs from "node:fs";

const PORT = Number(process.env.GAME_PORT || 3001);

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); resolve(true); });
    s.once("error", () => resolve(false));
  });
}

export async function startGameServer(): Promise<void> {
  if (await portOpen(PORT)) return; // قبلاً بالا آمده
  const root = process.cwd();
  const script = path.join(root, "appg", "server.cjs");
  if (!fs.existsSync(script)) { console.warn("[game] appg/server.cjs not found"); return; }
  const dataDir = process.env.GAME_DATA_DIR || path.join(root, "appg", "data-app");
  const child = spawn(process.execPath, [script], {
    cwd: path.join(root, "appg"),
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1", DATA_DIR: dataDir, BASE_URL: process.env.GAME_BASE_URL || `http://localhost:${PORT}` },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => console.warn("[game] server exited", code));
  process.on("exit", () => { try { child.kill(); } catch { /* ignore */ } });
  for (let i = 0; i < 40; i++) { if (await portOpen(PORT)) return; await new Promise((r) => setTimeout(r, 100)); }
}
