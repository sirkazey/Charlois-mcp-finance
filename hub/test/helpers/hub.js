// Démarre hub/server.js dans un processus enfant, sur un port libre, avec un DATA_DIR temporaire
// et toutes les URL amont (Salesforce, Sage X3, OAuth) pointées vers le mock.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const HUB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const KEY = "test-key-alice-0123456789";

export const freePort = () => new Promise((resolve, reject) => {
  const s = createServer();
  s.on("error", reject);
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

/** Utilisateur pré-connecté aux deux systèmes (jetons connus), sans passer par OAuth. */
export const connectedUser = (upstreamUrl, extra = {}) => ({
  createdAt: "2026-01-01T00:00:00.000Z",
  email: "alice@example.com",
  salesforce: { access_token: "sf-token-alice", refresh_token: "sf-refresh-alice", instance_url: upstreamUrl, token_type: "Bearer" },
  sagex3: { access_token: "sage-token-alice", refresh_token: "sage-refresh-alice", token_type: "Bearer" },
  sharepoint: { access_token: "ms-token-alice", refresh_token: "ms-refresh-alice" },
  dropbox: { access_token: "dbx-token-alice", refresh_token: "dbx-refresh-alice" },
  myreport: { apiKey: "mr-token-alice" },
  ...extra,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {object} o
 * @param {string} o.upstreamUrl  URL du mock amont
 * @param {object} [o.users]      contenu de users.json ({ [key]: user }) ; vide par défaut
 * @param {object} [o.env]        variables d'environnement supplémentaires / surchargées
 */
export async function startHub({ upstreamUrl, users = {}, env = {} }) {
  const port = await freePort();
  const dataDir = mkdtempSync(join(tmpdir(), "mcp-hub-test-"));
  writeFileSync(join(dataDir, "users.json"), JSON.stringify({ users }, null, 2));
  const url = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ["server.js"], {
    env: {
      PATH: process.env.PATH, TZ: process.env.TZ, APP_ENV: process.env.APP_ENV, LOG_LEVEL: process.env.LOG_LEVEL,
      PORT: String(port), PUBLIC_URL: url, DATA_DIR: dataDir,
      SF_LOGIN_URL: upstreamUrl, SF_CLIENT_ID: "sf-client-id", SF_CLIENT_SECRET: "sf-client-secret",
      SF_OBJECTS: "Account,Contact,Opportunity",
      SAGE_URL: upstreamUrl, SAGE_FOLDER: "PROD", SAGE_REPRESENTATIONS: "BPCUSTOMER,SINVOICE",
      SAGE_OAUTH_AUTH_URL: `${upstreamUrl}/oauth/authorize`, SAGE_OAUTH_TOKEN_URL: `${upstreamUrl}/oauth/token`,
      SAGE_OAUTH_USERINFO_URL: `${upstreamUrl}/oauth/userinfo`,
      SAGE_OAUTH_CLIENT_ID: "sage-client-id", SAGE_OAUTH_CLIENT_SECRET: "sage-client-secret",
      MS_LOGIN_URL: `${upstreamUrl}/ms`, MS_TENANT_ID: "common", MS_CLIENT_ID: "ms-client-id", MS_CLIENT_SECRET: "ms-client-secret", GRAPH_URL: `${upstreamUrl}/v1.0`,
      CLEVOA_URL: `${upstreamUrl}/api/v1/telemetry`, CLEVOA_KEY: "clevoa-key-test",
      MYREPORT_MCP_URL: `${upstreamUrl}/myreport/sse`, MYREPORT_TOOLS: "liste_indicateurs,valeur_indicateur",
      DROPBOX_APP_KEY: "dbx-app-key", DROPBOX_APP_SECRET: "dbx-app-secret", DROPBOX_API_URL: upstreamUrl, DROPBOX_MCP_URL: `${upstreamUrl}/dropbox-mcp`,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (d) => { logs += d; });
  child.stderr.on("data", (d) => { logs += d; });
  let exited = false;
  child.on("exit", () => { exited = true; });

  // Attente de /health
  const deadline = Date.now() + 15_000;
  for (;;) {
    if (exited) throw new Error(`Le hub s'est arrêté prématurément :\n${logs}`);
    try { const r = await fetch(`${url}/health`); if (r.ok) break; } catch { /* pas encore prêt */ }
    if (Date.now() > deadline) { child.kill("SIGKILL"); throw new Error(`Le hub ne répond pas sur /health :\n${logs}`); }
    await sleep(50);
  }

  const hub = {
    url, dataDir, port, child,
    logs: () => logs,
    readUsers: () => JSON.parse(readFileSync(join(dataDir, "users.json"), "utf8")).users,
    async stop() {
      if (!exited) {
        child.kill("SIGTERM");
        await Promise.race([new Promise((r) => child.once("exit", r)), sleep(3000).then(() => child.kill("SIGKILL"))]);
      }
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return hub;
}
