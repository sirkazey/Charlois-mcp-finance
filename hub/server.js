// Hub MCP central : identifie l'utilisateur (clé perso), expose les outils des connecteurs en SSE
// (/sse + /messages) et en Streamable HTTP (/mcp), sert le portail kiosque, les flux OAuth et le diagnostic.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { store } from "./store.js";
import { oauthRouter, withToken, hasCredential, PUBLIC_URL } from "./oauth.js";
import { cachedSchema, schemaAge } from "./cache.js";
import * as salesforce from "./connectors/salesforce.js";
import * as sagex3 from "./connectors/sagex3.js";
import * as sharepoint from "./connectors/sharepoint.js";
import * as dropbox from "./connectors/dropbox.js";
import * as myreport from "./connectors/myreport.js";

const PORT = process.env.PORT || 8080;
const CONNECTORS = [salesforce, sagex3, sharepoint, dropbox, myreport];
const byId = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]));
// Variables visibles dans le portail (les *SECRET* ne sont jamais renvoyées, seulement « défini / vide »).
const ENV = ["PUBLIC_URL", "SF_LOGIN_URL", "SF_CLIENT_ID", "SF_CLIENT_SECRET", "SAGE_URL", "SAGE_FOLDER", "SAGE_APIKEY_MODE", "SAGE_OAUTH_AUTH_URL", "SAGE_OAUTH_TOKEN_URL", "SAGE_OAUTH_CLIENT_ID", "SAGE_OAUTH_CLIENT_SECRET", "SAGE_OAUTH_SCOPE",
  "MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "SP_SITE", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_MCP_URL", "MYREPORT_MCP_URL", "MYREPORT_AUTH_HEADER"];

// ---------- Identité ----------
// Cookie "mcp_key" pour le portail ; en-tête "Authorization: Bearer <key>" ou "?key=" pour les clients MCP.
const cookieKey = (req) => req.headers.cookie?.match(/(?:^|;\s*)mcp_key=([^;]+)/)?.[1];
const mcpKey = (req) => req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.key;
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
      try {
        const out = await call(c, key, (tok, schema) => t.run(tok, args, schema));
        return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
      } catch (e) {
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
    email: u.email || null,
    key,
    mcpUrl: `${PUBLIC_URL}/mcp`,
    sseUrl: `${PUBLIC_URL}/sse`,
    systems: CONNECTORS.map((c) => ({
      id: c.id, label: c.label, mock: !!c.mock, oauth: !!c.oauth, configured: !!c.oauth?.clientId, schemaAt: schemaAge(key, c.id),
      connected: hasCredential(u[c.id]), method: u[c.id]?.apiKey ? "apikey" : u[c.id]?.access_token ? "oauth" : null,
      apiKey: c.apiKey && !c.mock ? c.apiKey : undefined, // le portail propose la saisie d'un jeton personnel
    })),
    config: ENV.map((n) => ({ name: n, value: !process.env[n] ? null : n.includes("SECRET") ? "••••••••" : process.env[n] })),
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
  try { res.json({ ok: true, ...(await call(c, req.key, (tok, schema) => c.ping(tok, schema))) }); }
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

app.listen(PORT, () => console.log(`Hub MCP sur ${PUBLIC_URL} (port ${PORT})${sagex3.mock ? " · Sage X3 en mode simulé" : ""}`));
