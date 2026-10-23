// Bouchon d'entreprise Charlois : un seul processus qui imite les API réelles joignables par le hub.
// Salesforce (REST + OAuth2), Microsoft (Entra + Graph), Dropbox (OAuth2 + serveur MCP Streamable HTTP),
// Sage X3 Syracuse (REST + IdP OAuth2 / clé d'API / Basic), MyReport Server (serveur MCP SSE), Clevoa (télémétrie).
import express from "express";
import { readFileSync, statSync } from "node:fs";
import { createHmac, randomBytes } from "node:crypto";
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
const DL_SECRET = randomBytes(16); // signe les URL de téléchargement pré-authentifiées, comme le fait Graph
const sign = (id) => createHmac("sha256", DL_SECRET).update(id).digest("hex").slice(0, 24);
const deny = (res, status, body) => res.status(status).json(body);
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$")));

app.get("/", (_req, res) => res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Bouchon Charlois</title><body style="font:15px system-ui;max-width:720px;margin:40px auto">
<h1>Bouchon d'entreprise Charlois</h1><p>Imite Salesforce, Microsoft Graph, Dropbox MCP, Sage X3 Syracuse, MyReport MCP et Clevoa avec un jeu de données canin.</p>
<h3>Collaborateurs simulés</h3><ul>${Object.entries(USERS).map(([u, p]) => `<li><b>${p.name}</b> (${p.role}) — ${u}<br>Sage X3 : login <code>${p.sageLogin}</code>, clé <code>${p.sageKey}</code> · MyReport : jeton <code>${p.myreportKey}</code> · dossier Confidentiel : ${p.confidentiel ? "oui" : "non"} · achats Sage : ${p.achats ? "oui" : "non"}</li>`).join("")}</ul>
<h3>Points d'entrée</h3><pre>${["/services/oauth2/{authorize,token,userinfo}  /platform/mcp/v1/d/{org}/platform/sobject-reads   Salesforce (MCP hébergé)", "/ms/{tenant}/oauth2/v2.0/{authorize,token}  /v1.0/...                   Microsoft Graph", "/oauth2/{authorize,token}  /dropbox-mcp                                Dropbox", "/oauth/{authorize,token,userinfo}  /api1/x3/erp/{dossier}/...          Sage X3 Syracuse", "/myreport/sse  /myreport/messages                                     MyReport Server (MCP SSE)", "/api/v1/telemetry                                                    Clevoa"].join("\n")}</pre>
<p>Télémétrie reçue : <a href="/api/v1/telemetry">/api/v1/telemetry</a></p></body>`));
app.get("/_stub/approve", approve);

// ---------------------------------------------------------------- Salesforce
app.get("/services/oauth2/authorize", authorizePage("sf", "Salesforce"));
app.post("/services/oauth2/token", tokenEndpoint("sf"));
app.get("/services/oauth2/userinfo", (req, res) => { const u = bearerUser(req, "sf"); if (!u) return deny(res, 401, { error: "invalid_token" }); res.json({ email: u, name: USERS[u].name, user_id: SF.User.records.find((r) => r.Email === u)?.Id }); });
// Serveur MCP hébergé "SObject Reads" simulé (Streamable HTTP), aligné sur le vrai serveur de la sandbox Charlois.
function sobjectReadsMcp(u) {
  const srv = new McpServer({ name: "salesforce-sobject-reads-stub", version: "1.0.0" });
  const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o, null, 1) }], structuredContent: Array.isArray(o) ? undefined : o });
  const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
  // Six outils du vrai serveur hébergé « SObject Reads » (noms, arguments et descriptions relevés sur la sandbox 24/10/2026).
  const soql = (q) => {
    const from = q.match(/\bFROM\s+(\w+)/i)?.[1], obj = SF[from];
    if (!obj || !/^\s*select\s/i.test(q)) return err(`MALFORMED_QUERY: ${q.slice(0, 80)}`);
    let rows = obj.records.slice();
    for (const [, f, v] of q.matchAll(/\b(?:WHERE|AND)\s+(\w+)\s*=\s*'([^']*)'/gi)) rows = rows.filter((r) => String(r[f]) === v);
    const limit = Number(q.match(/\bLIMIT\s+(\d+)/i)?.[1] || 2000);
    const sel = q.match(/^\s*SELECT\s+(.+?)\s+FROM/i)?.[1].split(",").map((x) => x.trim()), known = sel && sel.every((f) => obj.fields.some((x) => x.name === f));
    return text({ totalSize: rows.length, done: true, records: rows.slice(0, limit).map((r) => (known ? Object.fromEntries(sel.map((f) => [f, r[f]])) : r)) });
  };
  srv.registerTool("find", { description: "Executes a text search across multiple objects simultaneously (SOSL).", inputSchema: { q: z.string().describe("The SOSL query string, ex. FIND {Acme} IN NAME FIELDS RETURNING Account(Id, Name)") } }, async ({ q }) => {
    const term = q.match(/FIND\s*\{\s*"?([^"}]*)"?\s*\}/i)?.[1]?.replace(/\*/g, "").toLowerCase();
    if (term === undefined) return err("MALFORMED_SEARCH: FIND {term} attendu");
    const returning = [...q.matchAll(/(\w+)\s*\(([^)]*)\)/g)];
    const scope = returning.length ? returning.map((m) => [m[1], m[2].split(",").map((x) => x.trim())]) : Object.keys(SF).map((n) => [n, null]);
    return text({ searchRecords: scope.flatMap(([n, fields]) => (SF[n]?.records || []).filter((r) => !term || JSON.stringify(r).toLowerCase().includes(term))
      .map((r) => ({ attributes: { type: n }, ...(fields ? Object.fromEntries(fields.map((f) => [f, r[f]])) : r) }))) });
  });
  srv.registerTool("getObjectSchema", { description: "Returns Salesforce schema information. Call with NO PARAMETERS first to get an index of all queryable objects, then with specific object names for field-level details.", inputSchema: { objects: z.string().optional().describe("Comma-separated object API names (e.g., \"Account,Opportunity\"). If omitted, returns an index of all objects.") } }, async ({ objects }) => {
    if (!objects) return text({ objects: Object.entries(SF).map(([name, o]) => ({ name, label: o.label, queryable: true })) });
    const names = objects.split(",").map((x) => x.trim()), unknown = names.filter((n) => !SF[n]);
    return unknown.length ? err(`NOT_FOUND: ${unknown.join(", ")}`) : text({ objects: names.map((n) => ({ name: n, label: SF[n].label, fields: SF[n].fields })) });
  });
  srv.registerTool("getRelatedRecords", { description: "Retrieves child records related to a parent record by traversing relationships.", inputSchema: { "sobject-name": z.string(), id: z.string(), "relationship-path": z.string().describe("Relationship path, e.g. 'Opportunities' or 'Contacts'") } }, async (a) => {
    const rel = a["relationship-path"].split("/")[0], plural = (n) => (n.endsWith("y") ? `${n.slice(0, -1)}ies` : `${n}s`); // Opportunity → Opportunities
    const target = Object.keys(SF).find((n) => plural(n) === rel || n === rel);
    if (!SF[a["sobject-name"]]?.records.some((r) => r.Id === a.id)) return err(`NOT_FOUND: ${a["sobject-name"]} ${a.id}`);
    return text({ totalSize: 0, records: (SF[target]?.records || []).filter((r) => r.AccountId === a.id) });
  });
  srv.registerTool("getUserInfo", { description: "Returns current user's identity, role, and preferences.", inputSchema: {} }, async () =>
    text({ userId: SF.User.records.find((r) => r.Email === u)?.Id, username: `${u}.preprod`, displayName: USERS[u].name, email: u, title: USERS[u].role, profile: USERS[u].achats ? "Administrateur système" : "Utilisateur standard", locale: "fr_FR", timeZone: "Europe/Paris" }));
  srv.registerTool("listRecentSobjectRecords", { description: "Returns records of a specific type that the user recently viewed or modified.", inputSchema: { "sobject-name": z.string() } }, async (a) =>
    SF[a["sobject-name"]] ? text({ recentItems: SF[a["sobject-name"]].records.slice(0, 5) }) : err(`NOT_FOUND: ${a["sobject-name"]}`));
  srv.registerTool("soqlQuery", { description: "Executes a SOQL query to retrieve Salesforce records. Always include a WHERE clause and a LIMIT clause.", inputSchema: { q: z.string().describe("The SOQL query string.") } }, async ({ q }) => soql(q));
  return srv;
}
app.post("/platform/mcp/v1/d/:org/platform/sobject-reads", async (req, res) => {
  const u = bearerUser(req, "sf"); if (!u) return deny(res, 401, { errors: [{ message: "JWT Token is required" }] });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined }), srv = sobjectReadsMcp(u);
  res.on("close", () => { transport.close(); srv.close(); });
  await srv.connect(transport); await transport.handleRequest(req, res, req.body);
});
app.all("/platform/mcp/v1/d/:org/platform/:server", (req, res) => deny(res, req.method === "POST" ? 403 : 405, { errors: [{ message: `serveur MCP ${req.params.server} inactif sur cette org simulée` }] }));

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
    return res.redirect(302, `${base(req)}/dl/${d.id}?sig=${sign(d.id)}`); // URL de téléchargement pré-authentifiée et signée, comme Graph
  }
  deny(res, 404, { error: { code: "itemNotFound", message: `bouchon : ${p}` } });
});
app.get("/dl/:id", (req, res) => {
  const d = DOCS.find((x) => x.id === req.params.id && x.file);
  if (!d) return res.sendStatus(404);
  if (req.query.sig !== sign(d.id)) return deny(res, 403, { error: "URL de téléchargement non signée ou expirée" });
  res.type(d.mime).send(readFileSync(new URL(d.file, FILES)));
});

// ---------------------------------------------------------------- Dropbox (OAuth2 + serveur MCP officiel simulé)
app.get("/oauth2/authorize", authorizePage("dbx", "Dropbox"));
app.post("/oauth2/token", tokenEndpoint("dbx"));
function dropboxMcp(u) {
  // Noms d'outils, arguments et formes de réponse alignés sur le serveur MCP officiel Dropbox (schémas relevés le 22/10/2026).
  const srv = new McpServer({ name: "dropbox-stub", version: "1.0.0" });
  const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 1) }], structuredContent: typeof o === "object" ? o : undefined });
  const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
  const NS = "ns:4242"; // espace de noms d'équipe : les chemins renvoyés sont des ns_path, comme en vrai
  const norm = (p) => (p || "").replace(/^ns:\d+\/\//, "/").replace(/^id:(\w+)$/, (_, id) => "/" + (DOCS.find((d) => d.id === id)?.path ?? "?")).replace(/\/$/, "") || "/";
  const find = (p) => { const d = DOCS.find((x) => "/" + x.path === norm(p)); return !d ? null : d.restricted && !USERS[u].confidentiel ? "denied" : d; };
  const size = (d) => (d.file ? statSync(new URL(d.file, FILES)).size : undefined);
  const entry = (d) => ({ name: d.path.split("/").pop(), path: `${NS}//${d.path}`, path_display: "/" + d.path, file_id: `id:${d.id}`, object_type: d.folder ? "folder" : "file", modified_time: "2026-10-01T08:00:00Z", client_modified: "2026-10-01T08:00:00Z", ...(d.folder ? { folder: {} } : { file: { size: size(d) } }) });
  srv.registerTool("who_am_i", { description: "Get the connected Dropbox user's identity, team, and namespace roots", inputSchema: {} }, async () =>
    text({ account_id: `dbid:${u}`, display_name: USERS[u].name, email: u, country: "FR", locale: "fr", team_id: "dbtid:charlois", team_name: "Charlois", root_namespace_id: "4242", home_namespace_id: "4243" }));
  srv.registerTool("list_folder", { description: "List Dropbox folder contents; supports direct children or recursive traversal", inputSchema: { path: z.string(), recursive: z.boolean().optional(), max_results: z.number().int().optional(), object_types: z.array(z.enum(["file", "folder"])).optional() } }, async ({ path, recursive, object_types }) => {
    const dir = norm(path); if (dir !== "/" && find(dir) === "denied") return err("path/access_denied"); if (dir !== "/" && !find(dir)) return err("path/not_found");
    const prefix = dir === "/" ? "" : dir.slice(1) + "/";
    let list = visible(u).filter((d) => d.path.startsWith(prefix) && (recursive !== false || !d.path.slice(prefix.length).includes("/")));
    if (object_types?.length) list = list.filter((d) => object_types.includes(d.folder ? "folder" : "file"));
    return text({ entries: list.map(entry), cursor: "", has_more: false });
  });
  srv.registerTool("search", { description: "Search Dropbox files and folders by name or content, with optional filters", inputSchema: { query: z.string(), path: z.string().optional(), include_folders: z.boolean().optional(), max_results: z.number().int().optional() } }, async ({ query, include_folders }) =>
    text({ results: visible(u).filter((d) => (include_folders || !d.folder) && d.path.toLowerCase().includes(query.toLowerCase())).map((d, i) => ({ id: `id:${d.id}`, title: d.path.split("/").pop(), url: `https://www.dropbox.com/home/${d.path}`, path: `${NS}//${d.path}`, path_display: "/" + d.path, object_type: d.folder ? "folder" : "file", match_type: "FILENAME", ...(d.file ? { mime_type: d.mime, size: size(d) } : {}), last_modified: "2026-10-01T08:00:00Z", rank: i + 1 })) }));
  srv.registerTool("get_file_metadata", { description: "Get metadata, sharing details, and permissions for a Dropbox file or folder", inputSchema: { path_or_file_id: z.string() } }, async ({ path_or_file_id }) => {
    const d = find(path_or_file_id); if (!d) return err("path/not_found"); if (d === "denied") return err("path/access_denied");
    const common = { tag: d.folder ? "folder" : "file", id: `id:${d.id}`, name: d.path.split("/").pop(), path_display: "/" + d.path, path_lower: "/" + d.path.toLowerCase(), url: `https://www.dropbox.com/home/${d.path}` };
    return text(d.folder ? { metadata_type: "folder", folder: { ...common, descendants_count: DOCS.filter((x) => x.path.startsWith(d.path + "/")).length } }
      : { metadata_type: "file", file: { ...common, client_modified: "2026-10-01T08:00:00Z", server_modified: "2026-10-01T08:00:00Z", size: size(d), mime_type: d.mime, is_downloadable: true, rev: "0a1b2c" } });
  });
  srv.registerTool("fetch", { description: "Fetch full text content for a Dropbox file by id or path", inputSchema: { id: z.string() } }, async ({ id }) => {
    const d = find(id); if (!d || d === "denied" || d.folder) return err(d === "denied" ? "path/access_denied" : "path/not_found");
    if (!/^text\//.test(d.mime)) return err(`extraction_failed: ${d.path.split("/").pop()} — extraction de texte impossible pour ${d.mime} ; ouvrez https://www.dropbox.com/home/${d.path}`);
    return text({ id, title: d.path.split("/").pop(), text: readFileSync(new URL(d.file, FILES), "utf8"), url: `https://www.dropbox.com/home/${d.path}`, metadata: { path_display: "/" + d.path, server_modified: "2026-10-01T08:00:00Z" } });
  });
  srv.registerTool("file_preview", { description: "Preview Dropbox files visually with thumbnails and Open in Dropbox links", inputSchema: { file_paths: z.array(z.string()).min(1) } }, async ({ file_paths }, extra) => {
    const base = `http://${extra?.requestInfo?.headers?.host || "mcp-stub:4000"}`;
    const results = file_paths.map((p) => { const d = find(p); return !d || d === "denied" ? { file_name: p, message: d === "denied" ? "accès refusé" : "introuvable" }
      : { thumbnail_url: d.file ? `${base}/dl/${d.id}?sig=${sign(d.id)}` : "", file_type: d.path.split(".").pop(), open_in_dropbox_url: `https://www.dropbox.com/home/${d.path}`, copy_link_url: `https://www.dropbox.com/scl/${d.id}`, file_name: d.path.split("/").pop(), message: d.mime === "image/png" ? "Podium d'un concours canin (image PNG)" : d.folder ? "Dossier" : "Document" }; });
    return text({ results });
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
  // Format réel Syracuse 24R1 : contexte $actx*, champs sous $properties.$resources.$item.$properties, libellés "{@n}" résolus dans $localization.
  const prototype = (req, rep) => ({
    $actxUser: USERS[u].sageLogin, $actxLogin: USERS[u].sageLogin, $actxFolder: req.params.folder, $actxSolution: "X3STUB", $actxLan: "FRA", $actxLanIso: "fr-FR",
    $baseUrl: `${base(req)}${req.baseUrl}`, $representation: rep, $title: "{@1}", $itemsPerPage: 300,
    $properties: { $resources: { $type: "application/x-array", $item: { $properties: Object.fromEntries(SAGE[rep].props.map(([n, v], i) => [n, { $title: `{@${i + 2}}`, $type: v.$type, $isReadOnly: true, $capabilities: "sort,filter" }])) } } },
    $localization: Object.fromEntries([["@1", SAGE[rep].title], ...SAGE[rep].props.map(([, v], i) => [`@${i + 2}`, v.$title])]),
  });
  const access = (rep) => !SAGE[rep] ? 404 : SAGE[rep].restricted && !USERS[u].achats ? 403 : 200;
  let m = p.match(/^\$prototypes\('(\w+)\.\$(?:query|details)'\)$/); // même structure pour les deux facettes dans le bouchon
  if (m) { const s = access(m[1]); return s !== 200 ? deny(res, s, { $diagnoses: [{ $severity: "error", $message: s === 403 ? "Accès refusé à cette représentation" : "Représentation inconnue" }] }) : res.json(prototype(req, m[1])); }
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
