// Serveur HTTP mock "amont" qui imite à la fois Salesforce (REST + OAuth2) et Sage X3 Syracuse.
// Il enregistre chaque requête reçue (méthode, chemin, query, en-têtes, corps) pour que les tests
// vérifient notamment que l'en-tête Authorization transmis est bien le jeton de l'utilisateur.
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

/** Serveur MCP Dropbox simulé : 2 outils lecture + 1 outil d'écriture (qui ne doit jamais être atteignable via le hub). */
function dropboxMcp() {
  const srv = new McpServer({ name: "dropbox-mock", version: "1.0.0" });
  srv.registerTool("who_am_i", { description: "Compte courant", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "Alice Martin <alice@dropbox.example> (team Charlois)" }] }));
  srv.registerTool("list_folder", { description: "Liste un dossier", inputSchema: { path: z.string() } }, async ({ path }) =>
    path === "/Secret" ? { isError: true, content: [{ type: "text", text: "path/not_found: accès refusé" }] }
      : { content: [{ type: "text", text: JSON.stringify([{ name: "Budget 2026.xlsx", path: `${path}/Budget 2026.xlsx` }, { name: "Clôtures", path: `${path}/Clôtures`, folder: true }]) }] });
  srv.registerTool("file_preview", { description: "Aperçu image", inputSchema: { path: z.string() } }, async () => ({ content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }] }));
  srv.registerTool("delete", { description: "Supprime (écriture)", inputSchema: { path: z.string() } }, async () => ({ content: [{ type: "text", text: "deleted" }] }));
  return srv;
}

export const SF_V = "v62.0";

/** Serveur MCP MyReport simulé (SSE) : 1 outil de lecture + 1 outil d'écriture que le hub doit refuser. */
function myreportMcp() {
  const srv = new McpServer({ name: "myreport-mock", version: "1.0.0" });
  srv.registerTool("liste_indicateurs", { description: "Indicateurs", inputSchema: {} }, async () => ({ content: [{ type: "text", text: JSON.stringify([{ code: "CA_HT" }]) }] }));
  srv.registerTool("valeur_indicateur", { description: "Valeur", inputSchema: { code: z.string() } }, async ({ code }) => ({ content: [{ type: "text", text: JSON.stringify({ code, valeur: 42 }) }] }));
  srv.registerTool("delete_rapport", { description: "Écriture", inputSchema: { id: z.string() } }, async () => ({ content: [{ type: "text", text: "deleted" }] }));
  return srv;
}
const sseSessions = new Map();

/** Serveur MCP Salesforce "SObject Reads" simulé : lecture seule, données d'Alice/Carol/… identiques (droits non simulés ici). */
const SF_FIELDS = {
  Account: [{ name: "Id", type: "id", label: "ID" }, { name: "Name", type: "string", label: "Nom" }, { name: "OwnerId", type: "reference", label: "Propriétaire", ref: ["User"] }],
  Lead: [{ name: "Id", type: "id", label: "ID" }, { name: "Name", type: "string", label: "Nom Lead" }, { name: "OwnerId", type: "reference", label: "Propriétaire", ref: ["User"] }],
};
function sobjectReadsMcp() {
  const srv = new McpServer({ name: "sobject-reads-mock", version: "1.0.0" });
  const text = (o) => ({ content: [{ type: "text", text: JSON.stringify(o) }] });
  srv.registerTool("list_sobjects", { description: "Lists sObjects", inputSchema: {} }, async () => text([{ name: "Account" }, { name: "Contact" }, { name: "Opportunity" }, { name: "Lead" }]));
  srv.registerTool("describe_sobject", { description: "Describes an sObject", inputSchema: { sobject: z.string() } }, async ({ sobject }) =>
    SF_FIELDS[sobject] ? text({ name: sobject, fields: SF_FIELDS[sobject] }) : { isError: true, content: [{ type: "text", text: `NOT_FOUND: ${sobject}` }] });
  srv.registerTool("query_records", { description: "Runs a SOQL SELECT query", inputSchema: { soql: z.string() } }, async ({ soql }) => {
    if (!/^\s*select\s/i.test(soql)) return { isError: true, content: [{ type: "text", text: `MALFORMED_QUERY: only SELECT is supported (${soql.slice(0, 30)})` }] };
    if (/FROM\s+Opportunity/i.test(soql)) return text({ totalSize: 3, done: true, records: [{ Id: "006A" }, { Id: "006B" }, { Id: "006C" }] });
    return text({ totalSize: 2, done: true, records: [{ Id: "001A", Name: "ACME" }, { Id: "001B", Name: "Globex" }] });
  });
  return srv;
}

export async function startUpstream() {
  const state = {
    requests: [],   // { method, path, query, headers, body }
    failNext: [],   // { pathIncludes, status, body } consommés à la première requête correspondante
    rotate: false, rotations: 0, // jetons Salesforce rafraîchis uniques quand rotate = true
    expired: new Set(), // jetons d'accès déclarés expirés : 401 systématique, quel que soit l'ordre des requêtes
  };
  let base = "";

  const json = (res, status, obj) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  };

  function handle(req, res, rawBody) {
    const u = new URL(req.url, "http://mock");
    const path = decodeURIComponent(u.pathname);
    const query = Object.fromEntries(u.searchParams);
    state.requests.push({ method: req.method, path, query, rawSearch: u.search, headers: req.headers, body: rawBody });

    const fi = state.failNext.findIndex((f) => path.includes(f.pathIncludes));
    if (fi !== -1) {
      const f = state.failNext.splice(fi, 1)[0];
      return json(res, f.status, f.body ?? [{ errorCode: "INVALID_SESSION_ID", message: "Session expired or invalid" }]);
    }

    const bearer = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (bearer && state.expired.has(bearer)) return json(res, 401, [{ errorCode: "INVALID_SESSION_ID", message: "Session expired or invalid" }]);

    // ---- Clevoa (télémétrie) ----
    if (path === "/api/v1/telemetry" && req.method === "POST") {
      if (!req.headers["x-clevoa-key"]) return json(res, 401, { status: "unauthorized" });
      return json(res, 200, { status: "active" });
    }
    // ---- OAuth2 Microsoft (Entra) ----
    if (path === "/ms/common/oauth2/v2.0/token" && req.method === "POST") {
      const p = new URLSearchParams(rawBody);
      if (p.get("grant_type") === "refresh_token") return json(res, 200, { access_token: "ms-token-refreshed", token_type: "Bearer" });
      return json(res, 200, { access_token: `ms-token-${p.get("code")}`, refresh_token: `ms-refresh-${p.get("code")}`, token_type: "Bearer" });
    }
    // ---- OAuth2 Dropbox ----
    if (path === "/oauth2/token" && req.method === "POST") {
      const p = new URLSearchParams(rawBody);
      if (p.get("grant_type") === "refresh_token") return json(res, 200, { access_token: "dbx-token-refreshed", token_type: "bearer" });
      return json(res, 200, { access_token: `dbx-token-${p.get("code")}`, refresh_token: `dbx-refresh-${p.get("code")}`, token_type: "bearer" });
    }
    // ---- Microsoft Graph (délégué : droits de l'utilisateur) ----
    if (path.startsWith("/v1.0/")) {
      if (!bearer?.startsWith("ms-token-")) return json(res, 401, { error: { code: "InvalidAuthenticationToken" } });
      const it = (id, name, folder) => ({ id, name, size: folder ? undefined : 1234, lastModifiedDateTime: "2026-10-01T08:00:00Z", webUrl: `https://sp.example/${name}`, ...(folder ? { folder: {} } : { file: {} }) });
      if (path === "/v1.0/me") return json(res, 200, { displayName: "Alice Martin", mail: "alice@example.com", userPrincipalName: "alice@example.com" });
      if (path === "/v1.0/sites") return json(res, 200, { value: [{ id: "site-finance", displayName: "Finance", webUrl: "https://sp.example/sites/Finance" }] });
      let m = path.match(/^\/v1.0\/(?:me\/drive|sites\/[^/]+\/drive)\/root(?::\/(.+):)?\/children$/);
      if (m) {
        if (m[1] === "Secret") return json(res, 403, { error: { code: "accessDenied", message: "Access denied" } });
        return json(res, 200, { value: [it("01A", "Budget 2026.xlsx", false), it("01B", "Clôtures", true), it("01C", "notes.txt", false)] });
      }
      if (/\/root\/search\(q='/.test(path)) return json(res, 200, { value: [it("01A", "Budget 2026.xlsx", false)] });
      m = path.match(/^\/v1.0\/(?:me\/drive|sites\/[^/]+\/drive)\/items\/(\w+)(\/content)?$/);
      if (m && !m[2]) return json(res, 200, m[1] === "01B" ? it("01B", "Clôtures", true) : it(m[1], m[1] === "01A" ? "Budget 2026.xlsx" : "notes.txt", false));
      if (m) { res.writeHead(302, { Location: `${base}/dl/${m[1]}` }); return res.end(); }
      return json(res, 404, { error: { code: "itemNotFound" } });
    }
    if (path.startsWith("/dl/")) { // URL de téléchargement pré-authentifiée (pas d'en-tête Authorization attendu)
      if (path === "/dl/01A") { res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }); return res.end("PK..."); }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }); return res.end("Hypothèses budget : croissance 4 %, EBITDA 12 %.");
    }
    // ---- Serveur MCP MyReport simulé (SSE) : GET /myreport/sse puis POST /myreport/messages?sessionId= ----
    if (path === "/myreport/sse" || path === "/myreport/messages") {
      if (!bearer?.startsWith("mr-token-")) return json(res, 401, { error: "invalid_token" });
      if (req.method === "GET") {
        const transport = new SSEServerTransport("/myreport/messages", res);
        sseSessions.set(transport.sessionId, transport);
        res.on("close", () => sseSessions.delete(transport.sessionId));
        return myreportMcp().connect(transport);
      }
      const t = sseSessions.get(query.sessionId);
      if (!t) return json(res, 404, { error: "session inconnue" });
      return t.handlePostMessage(req, res, JSON.parse(rawBody));
    }
    // ---- Serveur MCP Dropbox simulé (Streamable HTTP, sans état) ----
    if (path === "/dropbox-mcp") {
      if (!bearer?.startsWith("dbx-token-")) return json(res, 401, { error: "invalid_token" });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const srv = dropboxMcp();
      res.on("close", () => { transport.close(); srv.close(); });
      return srv.connect(transport).then(() => transport.handleRequest(req, res, rawBody ? JSON.parse(rawBody) : undefined));
    }

    // ---- OAuth2 Salesforce ----
    if (path === "/services/oauth2/token" && req.method === "POST") {
      const p = new URLSearchParams(rawBody);
      if (p.get("grant_type") === "refresh_token") // state.rotate : un jeton différent à chaque refresh (comme un vrai IdP)
        return json(res, 200, { access_token: state.rotate ? `sf-token-refreshed-${++state.rotations}` : "sf-token-refreshed", instance_url: base, token_type: "Bearer", issued_at: "1" });
      if (p.get("grant_type") === "authorization_code")
        return json(res, 200, { access_token: `sf-token-${p.get("code")}`, refresh_token: `sf-refresh-${p.get("code")}`, instance_url: base, token_type: "Bearer", id: `${base}/id/00D/005` });
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/services/oauth2/userinfo") {
      if (!bearer) return json(res, 401, { error: "no bearer" });
      return json(res, 200, { email: "alice@example.com", name: "Alice Martin", user_id: "005" });
    }

    // ---- OAuth2 "Entra" pour Sage X3 ----
    if (path === "/oauth/token" && req.method === "POST") {
      const p = new URLSearchParams(rawBody);
      if (p.get("grant_type") === "refresh_token")
        return json(res, 200, { access_token: "sage-token-refreshed", token_type: "Bearer" });
      if (p.get("grant_type") === "authorization_code")
        return json(res, 200, { access_token: `sage-token-${p.get("code")}`, refresh_token: `sage-refresh-${p.get("code")}`, token_type: "Bearer" });
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (path === "/oauth/userinfo") {
      if (!bearer) return json(res, 401, { error: "no bearer" });
      return json(res, 200, { email: "alice@example.com" });
    }

    // ---- Salesforce REST ----
    // ---- Salesforce : serveur MCP hébergé "SObject Reads" simulé (Streamable HTTP, sans état) ----
    if (path === "/platform/mcp/v1/d/test/platform/sobject-reads") {
      if (!bearer?.startsWith("sf-token-")) return json(res, 401, { errors: [{ message: "JWT Token is required" }] });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      const srv = sobjectReadsMcp();
      res.on("close", () => { transport.close(); srv.close(); });
      return srv.connect(transport).then(() => transport.handleRequest(req, res, rawBody ? JSON.parse(rawBody) : undefined));
    }
    // ---- Sage X3 Syracuse ----
    if (path.startsWith("/api1/x3/erp/PROD/")) {
      if (!/^(Bearer|Basic) \S+$/.test(req.headers.authorization || "")) return json(res, 401, { $diagnoses: [{ $severity: "error", $message: "no bearer" }] });
      const rest = path.slice("/api1/x3/erp/PROD/".length);
      let m = rest.match(/^\$prototypes\('(\w+)\.\$details'\)$/);
      if (m) return json(res, 200, { $properties: { [`${m[1]}_NUM`]: { $type: "application/x-string", $title: "{@42}" }, LINES: { $type: "application/x-array", $title: "{@9}" } }, $localization: { "@42": "Numéro", "@9": "Lignes" } });
      m = rest.match(/^\$prototypes\('(\w+)\.\$query'\)$/);
      if (m) {
        if (m[1] === "NOPE") return json(res, 404, { $diagnoses: [{ $severity: "error", $message: "unknown representation" }] });
        if (m[1] === "BROKEN") return json(res, 500, { $diagnoses: [{ $severity: "error", $message: "Unexpected token < in JSON at position 0" }] });
        return json(res, 200, { // format réel Syracuse : champs sous $resources.$item, libellés via $localization, champ exclu ignoré
          $properties: { $resources: { $type: "application/x-array", $item: { $properties: {
            [`${m[1]}_NUM`]: { $type: "application/x-string", $title: "{@42}" },
            AMTATI: { $type: "application/x-decimal", $title: "{@7}" },
            RBPAADDLIG1: { $type: "application/x-string", $title: "{@50490}", $isExcluded: true },
          } } } },
          $localization: { "@42": "Numéro", "@7": "Montant TTC", "@50490": "Ligne adresse 1" },
        });
      }
      m = rest.match(/^(\w+)\('(.*)'\)$/);
      if (m) {
        if (query.representation !== `${m[1]}.$details`) return json(res, 400, { $diagnoses: [{ $message: "representation attendue" }] });
        return json(res, 200, { $uuid: "u-1", $etag: 3, $url: `${base}${path}`, NUM: m[2], REP: m[1] });
      }
      m = rest.match(/^(\w+)$/);
      if (m) {
        if (query.representation !== `${m[1]}.$query`) return json(res, 400, { $diagnoses: [{ $message: "representation attendue" }] });
        return json(res, 200, { $resources: [
          { $uuid: "r-1", $url: `${base}${path}('C0001')`, BPRNUM: "C0001", BPRNAM: "ACME" },
          { $uuid: "r-2", $url: `${base}${path}('C0002')`, BPRNUM: "C0002", BPRNAM: "Globex" },
        ] });
      }
      return json(res, 404, { $diagnoses: [{ $message: `mock: ${path}` }] });
    }

    json(res, 404, { error: `mock: route inconnue ${req.method} ${path}` });
  }

  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => handle(req, res, body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;

  return {
    url: base,
    state,
    /** Requêtes dont le chemin contient `fragment` (et, optionnellement, de cette méthode). */
    requests: (fragment, method) => state.requests.filter((r) => r.path.includes(fragment) && (!method || r.method === method)),
    reset: () => { state.requests.length = 0; state.failNext.length = 0; state.expired.clear(); },
    /** Déclare un jeton d'accès expiré : toute requête qui le porte reçoit 401 (simulation d'expiration réelle). */
    expire: (token) => state.expired.add(token),
    /** La prochaine requête dont le chemin contient `pathIncludes` répondra `status`. */
    failNext: (pathIncludes, status = 401, body) => state.failNext.push({ pathIncludes, status, body }),
    stop: () => new Promise((r) => server.close(r)),
  };
}
