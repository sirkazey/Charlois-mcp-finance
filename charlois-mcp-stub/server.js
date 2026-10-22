// Bouchon d'entreprise Charlois : un seul processus qui imite les API réelles joignables par le hub.
// Salesforce (REST + OAuth2), Microsoft (Entra + Graph), Dropbox (OAuth2 + serveur MCP Streamable HTTP),
// Sage X3 Syracuse (REST + IdP OAuth2 / clé d'API / Basic), MyReport Server (serveur MCP SSE), Clevoa (télémétrie).
import express from "express";
import { readFileSync, statSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";
import { USERS, SF, SAGE, DOCS, MYREPORT } from "./data.js";
import { authorizePage, approve, tokenEndpoint, bearerUser, sageUser, myreportUser } from "./auth.js";

const PORT = process.env.PORT || 4000;
const FILES = new URL("./files/", import.meta.url);
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));
const base = (req) => `${req.protocol}://${req.headers.host}`;
const deny = (res, status, body) => res.status(status).json(body);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$")));

app.get("/", (_req, res) => res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Bouchon Charlois</title><body style="font:15px system-ui;max-width:720px;margin:40px auto">
<h1>Bouchon d'entreprise Charlois</h1><p>Imite Salesforce, Microsoft Graph, Dropbox MCP, Sage X3 Syracuse, MyReport MCP et Clevoa avec un jeu de données canin.</p>
<h3>Collaborateurs simulés</h3><ul>${Object.entries(USERS).map(([u, p]) => `<li><b>${p.name}</b> (${p.role}) — ${u}<br>Sage X3 : login <code>${p.sageLogin}</code>, clé <code>${p.sageKey}</code> · MyReport : jeton <code>${p.myreportKey}</code> · dossier Confidentiel : ${p.confidentiel ? "oui" : "non"} · achats Sage : ${p.achats ? "oui" : "non"}</li>`).join("")}</ul>
<h3>Points d'entrée</h3><pre>${["/services/oauth2/{authorize,token,userinfo}  /services/data/v62.0/...   Salesforce", "/ms/{tenant}/oauth2/v2.0/{authorize,token}  /v1.0/...                   Microsoft Graph", "/oauth2/{authorize,token}  /dropbox-mcp                                Dropbox", "/oauth/{authorize,token,userinfo}  /api1/x3/erp/{dossier}/...          Sage X3 Syracuse", "/myreport/sse  /myreport/messages                                     MyReport Server (MCP SSE)", "/api/v1/telemetry                                                    Clevoa"].join("\n")}</pre>
<p>Télémétrie reçue : <a href="/api/v1/telemetry">/api/v1/telemetry</a></p></body>`));
app.get("/_stub/approve", approve);

// ---------------------------------------------------------------- Salesforce
app.get("/services/oauth2/authorize", authorizePage("sf", "Salesforce"));
app.post("/services/oauth2/token", tokenEndpoint("sf"));
app.get("/services/oauth2/userinfo", (req, res) => { const u = bearerUser(req, "sf"); if (!u) return deny(res, 401, { error: "invalid_token" }); res.json({ email: u, name: USERS[u].name, user_id: SF.User.records.find((r) => r.Email === u)?.Id }); });
app.use("/services/data/v62.0", (req, res) => {
  const u = bearerUser(req, "sf");
  if (!u) return deny(res, 401, [{ errorCode: "INVALID_SESSION_ID", message: "Session expired or invalid" }]);
  const p = req.path, q = req.query;
  if (p === "/limits") return res.json({ DailyApiRequests: { Max: 15000, Remaining: 14821 }, DailyBulkApiBatches: { Max: 15000, Remaining: 15000 } });
  if (p === "/sobjects") return res.json({ sobjects: Object.entries(SF).map(([name, o]) => ({ name, label: o.label, queryable: true, custom: false })) });
  let m = p.match(/^\/sobjects\/(\w+)\/describe$/);
  if (m) return SF[m[1]] ? res.json({ name: m[1], label: SF[m[1]].label, fields: SF[m[1]].fields }) : deny(res, 404, [{ errorCode: "NOT_FOUND", message: "The requested resource does not exist" }]);
  if (p === "/query") {
    const soql = String(q.q || ""), from = soql.match(/\bFROM\s+(\w+)/i)?.[1], obj = SF[from];
    if (!obj) return deny(res, 400, [{ errorCode: "INVALID_TYPE", message: `sObject type '${from}' is not supported.` }]);
    let rows = obj.records.slice();
    for (const [, f, v] of soql.matchAll(/\bWHERE\s+(\w+)\s*=\s*'([^']*)'|\bAND\s+(\w+)\s*=\s*'([^']*)'/gi)) if (f) rows = rows.filter((r) => String(r[f]) === v);
    const limit = Number(soql.match(/\bLIMIT\s+(\d+)/i)?.[1] || 2000);
    const sel = soql.match(/^\s*SELECT\s+(.+?)\s+FROM/i)?.[1].split(",").map((s) => s.trim());
    const known = sel && sel.every((f) => obj.fields.some((x) => x.name === f));
    const out = rows.slice(0, limit).map((r) => ({ attributes: { type: from, url: `/services/data/v62.0/sobjects/${from}/${r.Id}` }, ...(known ? Object.fromEntries(sel.map((f) => [f, r[f]])) : r) }));
    return res.json({ totalSize: rows.length, done: true, records: out });
  }
  deny(res, 404, [{ errorCode: "NOT_FOUND", message: `bouchon : ${p}` }]);
});

// ---------------------------------------------------------------- Microsoft Entra + Graph
app.get("/ms/:tenant/oauth2/v2.0/authorize", authorizePage("ms", "Microsoft Entra ID"));
app.post("/ms/:tenant/oauth2/v2.0/token", tokenEndpoint("ms"));
const docItem = (d, req) => ({ id: d.id, name: d.path.split("/").pop(), size: d.file ? statSync(new URL(d.file, FILES)).size : undefined, lastModifiedDateTime: "2026-10-01T08:00:00Z", webUrl: `${base(req)}/sharepoint/sites/Finance/${d.path}`, ...(d.folder ? { folder: { childCount: DOCS.filter((x) => x.path.startsWith(d.path + "/")).length } } : { file: { mimeType: d.mime } }) });
const visible = (u) => DOCS.filter((d) => !d.restricted || USERS[u].confidentiel);
app.use("/v1.0", (req, res) => {
  const u = bearerUser(req, "ms");
  if (!u) return deny(res, 401, { error: { code: "InvalidAuthenticationToken", message: "Access token is empty or expired." } });
  const p = decodeURIComponent(req.path);
  if (p === "/me") return res.json({ displayName: USERS[u].name, mail: u, userPrincipalName: u, jobTitle: USERS[u].role });
  if (p === "/sites") return res.json({ value: [{ id: "charlois.sharepoint.com,site-finance", displayName: "Finance", name: "Finance", webUrl: `${base(req)}/sharepoint/sites/Finance` }] });
  let m = p.match(/^\/(?:me\/drive|sites\/[^/]+\/drive)\/root(?::\/(.+):)?\/children$/);
  if (m) {
    const dir = (m[1] || "").replace(/^\/+|\/+$/g, "");
    if (dir && !DOCS.find((d) => d.folder && d.path === dir)) return deny(res, 404, { error: { code: "itemNotFound", message: "The resource could not be found." } });
    if (dir && DOCS.find((d) => d.path === dir)?.restricted && !USERS[u].confidentiel) return deny(res, 403, { error: { code: "accessDenied", message: "Access denied" } });
    return res.json({ value: visible(u).filter((d) => d.path.split("/").slice(0, -1).join("/") === dir).map((d) => docItem(d, req)) });
  }
  m = p.match(/\/root\/search\(q='(.*)'\)$/);
  if (m) { const s = m[1].replace(/''/g, "'").toLowerCase(); return res.json({ value: visible(u).filter((d) => !d.folder && d.path.toLowerCase().includes(s)).map((d) => docItem(d, req)) }); }
  m = p.match(/\/items\/(\w+)(\/content)?$/);
  if (m) {
    const d = DOCS.find((x) => x.id === m[1]);
    if (!d || (d.restricted && !USERS[u].confidentiel)) return deny(res, d ? 403 : 404, { error: { code: d ? "accessDenied" : "itemNotFound", message: d ? "Access denied" : "Not found" } });
    if (!m[2]) return res.json(docItem(d, req));
    return res.redirect(302, `${base(req)}/dl/${d.id}`); // URL de téléchargement pré-authentifiée, comme Graph
  }
  deny(res, 404, { error: { code: "itemNotFound", message: `bouchon : ${p}` } });
});
app.get("/dl/:id", (req, res) => { const d = DOCS.find((x) => x.id === req.params.id && x.file); if (!d) return res.sendStatus(404); res.type(d.mime).send(readFileSync(new URL(d.file, FILES))); });

// ---------------------------------------------------------------- Dropbox (OAuth2 + serveur MCP officiel simulé)
app.get("/oauth2/authorize", authorizePage("dbx", "Dropbox"));
app.post("/oauth2/token", tokenEndpoint("dbx"));
function dropboxMcp(u) {
  const srv = new McpServer({ name: "dropbox-stub", version: "1.0.0" });
  const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }] });
  const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
  const find = (path) => { const d = DOCS.find((x) => "/" + x.path === path); return !d ? null : d.restricted && !USERS[u].confidentiel ? "denied" : d; };
  const entry = (d) => ({ ".tag": d.folder ? "folder" : "file", name: d.path.split("/").pop(), path_display: "/" + d.path, ...(d.file ? { size: statSync(new URL(d.file, FILES)).size, client_modified: "2026-10-01T08:00:00Z" } : {}) });
  srv.registerTool("who_am_i", { description: "Compte Dropbox courant", inputSchema: {} }, async () => text(`${USERS[u].name} <${u}> — équipe Charlois (${USERS[u].role})`));
  srv.registerTool("list_folder", { description: "Liste le contenu d'un dossier (path, ex. '/Bilans')", inputSchema: { path: z.string() } }, async ({ path }) => {
    const dir = path.replace(/\/$/, ""); if (dir && find(dir) === "denied") return err("path/access_denied : dossier réservé"); if (dir && !find(dir)) return err("path/not_found");
    return text({ entries: visible(u).filter((d) => "/" + d.path.split("/").slice(0, -1).join("/") === (dir || "/") || (!dir && !d.path.includes("/"))).map(entry), has_more: false });
  });
  srv.registerTool("search", { description: "Recherche de fichiers par nom", inputSchema: { query: z.string() } }, async ({ query }) => text({ matches: visible(u).filter((d) => d.path.toLowerCase().includes(query.toLowerCase())).map(entry) }));
  srv.registerTool("get_file_metadata", { description: "Métadonnées d'un fichier", inputSchema: { path: z.string() } }, async ({ path }) => { const d = find(path); return !d ? err("path/not_found") : d === "denied" ? err("path/access_denied") : text(entry(d)); });
  srv.registerTool("fetch", { description: "Contenu texte d'un fichier (txt, csv) ; les binaires renvoient leurs métadonnées", inputSchema: { path: z.string() } }, async ({ path }) => {
    const d = find(path); if (!d || d === "denied" || d.folder) return err(d === "denied" ? "path/access_denied" : "path/not_found");
    return /^text\//.test(d.mime) ? text(readFileSync(new URL(d.file, FILES), "utf8")) : text({ ...entry(d), note: "Fichier binaire : utilisez file_preview pour une image, ou ouvrez le fichier dans Dropbox." });
  });
  srv.registerTool("file_preview", { description: "Aperçu d'une image (PNG) à analyser", inputSchema: { path: z.string() } }, async ({ path }) => {
    const d = find(path); if (!d || d === "denied" || d.mime !== "image/png") return err("preview/unsupported");
    return { content: [{ type: "image", data: readFileSync(new URL(d.file, FILES)).toString("base64"), mimeType: "image/png" }] };
  });
  srv.registerTool("delete", { description: "Supprime un fichier (écriture : jamais atteignable via le hub)", inputSchema: { path: z.string() } }, async () => text("deleted"));
  return srv;
}
app.post("/dropbox-mcp", async (req, res) => {
  const u = bearerUser(req, "dbx"); if (!u) return deny(res, 401, { error: "invalid_access_token" });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }), srv = dropboxMcp(u);
  res.on("close", () => { transport.close(); srv.close(); });
  await srv.connect(transport); await transport.handleRequest(req, res, req.body);
});

// ---------------------------------------------------------------- Sage X3 Syracuse (+ IdP OAuth2 générique)
app.get("/oauth/authorize", authorizePage("sage", "Entra ID (serveur OAuth2 de Syracuse)"));
app.post("/oauth/token", tokenEndpoint("sage"));
app.get("/oauth/userinfo", (req, res) => { const u = bearerUser(req, "sage"); if (!u) return deny(res, 401, { error: "invalid_token" }); res.json({ email: u, name: USERS[u].name }); });
app.use("/api1/x3/erp/:folder", (req, res) => {
  const u = sageUser(req);
  if (!u) return deny(res, 401, { $diagnoses: [{ $severity: "error", $message: "Authentification requise (Bearer, clé d'API ou Basic)" }] });
  const p = decodeURIComponent(req.path).replace(/^\//, ""), q = req.query, lines = (rep) => SAGE[rep].rows.map((r) => ({ $uuid: `${rep}-${Object.values(r)[0]}`, $etag: 1, $url: `${base(req)}${req.baseUrl}/${rep}('${Object.values(r)[0]}')`, ...r }));
  const access = (rep) => !SAGE[rep] ? 404 : SAGE[rep].restricted && !USERS[u].achats ? 403 : 200;
  let m = p.match(/^\$prototypes\('(\w+)\.\$query'\)$/);
  if (m) { const s = access(m[1]); return s !== 200 ? deny(res, s, { $diagnoses: [{ $severity: "error", $message: s === 403 ? "Accès refusé à cette représentation" : "Représentation inconnue" }] }) : res.json({ $title: SAGE[m[1]].title, $properties: Object.fromEntries(SAGE[m[1]].props) }); }
  m = p.match(/^(\w+)\('(.+)'\)$/);
  if (m) { const s = access(m[1]); if (s !== 200) return deny(res, s, { $diagnoses: [{ $message: s === 403 ? "Accès refusé" : "Représentation inconnue" }] }); const row = lines(m[1]).find((r) => String(Object.values(strip(r))[0]) === m[2]); return row ? res.json(row) : deny(res, 404, { $diagnoses: [{ $message: "Enregistrement inconnu" }] }); }
  m = p.match(/^(\w+)$/);
  if (m) {
    const s = access(m[1]); if (s !== 200) return deny(res, s, { $diagnoses: [{ $message: s === 403 ? "Accès refusé à cette représentation" : "Représentation inconnue" }] });
    let rows = lines(m[1]);
    for (const [, f, op, v] of String(q.where || "").matchAll(/\(?\s*(\w+)\s+(eq|ne|ge|le|gt|lt|like)\s+'([^']*)'\s*\)?/g)) rows = rows.filter((r) => { const x = String(r[f] ?? ""); return { eq: x === v, ne: x !== v, ge: x >= v, le: x <= v, gt: x > v, lt: x < v, like: x.toLowerCase().includes(v.toLowerCase()) }[op]; });
    const [ob, dir] = String(q.orderBy || "").split(/\s+/); if (ob) rows.sort((a, b) => (a[ob] > b[ob] ? 1 : -1) * (dir === "desc" ? -1 : 1));
    return res.json({ $url: `${base(req)}${req.originalUrl}`, $resources: rows.slice(0, Number(q.count || 20)) });
  }
  deny(res, 404, { $diagnoses: [{ $message: `bouchon : ${p}` }] });
});

// ---------------------------------------------------------------- MyReport Server (serveur MCP SSE)
const sseSessions = new Map();
function myreportMcp(u) {
  const srv = new McpServer({ name: "myreport-stub", version: "24.1.0" });
  const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
  srv.registerTool("liste_indicateurs", { description: "Indicateurs financiers publiés dans MyReport", inputSchema: {} }, async () => text(MYREPORT.indicateurs));
  srv.registerTool("synthese_couts_par_race", { description: "Synthèse des coûts (croquettes, vétérinaire, concours) par race sur la période", inputSchema: { periode: z.string().default("2026"), race: z.string().optional() } }, async ({ periode, race }) =>
    text({ periode, utilisateur: USERS[u].name, lignes: MYREPORT.coutsParRace.filter((l) => !race || l.race.toLowerCase().includes(race.toLowerCase())) }));
  srv.registerTool("valeur_indicateur", { description: "Valeur mensuelle d'un indicateur", inputSchema: { code: z.string(), mois: z.string().default("2026-09") } }, async ({ code, mois }) =>
    text({ code, mois, valeur: { CA_CROQ: 71700, COUT_VETO: 3300, MARGE_RACE: 30100 }[code] ?? null, devise: "EUR" }));
  srv.registerTool("purger_cache", { description: "Purge le cache des rapports (écriture : à exclure de MYREPORT_TOOLS)", inputSchema: {} }, async () => text("purgé"));
  return srv;
}
app.get("/myreport/sse", async (req, res) => {
  const u = myreportUser(req); if (!u) return deny(res, 401, { error: "jeton MyReport invalide" });
  const transport = new SSEServerTransport("/myreport/messages", res);
  sseSessions.set(transport.sessionId, transport);
  res.on("close", () => sseSessions.delete(transport.sessionId));
  await myreportMcp(u).connect(transport);
});
app.post("/myreport/messages", async (req, res) => {
  if (!myreportUser(req)) return deny(res, 401, { error: "jeton MyReport invalide" });
  const t = sseSessions.get(req.query.sessionId); if (!t) return deny(res, 404, { error: "session inconnue" });
  await t.handlePostMessage(req, res, req.body);
});

// ---------------------------------------------------------------- Clevoa (télémétrie)
const telemetry = [];
app.post("/api/v1/telemetry", (req, res) => { if (!req.headers["x-clevoa-key"]) return deny(res, 401, { status: "unauthorized" }); telemetry.push({ receivedAt: new Date().toISOString(), ...req.body }); res.json({ status: "active", totalToday: telemetry.length }); });
app.get("/api/v1/telemetry", (_req, res) => res.json(telemetry));

app.listen(PORT, () => console.log(`Bouchon Charlois sur http://localhost:${PORT} · ${Object.keys(USERS).length} collaborateurs simulés · jetons valides ${process.env.TOKEN_TTL_MIN ?? 10} min`));
