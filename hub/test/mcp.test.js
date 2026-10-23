// Tests boîte noire du hub MCP : transports SSE et Streamable HTTP, lecture seule, refresh de jeton,
// cache de structure par utilisateur. Le hub tourne en processus enfant, l'amont est mocké.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY } from "./helpers/hub.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOLS = ["salesforce_tools", "salesforce_call", "sagex3_representations", "sagex3_describe", "sagex3_query", "sagex3_get",
  "sharepoint_sites", "sharepoint_list", "sharepoint_search", "sharepoint_read", "dropbox_tools", "dropbox_call", "myreport_tools", "myreport_call"];
const KEY_NO_REFRESH = "test-key-bob-no-refresh-token";
const KEY_CAROL = "test-key-carol-0123456789";
const KEY_DAN = "test-key-dan-apikey-0123456789";

let up, hub;

before(async () => {
  up = await startUpstream();
  hub = await startHub({
    upstreamUrl: up.url,
    users: {
      [KEY]: connectedUser(up.url),
      [KEY_NO_REFRESH]: { createdAt: "2026-01-01T00:00:00.000Z", sagex3: { access_token: "sage-token-bob" } },
      [KEY_DAN]: { createdAt: "2026-01-01T00:00:00.000Z", sagex3: { apiKey: "syr-key-dan" } },
      [KEY_CAROL]: { createdAt: "2026-01-01T00:00:00.000Z", email: "carol@example.com",
        salesforce: { access_token: "sf-token-carol", instance_url: up.url }, sagex3: { access_token: "sage-token-carol" } },
    },
  });
});
after(async () => { await hub?.stop(); await up?.stop(); });

async function sseClient(key = KEY) {
  const client = new Client({ name: "test-sse", version: "1.0.0" });
  await client.connect(new SSEClientTransport(new URL(`${hub.url}/sse`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return client;
}
async function httpClient(key = KEY) {
  const client = new Client({ name: "test-http", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${hub.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return client;
}
const text = (r) => JSON.parse(r.content[0].text);
const sfQuery = (c, q) => c.callTool({ name: "salesforce_call", arguments: { tool: "soqlQuery", arguments: { q } } });
/** Requêtes reçues par le serveur MCP Salesforce simulé (initialize, notifications, tools/*). */
const sfCalls = (method) => up.requests("/sobject-reads", "POST").filter((r) => !method || r.body.includes(`"${method}"`));

// ---------------------------------------------------------------- 1. flux SSE / Streamable HTTP
test("SSE : listTools expose les 14 outils en lecture seule", async () => {
  const c = await sseClient();
  try {
    const { tools } = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true), "readOnlyHint attendu sur chaque outil");
    const q = tools.find((t) => t.name === "salesforce_call");
    assert.equal(q.inputSchema.properties.tool.type, "string");
  } finally { await c.close(); }
});

test("SSE : salesforce_call (serveur MCP SObject Reads) renvoie les records avec le Bearer de l'utilisateur", async () => {
  up.reset();
  const c = await sseClient();
  try {
    const r = await sfQuery(c, "SELECT Id, Name FROM Account");
    assert.equal(r.isError, undefined, r.content[0].text);
    const out = text(r);
    assert.equal(out.totalSize, 2);
    assert.deepEqual(out.records, [{ Id: "001A", Name: "ACME" }, { Id: "001B", Name: "Globex" }]);
    const calls = sfCalls("tools/call");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, "Bearer sf-token-alice");
    assert.ok(calls[0].body.includes("SELECT Id, Name FROM Account"), "la requête SOQL est transmise telle quelle");
    assert.ok(sfCalls().every((q) => q.headers.authorization === "Bearer sf-token-alice"), "jeton sur initialize et tools/call");
  } finally { await c.close(); }
});

test("SSE : sagex3_query et sagex3_get transmettent le Bearer Sage et les paramètres SData", async () => {
  up.reset();
  const c = await sseClient();
  try {
    const rows = text(await c.callTool({ name: "sagex3_query", arguments: { representation: "BPCUSTOMER", where: "(BPRNUM eq 'C0001')", orderBy: "BPRNUM desc", count: 5 } }));
    assert.deepEqual(rows, [{ BPRNUM: "C0001", BPRNAM: "ACME" }, { BPRNUM: "C0002", BPRNAM: "Globex" }], "les métadonnées $… doivent être retirées");
    const q = up.requests("/api1/x3/erp/PROD/BPCUSTOMER")[0];
    assert.equal(q.headers.authorization, "Bearer sage-token-alice");
    assert.deepEqual(q.query, { representation: "BPCUSTOMER.$query", count: "5", where: "(BPRNUM eq 'C0001')", orderBy: "BPRNUM desc" });
    assert.ok(!q.rawSearch.includes("+") && q.rawSearch.includes("%20"), `espaces codés %20, jamais + (Syracuse les refuse) : ${q.rawSearch}`);
    await c.callTool({ name: "sagex3_query", arguments: { representation: "BPCUSTOMER", where: "(ACCDAT ge '2026-01-01') and (BPR eq 'T013037')" } });
    assert.equal(up.requests("BPCUSTOMER").at(-1).query.where, "(ACCDAT ge @2026-01-01@) and (BPR eq 'T013037')", "date entre apostrophes convertie en @date@, les autres valeurs intactes");

    const one = text(await c.callTool({ name: "sagex3_get", arguments: { representation: "SINVOICE", key: "FAC-2025-000123" } }));
    assert.deepEqual(one, { NUM: "FAC-2025-000123", REP: "SINVOICE" });
    const part = text(await c.callTool({ name: "sagex3_get", arguments: { representation: "SINVOICE", key: "FAC-2025-000123", champs: ["NUM", "ABSENT"] } }));
    assert.deepEqual(part, { NUM: "FAC-2025-000123" }, "projection sur les champs demandés");
    const g = up.requests("SINVOICE('FAC-2025-000123')")[0];
    assert.ok(g, "le mock doit recevoir SINVOICE('FAC-2025-000123')");
    assert.equal(g.query.representation, "SINVOICE.$details");
    assert.equal(g.headers.authorization, "Bearer sage-token-alice");
  } finally { await c.close(); }
});

test("Streamable HTTP (/mcp, Authorization: Bearer) : listTools et callTool", async () => {
  up.reset();
  const c = await httpClient();
  try {
    const { tools } = await c.listTools();
    assert.equal(tools.length, 14);
    const out = text(await sfQuery(c, "SELECT Id FROM Account"));
    assert.equal(out.records.length, 2);
    assert.equal(sfCalls("tools/call")[0].headers.authorization, "Bearer sf-token-alice");
  } finally { await c.close(); }
});

// ---------------------------------------------------------------- 2. lecture seule / identité
test("Lecture seule : le serveur SObject Reads refuse toute requête non-SELECT ; un serveur d'écriture est refusé au démarrage du hub", async () => {
  const c = await sseClient();
  try {
    for (const soql of ["DELETE FROM Account", "UPDATE Account SET Name='x'"]) {
      const r = await sfQuery(c, soql);
      assert.equal(r.isError, true, soql); assert.match(r.content[0].text, /only SELECT/);
    }
  } finally { await c.close(); }
  await assert.rejects(startHub({ upstreamUrl: up.url, env: { SF_MCP_URL: `${up.url}/platform/mcp/v1/d/test/platform/sobject-all` } }), /serveur d'écriture/);
});

test("Sécurité : la clé en paramètre d'URL (?key=) est refusée, seul l'en-tête Authorization: Bearer est accepté", async () => {
  assert.equal((await fetch(`${hub.url}/sse?key=${KEY}`, { headers: { Accept: "text/event-stream" } })).status, 401);
  assert.equal((await fetch(`${hub.url}/mcp?key=${KEY}`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" })).status, 401);
  const r = await fetch(`${hub.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.notEqual(r.status, 401);
});

test("Clé MCP inconnue : 401 sur /sse et /mcp ; session SSE inconnue : 404 sur /messages", async () => {
  const sse = await fetch(`${hub.url}/sse?key=nope`);
  assert.equal(sse.status, 401);
  assert.match((await sse.json()).error, /Clé MCP inconnue/);

  const mcp = await fetch(`${hub.url}/mcp`, { method: "POST", headers: { Authorization: "Bearer nope", "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(mcp.status, 401);

  const noKey = await fetch(`${hub.url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(noKey.status, 401);

  const msg = await fetch(`${hub.url}/messages?sessionId=inconnue`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(msg.status, 404);

  await assert.rejects(sseClient("nope"), /401/);
});

test("GET /mcp renvoie 405 (mode sans état)", async () => {
  const r = await fetch(`${hub.url}/mcp`);
  assert.equal(r.status, 405);
});

// ---------------------------------------------------------------- 4. cache nocturne (construit au démarrage)
test("Cache : la structure est chargée au premier appel avec le jeton de l'utilisateur, puis servie sans rappeler le mock", async () => {
  up.reset();
  const c = await sseClient();
  try {
    const sfInfo = text(await c.callTool({ name: "salesforce_tools", arguments: {} }));
    assert.equal(sfInfo.instance, up.url, "l'instance Salesforce interrogée est visible du modèle");
    const tools = sfInfo.outils;
    assert.deepEqual(tools.map((t) => t.name), ["getUserInfo", "getObjectSchema", "soqlQuery"]);
    assert.ok(sfCalls("tools/list").length === 1 && sfCalls().every((r) => r.headers.authorization === "Bearer sf-token-alice"));
    up.reset();
    assert.equal(text(await c.callTool({ name: "salesforce_tools", arguments: {} })).outils.length, 3);
    assert.equal(sfCalls().length, 0, "liste d'outils servie depuis le cache");

    const reps = text(await c.callTool({ name: "sagex3_representations", arguments: {} }));
    assert.deepEqual(reps.representations, ["BPCUSTOMER", "SINVOICE"]);
    assert.equal(reps.dossier, "PROD"); assert.equal(reps.instance, up.url, "l'instance interrogée est visible du modèle");
    assert.ok(up.requests("$prototypes").every((r) => r.headers.authorization === "Bearer sage-token-alice"));
    up.reset();
    const sinv = text(await c.callTool({ name: "sagex3_describe", arguments: { representation: "SINVOICE" } }));
    assert.deepEqual(sinv.colonnes_liste, [
      { name: "SINVOICE_NUM", type: "string", label: "Numéro" },
      { name: "AMTATI", type: "decimal", label: "Montant TTC" },
      { name: "RBPAADDLIG1", type: "string", label: "Ligne adresse 1" },
    ]);
    assert.deepEqual(up.state.requests.map((r) => r.path), ["/api1/x3/erp/PROD/$prototypes('SINVOICE.$details')"], "colonnes servies du cache ; seule la fiche ($details) est relue");

    // Hors cache → appel direct avec le jeton de l'utilisateur
    await sfQuery(c, "SELECT Id FROM Account WHERE Name = 'X'");
    await sfQuery(c, "SELECT Id FROM Account LIMIT 5");
    const qs = sfCalls("tools/call").map((r) => JSON.parse(r.body).params.arguments.q);
    assert.deepEqual(qs.slice(-2), ["SELECT Id FROM Account WHERE Name = 'X' LIMIT 200", "SELECT Id FROM Account LIMIT 5"], "LIMIT 200 ajouté seulement quand il manque");
    sfCalls("tools/call").length; up.reset();
    const lead = text(await c.callTool({ name: "salesforce_call", arguments: { tool: "getObjectSchema", arguments: { objects: "Lead" } } }));
    assert.deepEqual(lead.objects[0].fields[2], { name: "OwnerId", type: "reference", label: "Propriétaire", ref: ["User"] });
    assert.equal(sfCalls("tools/call").length, 1);
    const porder = text(await c.callTool({ name: "sagex3_describe", arguments: { representation: "PORDER" } }));
    assert.equal(porder.colonnes_liste[0].name, "PORDER_NUM");
    assert.deepEqual(porder.champs_fiche.map((f) => f.name), ["PORDER_NUM", "LINES.ITMREF"], "facette details lue en direct, bloc déplié");
    assert.equal(up.requests("$prototypes('PORDER.$details')").length, 1);
    assert.equal(up.requests("$prototypes('PORDER.$query')").length, 1);
  } finally { await c.close(); }
});

test("Cache : par utilisateur — Bob ne réutilise pas la structure d'Alice, il charge la sienne avec son jeton", async () => {
  up.reset();
  const c = await sseClient(KEY_NO_REFRESH);
  try {
    const reps = text(await c.callTool({ name: "sagex3_representations", arguments: {} }));
    assert.deepEqual(reps.representations, ["BPCUSTOMER", "SINVOICE"]);
    const calls = up.requests("$prototypes");
    assert.ok(calls.length > 0 && calls.every((r) => r.headers.authorization === "Bearer sage-token-bob"));
    const sf = await c.callTool({ name: "salesforce_tools", arguments: {} });
    assert.equal(sf.isError, true, "Bob n'est pas connecté à Salesforce : pas de structure empruntée");
  } finally { await c.close(); }
});

test("Lecture seule : noms d'objet / représentation / clé invalides sont rejetés avant tout appel amont", async () => {
  up.reset();
  const c = await sseClient();
  try {
    for (const [name, args] of [
      ["sagex3_describe", { representation: "../../syracuse-main/html/main.html" }],
      ["sagex3_query", { representation: "BPCUSTOMER;rm" }],
    ]) {
      const r = await c.callTool({ name, arguments: args });
      assert.equal(r.isError, true, name);
    }
    const g = text(await c.callTool({ name: "sagex3_get", arguments: { representation: "SINVOICE", key: "X')/../../OTHER/SINVOICE('Y" } }));
    assert.ok(g.NUM, "clé encodée, reste dans le dossier");
    assert.ok(up.state.requests.every((r) => r.path.startsWith("/api1/x3/erp/PROD/SINVOICE(")), JSON.stringify(up.state.requests.map((r) => r.path)));
  } finally { await c.close(); }
});

// ---------------------------------------------------------------- cloisonnement des identités
test("Cloisonnement : chaque appel amont porte le jeton personnel de l'appelant, jamais celui d'un autre ni un jeton de service", async () => {
  up.reset();
  const alice = await sseClient(KEY), carol = await httpClient(KEY_CAROL);
  try {
    const args = [["salesforce_call", { tool: "soqlQuery", arguments: { q: "SELECT Id FROM Account" } }], ["salesforce_call", { tool: "getObjectSchema", arguments: { objects: "Lead" } }], ["sagex3_query", { representation: "BPCUSTOMER" }], ["sagex3_describe", { representation: "PORDER" }]];
    for (const [name, a] of args) {
      assert.equal((await alice.callTool({ name, arguments: a })).isError, undefined, `alice ${name}`);
      assert.equal((await carol.callTool({ name, arguments: a })).isError, undefined, `carol ${name}`);
    }
    const bearers = new Set(up.state.requests.map((r) => r.headers.authorization));
    assert.deepEqual([...bearers].sort(), ["Bearer sage-token-alice", "Bearer sage-token-carol", "Bearer sf-token-alice", "Bearer sf-token-carol"], "seuls les jetons des deux appelants circulent");
    assert.equal(up.requests("/oauth", "POST").length + up.requests("/services/oauth2/token", "POST").length, 0, "aucun échange OAuth déclenché");

    // users.json ne contient que des jetons individuels, rangés sous la clé de leur propriétaire
    const users = hub.readUsers();
    assert.equal(users[KEY].salesforce.access_token, "sf-token-alice");
    assert.equal(users[KEY_CAROL].salesforce.access_token, "sf-token-carol");
    const raw = JSON.parse(readFileSync(join(hub.dataDir, "users.json"), "utf8"));
    assert.deepEqual(Object.keys(raw), ["users"], "aucun jeton global hors de users.{clé}");
  } finally { await alice.close(); await carol.close(); }
});

test("Clé d'API Syracuse : les outils MCP l'envoient en Bearer, et un 401 ne déclenche aucun refresh OAuth", async () => {
  up.reset();
  const c = await sseClient(KEY_DAN);
  try {
    const rows = text(await c.callTool({ name: "sagex3_query", arguments: { representation: "BPCUSTOMER" } }));
    assert.equal(rows.length, 2);
    assert.equal(up.requests("/api1/x3/erp/PROD/BPCUSTOMER")[0].headers.authorization, "Bearer syr-key-dan");
    up.failNext("/api1/x3/erp/PROD/BPCUSTOMER", 401);
    const r = await c.callTool({ name: "sagex3_query", arguments: { representation: "BPCUSTOMER" } });
    assert.equal(r.isError, true);
    assert.equal(up.requests("/oauth/token").length, 0);
  } finally { await c.close(); }
});

// ---------------------------------------------------------------- 3. refresh de jeton
test("Refresh : sur 401 amont, le hub appelle /services/oauth2/token (refresh_token) puis réussit avec le nouveau jeton", async () => {
  up.reset();
  up.failNext("/sobject-reads", 401);
  const c = await sseClient();
  try {
    const out = text(await sfQuery(c, "SELECT Id FROM Account"));
    assert.equal(out.records.length, 2);

    const sf = sfCalls();
    assert.equal(sf[0].headers.authorization, "Bearer sf-token-alice", "premier essai avec l'ancien jeton (401)");
    assert.ok(sf.slice(1).every((q) => q.headers.authorization === "Bearer sf-token-refreshed"), "nouvelle session avec le jeton rafraîchi");

    const tok = up.requests("/services/oauth2/token", "POST");
    assert.equal(tok.length, 1);
    assert.equal(tok[0].headers["content-type"], "application/x-www-form-urlencoded");
    const body = Object.fromEntries(new URLSearchParams(tok[0].body));
    assert.deepEqual(body, { grant_type: "refresh_token", refresh_token: "sf-refresh-alice", client_id: "sf-client-id", client_secret: "sf-client-secret" });

    // Ordre : sobject-reads (401) → token → sobject-reads (200)
    const order = up.state.requests.map((r) => r.path);
    assert.ok(order.indexOf("/services/oauth2/token") > order.indexOf("/platform/mcp/v1/d/test/platform/sobject-reads"));

    // Le nouveau jeton est persisté, le refresh_token conservé
    const u = hub.readUsers()[KEY];
    assert.equal(u.salesforce.access_token, "sf-token-refreshed");
    assert.equal(u.salesforce.refresh_token, "sf-refresh-alice");

    // L'appel suivant utilise directement le jeton rafraîchi
    up.reset();
    await sfQuery(c, "SELECT Id FROM Account");
    assert.ok(sfCalls().every((q) => q.headers.authorization === "Bearer sf-token-refreshed"));
    assert.equal(up.requests("/services/oauth2/token").length, 0);
  } finally { await c.close(); }
});

test("Refresh : sans refresh_token, le 401 amont remonte en isError sans appel au serveur OAuth", async () => {
  up.reset();
  up.failNext("/api1/x3/erp/PROD/BPCUSTOMER", 401);
  const c = await sseClient(KEY_NO_REFRESH);
  try {
    const r = await c.callTool({ name: "sagex3_query", arguments: { representation: "BPCUSTOMER" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Sage X3 401/);
    assert.equal(up.requests("/oauth/token").length, 0);

    const sf = await sfQuery(c, "SELECT Id FROM Account");
    assert.equal(sf.isError, true);
    assert.match(sf.content[0].text, /Non connecté à Salesforce/);
  } finally { await c.close(); }
});

test("Refresh : un 401 persistant après refresh remonte en isError", async () => {
  up.reset();
  up.failNext("/sobject-reads", 401);
  up.failNext("/sobject-reads", 401);
  const c = await sseClient();
  try {
    const r = await sfQuery(c, "SELECT Id FROM Account");
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Salesforce MCP/);
    assert.equal(up.requests("/services/oauth2/token").length, 1, "un seul refresh, pas de boucle");
  } finally { await c.close(); }
});

test("Sécurité : users.json est chiffré sur le disque (AES-256-GCM), jamais en clair, et reste lisible par le hub", async () => {
  const raw = hub.rawStore(); // écrit par les refreshs de jeton des tests précédents
  assert.ok(raw.startsWith("enc1:"), "format chiffré");
  assert.ok(!raw.includes("sf-token") && !raw.includes("alice") && !raw.includes("{"), "aucun jeton ni email en clair");
  assert.equal(hub.readUsers()[KEY].salesforce.access_token, "sf-token-refreshed", "contenu déchiffrable avec ENCRYPTION_KEY");
});

// ---------------------------------------------------------------- refresh concurrent et révocation
test("Refresh partagé : 3 appels parallèles après expiration ne déclenchent qu'un seul échange refresh_token", async () => {
  up.reset(); up.state.rotate = true; // chaque refresh donne un jeton différent, comme un vrai IdP
  up.expire(hub.readUsers()[KEY].salesforce.access_token); // le jeton courant d'Alice est expiré, quel que soit l'ordre des requêtes
  const c = await sseClient();
  try {
    const rs = await Promise.all([1, 2, 3].map(() => sfQuery(c, "SELECT Id FROM Account")));
    assert.ok(rs.every((r) => r.isError === undefined), rs.map((r) => r.content[0].text).join(" | "));
    assert.equal(up.requests("/services/oauth2/token", "POST").length, 1, "un seul refresh pour trois appels concurrents");
    assert.equal(hub.readUsers()[KEY].salesforce.access_token, "sf-token-refreshed-1");
  } finally { up.state.rotate = false; await c.close(); }
});

test("Refresh token révoqué : message clair, jetons effacés, portail repassé à « non connecté »", async () => {
  up.reset();
  up.failNext("/sobject-reads", 401);
  up.failNext("/services/oauth2/token", 400, { error: "invalid_grant", error_description: "expired access/refresh token" });
  const c = await sseClient();
  try {
    const r = await sfQuery(c, "SELECT Id FROM Account");
    assert.equal(r.isError, true); assert.match(r.content[0].text, /Session Salesforce expirée ou révoquée : reconnectez-vous/);
    assert.equal(hub.readUsers()[KEY].salesforce, undefined, "entrée Salesforce effacée");
    const again = await sfQuery(c, "SELECT Id FROM Account");
    assert.match(again.content[0].text, /Non connecté à Salesforce/);
    const me = await fetch(`${hub.url}/api/me`, { headers: { cookie: `mcp_key=${KEY}` } }).then((x) => x.json());
    assert.equal(me.systems[0].connected, false, "voyant rouge, plus vert");
  } finally { await c.close(); }
});

test("Traçabilité : chaque résultat d'outil se termine par une ligne « Source : … » (système, et dossier pour Sage X3)", async () => {
  const c = await sseClient();
  try {
    const r = await c.callTool({ name: "sagex3_query", arguments: { representation: "BPCUSTOMER", where: "(BPCNUM eq 'C0001')" } });
    assert.equal(r.content.length, 2);
    assert.doesNotThrow(() => JSON.parse(r.content[0].text), "les données restent en premier, inchangées");
    const src = r.content[1].text;
    assert.equal(src, "Source : Sage X3 · dossier PROD");
    assert.ok(!/Bearer|sage-token|http|alice|C0001/.test(src), "ni jeton, ni adresse, ni compte, ni paramètres dans la source");
    const sf = await sfQuery(c, "SELECT Id FROM Account LIMIT 1"); // alice a pu être déconnectée de Salesforce par un test précédent
    if (!sf.isError) assert.equal(sf.content.at(-1).text, "Source : Salesforce · production", "le mock n'est pas une sandbox");
    else assert.equal(sf.content.length, 1, "une erreur ne porte pas de ligne Source");
  } finally { await c.close(); }
});

test("Traçabilité Salesforce : une URL de connexion sandbox donne « sandbox <nom> », sinon « production »", async () => {
  process.env.SF_LOGIN_URL = "https://charloisgroup--preprod.sandbox.my.salesforce.com";
  const { source } = await import(`../connectors/salesforce.js?${Date.now()}`);
  assert.equal(source(), "sandbox preprod");
});
