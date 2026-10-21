// Hub MCP central : identifie l'utilisateur (clé perso), expose les outils des connecteurs en SSE
// (/sse + /messages) et en Streamable HTTP (/mcp), sert le portail kiosque et les flux OAuth.
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { store } from "./store.js";
import { oauthRouter, withToken } from "./oauth.js";
import { schemaCache } from "./cache.js";
import * as salesforce from "./connectors/salesforce.js";
import * as sagex3 from "./connectors/sagex3.js";

const PORT = process.env.PORT || 8080;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
const CONNECTORS = [salesforce, sagex3];

// ---------- Identité ----------
// Cookie "mcp_key" pour le portail ; en-tête "Authorization: Bearer <key>" ou "?key=" pour les clients MCP.
const cookieKey = (req) => req.headers.cookie?.match(/(?:^|;\s*)mcp_key=([^;]+)/)?.[1];
const mcpKey = (req) => req.headers.authorization?.replace(/^Bearer\s+/i, "") || req.query.key;

function requireUser(req, res, next) {
  req.key = mcpKey(req);
  if (!store.get(req.key)) return res.status(401).json({ error: "Clé MCP inconnue : ouvrez le portail pour obtenir la vôtre." });
  next();
}

// ---------- Serveur MCP (un par connexion, lié à la clé de l'utilisateur) ----------
function buildServer(key) {
  const server = new McpServer(
    { name: "charlois-finance", version: "1.0.0" },
    { instructions: "Outils en LECTURE SEULE sur Salesforce et Sage X3 avec les droits de l'utilisateur connecté. Commence par *_describe pour connaître les champs, puis interroge en direct. Les montants sont dans la devise de l'ERP." },
  );
  for (const c of CONNECTORS) {
    for (const t of c.tools(schemaCache.get(c.id))) {
      server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true } }, async (args) => {
        try {
          const out = await withToken(c, key, (tok) => t.run(tok, args));
          return { content: [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }] };
        } catch (e) {
          return { isError: true, content: [{ type: "text", text: e.message }] };
        }
      });
    }
  }
  return server;
}

// ---------- HTTP ----------
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static("public"));
app.use(oauthRouter(CONNECTORS, cookieKey));

// Portail : état de l'utilisateur (crée la clé au premier passage).
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
    systems: CONNECTORS.map((c) => ({ id: c.id, label: c.label, connected: !!u[c.id]?.access_token, configured: !!c.oauth.clientId, schemaAt: schemaCache.updatedAt(c.id) })),
  });
});
app.post("/api/disconnect/:system", (req, res) => { store.clearTokens(cookieKey(req), req.params.system); res.sendStatus(204); });

// Transport SSE (standard historique) : GET /sse ouvre le flux, POST /messages?sessionId= reçoit les requêtes.
const sseSessions = new Map();
app.get("/sse", requireUser, async (req, res) => {
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
app.post("/mcp", requireUser, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer(req.key);
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.all("/mcp", (_req, res) => res.status(405).json({ error: "Utilisez POST (mode sans état)." }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`Hub MCP sur ${PUBLIC_URL} (port ${PORT})`);
  CONNECTORS.forEach((c) => { if (!schemaCache.get(c.id)) schemaCache.refresh(c); });
  schemaCache.scheduleNightly(CONNECTORS);
});
