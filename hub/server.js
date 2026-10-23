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
// En production, un connecteur sans configuration (simulateur) n'est pas exposé : jamais de données inventées en prod.
const CONNECTORS = [salesforce, sagex3, sharepoint, dropbox, myreport].filter((c) => !(IS_PROD && c.mock));
const byId = Object.fromEntries(CONNECTORS.map((c) => [c.id, c]));
// Variables visibles dans le portail : toutes celles des connecteurs et du hub présentes dans l'environnement (jamais la valeur des secrets).
const ENV = Object.keys(process.env).filter((n) => /^(PUBLIC_URL|APP_ENV|LOG_LEVEL|TRUST_PROXY|ENCRYPTION_KEY|SF_|SAGE_|MS_|SP_|GRAPH_URL|DROPBOX_|MYREPORT_|CLEVOA_)/.test(n)).sort();
const masked = (n) => (/SECRET|CLEVOA_KEY|ENCRYPTION_KEY/.test(n) ? "••••••••" : process.env[n]);

// ---------- Limitation de débit (mémoire, par adresse IP) ----------
// Protège le diagnostic, les jetons et les échecs d'authentification contre la force brute. Fenêtre fixe simple.
const buckets = new Map(); // "règle:ip" -> { n, reset }
function hit(rule, ip, max, windowMs = 60_000) {
  const id = `${rule}:${ip}`, now = Date.now();
  let b = buckets.get(id);
  if (!b || b.reset < now) { b = { n: 0, reset: now + windowMs }; buckets.set(id, b); }
  if (buckets.size > 10_000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k); // purge paresseuse
  return ++b.n > max;
}
const limit = (rule, max) => (req, res, next) => hit(rule, req.ip, max) ? res.status(429).json({ error: "Trop de requêtes, réessayez dans une minute." }) : next();

// ---------- Identité ----------
// Cookie "mcp_key" pour le portail ; en-tête "Authorization: Bearer <clé>" UNIQUEMENT pour les clients MCP
// (jamais dans l'URL : les journaux des reverse-proxys conserveraient la clé en clair).
const cookieKey = (req) => req.headers.cookie?.match(/(?:^|;\s*)mcp_key=([^;]+)/)?.[1];
const mcpKey = (req) => req.headers.authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
// CLEVOA_KEY est une clé de licence (pas un secret utilisateur) mais reste masquée comme les autres clés.
const requireKey = (read) => (req, res, next) => {
  req.key = read(req);
  if (store.get(req.key)) return next(); // une clé valide n'est jamais freinée par les échecs d'autres clients de la même IP
  if (hit("auth-fail", req.ip, 20)) return res.status(429).json({ error: "Trop d'échecs d'authentification, réessayez dans une minute." });
  res.status(401).json({ error: "Clé MCP inconnue ou absente : utilisez l'en-tête Authorization: Bearer <clé> obtenue sur le portail." });
};
const mcpUser = requireKey(mcpKey), portalUser = requireKey(cookieKey);

/** Exécute un outil/ping d'un connecteur avec le jeton de l'utilisateur et sa structure en cache.
 *  Un connecteur peut plafonner ses appels sortants (maxPerMinute, tous utilisateurs confondus) pour ménager un système de production. */
const capped = (c, key) => c.maxPerMinute && hasCredential(store.get(key)?.[c.id]) && hit(`upstream:${c.id}`, "*", c.maxPerMinute); // 1 appel d'outil ou de diagnostic = 1 unité
const call = (c, key, fn) => {
  if (capped(c, key)) throw new Error(`${c.label} : plafond de ${c.maxPerMinute} appels par minute atteint, réessayez dans un instant.`);
  return withToken(c, key, (tok) => fn(tok, () => cachedSchema(key, c.id, () => c.schema(tok))));
};

// ---------- Serveur MCP (un par connexion, lié à la clé de l'utilisateur) ----------
/** Ligne de provenance jointe à chaque résultat : système, et dossier pour Sage X3. */
const provenance = (c) => `Source : ${c.label}${c.source ? ` · ${c.source()}` : ""}`;
const INSTRUCTIONS = [
  "Outils en LECTURE SEULE sur Salesforce, Sage X3, SharePoint, Dropbox et MyReport avec les droits de l'utilisateur connecté.",
  "Chaque résultat se termine par une ligne « Source : … » (système, dossier Sage X3, sandbox ou production Salesforce) : toujours la citer dans la réponse, pour que l'utilisateur sache d'où vient chaque donnée.",
  "Question sur un client, un fournisseur, une commande ou une facture sans nommer le système : interroger Sage X3 ET Salesforce, puis dire ce que chacun renvoie.",
  "Salesforce : salesforce_tools puis salesforce_call (serveur MCP officiel SObject Reads). Sage X3 : sagex3_describe puis sagex3_query ; les montants sont dans la devise de l'ERP.",
  "Documents : sharepoint_search / sharepoint_read, dropbox_tools puis dropbox_call. Analyses MyReport : myreport_tools puis myreport_call.",
].join(" ");

function buildServer(key) {
  const server = new McpServer(
    { name: "charlois-finance", version: VERSION },
    { instructions: INSTRUCTIONS },
  );
  for (const c of CONNECTORS) for (const t of c.tools) {
    server.registerTool(t.name, { description: t.description, inputSchema: t.input, annotations: { readOnlyHint: true } }, async (args) => {
      telemetry.count();
      const t0 = Date.now();
      try {
        const out = await call(c, key, (tok, schema) => t.run(tok, args, schema));
        debug(`${t.name} ok ${Date.now() - t0} ms`); // jamais les arguments ni les résultats
        const body = out?.$content ? out.$content : [{ type: "text", text: typeof out === "string" ? out : JSON.stringify(out) }]; // $content : contenu MCP relayé tel quel (image, resource)
        return { content: [...body, { type: "text", text: provenance(c) }] }; // traçabilité : d'où vient chaque donnée
      } catch (e) {
        debug(`${t.name} erreur ${Date.now() - t0} ms : ${e.status ?? "erreur"}`); // jamais le message (il peut citer une clé demandée)
        return { isError: true, content: [{ type: "text", text: e.message }] };
      }
    });
  }
  return server;
}

// ---------- HTTP ----------
const app = express();
app.set("trust proxy", Number(process.env.TRUST_PROXY ?? 1)); // adresse IP réelle derrière un reverse-proxy (1 saut)
app.use(express.json({ limit: "1mb" }));
app.use(express.static(new URL("./public", import.meta.url).pathname));
app.use(oauthRouter(CONNECTORS, cookieKey));

// Portail : état de l'utilisateur (crée la clé au premier passage) + configuration masquée.
app.get("/api/me", limit("me", 60), (req, res) => {
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
      ? ENV.map((n) => ({ name: n, value: process.env[n] ? masked(n) : null })) : undefined,
  });
});
app.post("/api/disconnect/:system", limit("portal", 30), portalUser, (req, res) => {
  if (!byId[req.params.system]) return res.sendStatus(404);
  store.clearTokens(req.key, req.params.system); res.sendStatus(204);
});
// Jeton personnel (clé d'API Syracuse, jeton MyReport…) saisi par l'utilisateur : remplace son entrée pour ce système.
app.post("/api/:system/apikey", limit("portal", 30), portalUser, (req, res) => {
  const c = byId[req.params.system];
  if (!c?.apiKey) return res.sendStatus(404);
  const apiKey = String(req.body?.apiKey || "").trim(), login = String(req.body?.login || "").trim();
  if (!apiKey) return res.status(400).json({ error: "Jeton vide" });
  store.clearTokens(req.key, c.id);
  store.setTokens(req.key, c.id, { apiKey, ...(login ? { login } : {}) });
  res.sendStatus(204);
});
// Diagnostic : un appel minimal au système avec le jeton de l'utilisateur (ou le simulateur).
app.get("/api/test/:system", limit("diag", 20), portalUser, async (req, res) => {
  const c = byId[req.params.system];
  if (!c) return res.sendStatus(404);
  if (capped(c, req.key)) return res.json({ ok: false, error: `${c.label} : plafond de ${c.maxPerMinute} appels par minute atteint, réessayez dans un instant.` });
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
