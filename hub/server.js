// Hub MCP central : identifie l'utilisateur (clé perso), expose les outils des connecteurs en SSE
// (/sse + /messages) et en Streamable HTTP (/mcp), sert le portail kiosque, les flux OAuth et le diagnostic.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { store } from "./store.js";
import { oauthRouter, withToken, hasCredential, PUBLIC_URL } from "./oauth.js";
import { cachedSchema } from "./cache.js";
import * as salesforce from "./connectors/salesforce.js";
import * as sagex3 from "./connectors/sagex3.js";
import * as sharepoint from "./connectors/sharepoint.js";
import * as dropbox from "./connectors/dropbox.js";
import * as myreport from "./connectors/myreport.js";
import * as telemetry from "./telemetry.js";
import { VERSION, APP_ENV, IS_PROD } from "./version.js";

const PORT = process.env.PORT || 8080;
const debug = process.env.LOG_LEVEL === "debug" ? (...a) => console.log("[debug]", ...a) : () => {};
// Verrou production : l'URL publique doit être en https (cookie Secure, callbacks OAuth), sauf test local.
if (IS_PROD && !/^https:|^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(PUBLIC_URL)) { console.error(`[prod] PUBLIC_URL doit être en https : ${PUBLIC_URL}`); process.exit(1); }
const CONNECTORS = [salesforce, sagex3, sharepoint, dropbox, myreport];
const byId = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]));
// Variables visibles dans le portail (les *SECRET* ne sont jamais renvoyées, seulement « défini / vide »).
const ENV = ["PUBLIC_URL", "SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET", "SAGE_URL", "SAGE_FOLDER", "SAGE_APIKEY_MODE", "SAGE_OAUTH_AUTH_URL", "SAGE_OAUTH_TOKEN_URL", "SAGE_OAUTH_USERINFO_URL", "SAGE_OAUTH_CLIENT_ID", "SAGE_OAUTH_CLIENT_SECRET", "SAGE_OAUTH_SCOPE",
  "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SP_SITE", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "MYREPORT_MCP_URL", "MYREPORT_AUTH_HEADER", "MYREPORT_TOOLS", "CLEVOA_URL", "CLEVOA_KEY"];

// ---------- Identité ----------
// Cookie "mcp_key" pour le portail ; en-tête "Authorization: Bearer <key>" ou "?key=" pour les clients MCP.
const cookieKey = (req) => req.headers.cookie?.match(/(?:^|;\s*)mcp_key=([^;]+)/)?.[1];
const mcpKey = (req) => req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.key;
// CLEVOA_KEY est une clé de licence (pas un secret utilisateur) mais reste masquée comme les autres clés.
const requireKey = (read) => (req, res, next) => {
  req.key = read(req);
  if (!store.get(req.key)) return res.status(401).json({ error: "Clé MCP inconnue : ouvrez le portail pour obtenir la vôtre." });
  next();
};
const mcpUser = requireKey(mcpKey), portalUser = requireKey(cookieKey);

/** Exécute un outil/ping d'un connecteur avec le jeton de l'utilisateur et sa structure en cache. */
const call = (c, key, fn) => withToken(c, key, (tok) => fn(tok, () => cachedSchema(key, c.id, () => c.schema(tok))));

// ---------- Serveur MCP (un par connexion, lié à la clé de l'utilisateur) ----------
function buildServer(key) {
  const server = new McpServer(
    { name: "charlois-finance", version: "1.0.0" },
    { instructions: "Outils en LECTURE SEULE sur Salesforce, Sage X3, SharePoint, Dropbox et MyReport avec les droits de l'utilisateur connecté. ERP/CRM : commence par *_describe pour connaître les champs, puis interroge en direct ; les montants sont dans la devise de l'ERP. Documents : sharepoint_search / sharepoint_read, dropbox_tools puis dropbox_call. Analyses financières MyReport : myreport_tools puis myreport_call." },
  );
  for (const c of CONNECTORS) for (const t of c.tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true } }, async (args) => {
      telemetry.count();
      const t0 = Date.now();
      try {
        const out = await call(c, key, (tok, schema) => t.run(tok, args, schema));
        debug(`${t.name} ok ${Date.now() - t0} ms`); // jamais les arguments ni les résultats
        return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
      } catch (e) {
        debug(`${t.name} erreur ${Date.now() - t0} ms : ${e.message.slice(0, 120)}`);
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    });
  }
  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(new URL("./public", import.meta.url).pathname));
app.use(oauthRouter(CONNECTORS, cookieKey));

// Portail : état de l'utilisateur (crée la clé au premier passage) + configuration masquée.
app.get("/api/me", (req, res) => {
  let key = cookieKey(req);
  if (!store.get(key)) {
    key = store.create();
    res.setHeader("Set-Cookie", `mcp_key=${key}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${PUBLIC_URL.startsWith("https") ? "; Secure" : ""}`);
  }
  const u = store.get(key);
  res.json({
    version: VERSION,
    env: APP_ENV,
    email: u.email || null,
    key,
    mcpUrl: `${PUBLIC_URL}/mcp`,
    systems: CONNECTORS.map((c) => ({
      id: c.id, label: c.label, mock: !!c.mock, oauth: !!c.oauth, configured: !!c.oauth?.clientId,
      connected: hasCredential(u[c.id]), method: u[c.id]?.apiKey ? "apikey" : u[c.id]?.access_token ? "oauth" : null,
      apiKey: c.apiKey && !c.mock ? c.apiKey : undefined, // le portail propose la saisie d'un jeton personnel
    })),
    // Configuration visible en local (Docker Desktop) ou une fois l'utilisateur connecté à un système ; jamais aux anonymes d'un hub public.
    config: !PUBLIC_URL.startsWith("https") || CONNECTORS.some((c) => hasCredential(u[c.id]))
      ? ENV.map((n) => ({ name: n, value: !process.env[n] ? null : /SECRET|CLEVOA_KEY/.test(n) ? "••••••••" : process.env[n] })) : undefined,
  });
});
app.post("/api/disconnect/:system", portalUser, (req, res) => {
  if (!byId[req.params.system]) return res.sendStatus(404);
  store.clearTokens(req.key, req.params.system); res.sendStatus(204);
});
// Jeton personnel (clé d'API Syracuse, jeton MyReport…) saisi par l'utilisateur : remplace son entrée pour ce système.
app.post("/api/:system/apikey", portalUser, (req, res) => {
  const c = byId[req.params.system];
  if (!c?.apiKey) return res.sendStatus(404);
  const apiKey = String(req.body?.apiKey || "").trim(), login = String(req.body?.login || "").trim();
  if (!apiKey) return res.status(400).json({ error: "Jeton vide" });
  store.clearTokens(req.key, c.id);
  store.setTokens(req.key, c.id, { apiKey, ...(login ? { login } : {}) });
  res.sendStatus(204);
});
// Diagnostic : un appel minimal au système avec le jeton de l'utilisateur (ou le simulateur).
app.get("/api/test/:system", portalUser, async (req, res) => {
  const c = byId[req.params.system];
  if (!c) return res.sendStatus(404);
  try { res.json({ ok: true, ...(await withToken(c, req.key, (tok) => c.ping(tok, () => c.schema(tok)))) }); } // structure relue, pas le cache
  catch (e) { res.json({ ok: false, error: e.message.slice(0, 300) }); }
});

// Transport SSE (standard historique) : GET /sse ouvre le flux, POST /messages?sessionId= reçoit les requêtes.
const sseSessions = new Map();
app.get("/sse", mcpUser, async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  sseSessions.set(transport.sessionId, transport);
  res.on("close", () => sseSessions.delete(transport.sessionId));
  await buildServer(req.key).connect(transport);
});
app.post("/messages", async (req, res) => {
  const t = sseSessions.get(req.query.sessionId);
  if (!t) return res.status(404).send("Session SSE inconnue");
  await t.handlePostMessage(req, res, req.body);
});

// Transport Streamable HTTP (sans état) : un serveur jetable par requête.
app.post("/mcp", mcpUser, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer(req.key);
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_req, res) => res.status(405).json({ error: "Utilisez POST (mode sans état)." }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Hub MCP v${VERSION} · ENV: ${APP_ENV} · ${PUBLIC_URL} (port ${PORT})${sagex3.mock ? " · Sage X3 simulé" : ""}${myreport.mock ? " · MyReport simulé" : ""}${process.env.LOG_LEVEL === "debug" ? " · logs détaillés" : ""}`);
  telemetry.start(CONNECTORS);
});
