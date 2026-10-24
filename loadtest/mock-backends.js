// Bouchons de charge : un seul processus HTTP qui imite ce que le hub joint (Salesforce OAuth + serveur MCP SObject Reads, Sage X3
// Syracuse, Microsoft Graph, Dropbox MCP, MyReport MCP SSE, Clevoa) avec, par utilisateur, un MARQUEUR dérivé du jeton
// (« sf-token-usr-07 » → « usr-07 ») glissé dans chaque réponse : le générateur vérifie qu'un utilisateur ne reçoit jamais le marqueur
// d'un autre. Pilotage : POST /__control { delay, fail:{status,rate}, routes } (latence et pannes injectées sur les routes qui
// correspondent), GET /__stats (compteurs et temps de service par famille de routes, latence injectée comprise), POST /__reset.
// Jamais relié à un système réel. Port : PORT (défaut 4100).
import { createServer } from "node:http";
import { McpServer, StreamableHTTPServerTransport, SSEServerTransport, z } from "./sdk.js";

const PORT = Number(process.env.PORT || 4100);
const ctl = { delay: 0, routes: ".*", fail: null }; // fail : { status, rate }
const stats = { families: {}, injected: { delay: 0, fail: 0 }, started: Date.now() };
const fam = (path) => path.startsWith("/api1/") ? "sagex3" : path.includes("sobject-reads") || path.startsWith("/services/") ? "salesforce" : path.startsWith("/v1.0") ? "graph"
  : path.startsWith("/dropbox-mcp") || path.startsWith("/oauth2") ? "dropbox" : path.startsWith("/myreport") ? "myreport" : path.startsWith("/api/v1/telemetry") ? "clevoa" : "autre";
const record = (f, ms, status) => { const s = stats.families[f] ??= { count: 0, errors: 0, ms: [] }; s.count++; if (status >= 400) s.errors++; s.ms.push(ms); if (s.ms.length > 50000) s.ms.splice(0, 10000); };
const pct = (arr, p) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(p * a.length))]; };
const user = (req) => (req.headers.authorization || "").match(/usr-\d{2}/)?.[0] || null; // marqueur du jeton, quel que soit le préfixe
const json = (res, status, obj) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

// ---- serveurs MCP simulés (un par requête : sans état, comme les vrais) ----
const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
function sobjectReads(u) {
  const srv = new McpServer({ name: "sobject-reads-load", version: "1.0.0" });
  srv.registerTool("getUserInfo", { description: "Current user", inputSchema: {} }, async () => text({ userId: `005-${u}`, email: `${u}@charlois.example` }));
  srv.registerTool("getObjectSchema", { description: "Schema", inputSchema: { objects: z.string().optional() } }, async ({ objects }) =>
    text(objects ? { objects: [{ name: objects, fields: Array.from({ length: 40 }, (_, i) => ({ name: `Field${i}__c`, type: "string", label: `Champ ${i} ${u}` })) }] } : { objects: ["Account", "Contact", "Opportunity", "Lead"].map((name) => ({ name })) }));
  srv.registerTool("soqlQuery", { description: "SOQL", inputSchema: { q: z.string() } }, async ({ q }) =>
    text({ totalSize: 20, done: true, records: Array.from({ length: 20 }, (_, i) => ({ Id: `001${i}`, Name: `Compte ${i} ${u}`, Owner: u, q: q.slice(0, 40) })) }));
  return srv;
}
function dropboxMcp(u) {
  const srv = new McpServer({ name: "dropbox-load", version: "1.0.0" });
  srv.registerTool("who_am_i", { description: "Compte", inputSchema: {} }, async () => ({ content: [{ type: "text", text: `${u} <${u}@dropbox.example>` }] }));
  srv.registerTool("list_folder", { description: "Liste", inputSchema: { path: z.string() } }, async ({ path }) => text(Array.from({ length: 15 }, (_, i) => ({ name: `Fichier ${i} ${u}.xlsx`, path: `${path}/Fichier ${i} ${u}.xlsx` }))));
  return srv;
}
function myreportMcp(u) {
  const srv = new McpServer({ name: "myreport-load", version: "1.0.0" });
  srv.registerTool("liste_indicateurs", { description: "Indicateurs", inputSchema: {} }, async () => text([{ code: "CA_HT", utilisateur: u }]));
  srv.registerTool("valeur_indicateur", { description: "Valeur", inputSchema: { code: z.string() } }, async ({ code }) => text({ code, valeur: 42, utilisateur: u }));
  return srv;
}
const sseSessions = new Map();

async function dispatch(req, res, rawBody, path, query) {
  const u = user(req);
  const deny = (status, body) => json(res, status, body);
  // ---- Clevoa ----
  if (path === "/api/v1/telemetry") return json(res, 200, { status: "active" });
  // ---- Salesforce ----
  if (path === "/services/oauth2/token") { const p = new URLSearchParams(rawBody); return json(res, 200, { access_token: `sf-token-${p.get("refresh_token")?.match(/usr-\d{2}/)?.[0] || "x"}`, instance_url: `http://127.0.0.1:${PORT}`, token_type: "Bearer" }); }
  if (path === "/services/oauth2/userinfo") return u ? json(res, 200, { email: `${u}@charlois.example` }) : deny(401, { error: "invalid_token" });
  if (path.endsWith("/sobject-reads")) {
    if (!u) return deny(401, { errors: [{ message: "JWT Token is required" }] });
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }), srv = sobjectReads(u);
    res.on("close", () => { t.close(); srv.close(); });
    await srv.connect(t); return t.handleRequest(req, res, rawBody ? JSON.parse(rawBody) : undefined);
  }
  // ---- Sage X3 Syracuse ----
  if (path.startsWith("/api1/x3/erp/PROD/")) {
    if (!u) return deny(401, { $diagnoses: [{ $severity: "error", $message: "no bearer" }] });
    const rest = path.slice("/api1/x3/erp/PROD/".length);
    let m = rest.match(/^\$prototypes\('(\w+)\.\$details'\)$/);
    if (m) return json(res, 200, { $properties: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`F${i}`, { $type: "application/x-string", $title: `{@${i}}` }])), $localization: Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`@${i}`, `Champ ${i}`])) });
    m = rest.match(/^\$prototypes\('(\w+)\.\$query'\)$/);
    if (m) return json(res, 200, { $properties: { $resources: { $type: "application/x-array", $item: { $properties: { NUM: { $type: "application/x-string", $title: "{@1}" }, BPRNAM: { $type: "application/x-string", $title: "{@2}" }, AMTATI: { $type: "application/x-decimal", $title: "{@3}" } } } } }, $localization: { "@1": "Numéro", "@2": "Nom", "@3": "Montant" } });
    m = rest.match(/^(\w+)\('(.*)'\)$/);
    if (m) return json(res, 200, { $uuid: "u-1", NUM: m[2], BPRNAM: `Tiers ${u}`, LINES: Array.from({ length: 200 }, (_, i) => ({ ITMREF: `ART${i}`, QTY: i, OWNER: u })) });
    m = rest.match(/^(\w+)$/);
    if (m) return json(res, 200, { $resources: Array.from({ length: Number(query.count) || 100 }, (_, i) => ({ $uuid: `r-${i}`, NUM: `F${i}`, BPRNAM: `Tiers ${i} ${u}`, AMTATI: i * 10 })) });
    return deny(404, { $diagnoses: [{ $message: "mock" }] });
  }
  // ---- Microsoft Graph ----
  if (path.startsWith("/v1.0/")) {
    if (!u) return deny(401, { error: { code: "InvalidAuthenticationToken" } });
    if (path === "/v1.0/me") return json(res, 200, { displayName: u, mail: `${u}@charlois.example`, userPrincipalName: `${u}@charlois.example` });
    if (path === "/v1.0/sites") return json(res, 200, { value: [{ id: "site-finance", displayName: `Finance ${u}`, webUrl: "https://sp.example/sites/Finance" }] });
    if (/\/children$/.test(path)) return json(res, 200, { value: Array.from({ length: 25 }, (_, i) => ({ id: `0${i}`, name: `Doc ${i} ${u}.xlsx`, size: 1234, lastModifiedDateTime: "2026-10-01T08:00:00Z", webUrl: `https://sp.example/${u}/${i}`, file: {} })) });
    return deny(404, { error: { code: "itemNotFound" } });
  }
  // ---- Dropbox ----
  if (path === "/oauth2/token") { const p = new URLSearchParams(rawBody); return json(res, 200, { access_token: `dbx-token-${p.get("refresh_token")?.match(/usr-\d{2}/)?.[0] || "x"}`, token_type: "bearer" }); }
  if (path === "/dropbox-mcp") {
    if (!u) return deny(401, { error: "invalid_token" });
    const t = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }), srv = dropboxMcp(u);
    res.on("close", () => { t.close(); srv.close(); });
    await srv.connect(t); return t.handleRequest(req, res, rawBody ? JSON.parse(rawBody) : undefined);
  }
  // ---- MyReport (SSE) ----
  if (path === "/myreport/sse" || path === "/myreport/messages") {
    if (!u) return deny(401, { error: "invalid_token" });
    if (req.method === "GET") { const t = new SSEServerTransport("/myreport/messages", res); sseSessions.set(t.sessionId, t); res.on("close", () => sseSessions.delete(t.sessionId)); return myreportMcp(u).connect(t); }
    const t = sseSessions.get(query.sessionId); if (!t) return deny(404, { error: "session inconnue" });
    return t.handlePostMessage(req, res, JSON.parse(rawBody));
  }
  deny(404, { error: `mock: route inconnue ${req.method} ${path}` });
}

const server = createServer((req, res) => {
  let body = ""; req.on("data", (c) => { body += c; });
  req.on("end", async () => {
    const u = new URL(req.url, "http://mock"), path = decodeURIComponent(u.pathname), query = Object.fromEntries(u.searchParams);
    if (path === "/__control") { Object.assign(ctl, JSON.parse(body || "{}")); return json(res, 200, ctl); }
    if (path === "/__reset") { stats.families = {}; stats.injected = { delay: 0, fail: 0 }; stats.started = Date.now(); Object.assign(ctl, { delay: 0, routes: ".*", fail: null }); return json(res, 200, { ok: true }); }
    if (path === "/__stats") return json(res, 200, { elapsedMs: Date.now() - stats.started, injected: stats.injected, control: ctl, families: Object.fromEntries(Object.entries(stats.families).map(([k, s]) => [k, { count: s.count, errors: s.errors, p50: pct(s.ms, 0.5), p95: pct(s.ms, 0.95), p99: pct(s.ms, 0.99), max: Math.max(0, ...s.ms) }])) });
    const t0 = Date.now(), f = fam(path), matched = new RegExp(ctl.routes).test(path);
    res.on("finish", () => record(f, Date.now() - t0, res.statusCode));
    if (matched && ctl.delay) { stats.injected.delay++; await new Promise((r) => setTimeout(r, ctl.delay)); }
    if (matched && ctl.fail && Math.random() < ctl.fail.rate) { stats.injected.fail++; return json(res, ctl.fail.status, ctl.fail.status === 429 ? { error: "rate limited (mock)" } : { error: "internal error (mock)" }); }
    try { await dispatch(req, res, body, path, query); } catch (e) { if (!res.headersSent) json(res, 500, { error: e.message }); }
  });
});
server.keepAliveTimeout = 65_000;
server.listen(PORT, "127.0.0.1", () => console.log(`mock-backends sur http://127.0.0.1:${PORT}`));
