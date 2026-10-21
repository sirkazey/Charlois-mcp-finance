// Tests boîte noire du hub MCP : transports SSE et Streamable HTTP, lecture seule, refresh de jeton,
// cache de structure par utilisateur. Le hub tourne en processus enfant, l'amont est mocké.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startUpstream, SF_V } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY } from "./helpers/hub.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOOLS = ["salesforce_objects", "salesforce_describe", "salesforce_query", "sagex3_representations", "sagex3_describe", "sagex3_query", "sagex3_get",
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
  await client.connect(new SSEClientTransport(new URL(`${hub.url}/sse?key=${key}`)));
  return client;
}
async function httpClient(key = KEY) {
  const client = new Client({ name: "test-http", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${hub.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return client;
}
const text = (r) => JSON.parse(r.content[0].text);

// ---------------------------------------------------------------- 1. flux SSE / Streamable HTTP
test("SSE : listTools expose les 15 outils en lecture seule", async () => {
  const c = await sseClient();
  try {
    const { tools } = await c.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [...TOOLS].sort());
    assert.ok(tools.every((t) => t.annotations?.readOnlyHint === true), "readOnlyHint attendu sur chaque outil");
    const q = tools.find((t) => t.name === "salesforce_query");
    assert.equal(q.inputSchema.properties.soql.type, "string");
  } finally { await c.close(); }
});

test("SSE : salesforce_query renvoie les records du mock avec le Bearer de l'utilisateur", async () => {
  up.reset();
  const c = await sseClient();
  try {
    const r = await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id, Name FROM Account" } });
    assert.equal(r.isError, undefined);
    const out = text(r);
    assert.equal(out.totalSize, 2);
    assert.equal(out.done, true);
    assert.deepEqual(out.records, [{ Id: "001A", Name: "ACME" }, { Id: "001B", Name: "Globex" }], "attributes doit être retiré");
    const calls = up.requests(`/services/data/${SF_V}/query`, "GET");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers.authorization, "Bearer sf-token-alice");
    assert.equal(calls[0].query.q, "SELECT Id, Name FROM Account");
  } finally { await c.close(); }
});

test("SSE : salesforce_query renvoie la première page seulement (done=false, pas de pagination)", async () => {
  up.reset();
  const c = await sseClient();
  try {
    const out = text(await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id FROM Opportunity" } }));
    assert.equal(out.totalSize, 3);
    assert.equal(out.done, false);
    assert.deepEqual(out.records.map((r) => r.Id), ["006A", "006B"]);
    assert.equal(up.requests("/query/01g-2000").length, 0, "nextRecordsUrl ne doit pas être suivi");
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

    const one = text(await c.callTool({ name: "sagex3_get", arguments: { representation: "SINVOICE", key: "FAC-2025-000123" } }));
    assert.deepEqual(one, { NUM: "FAC-2025-000123", REP: "SINVOICE" });
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
    assert.equal(tools.length, 15);
    const out = text(await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id FROM Account" } }));
    assert.equal(out.records.length, 2);
    assert.equal(up.requests("/query")[0].headers.authorization, "Bearer sf-token-alice");
  } finally { await c.close(); }
});

// ---------------------------------------------------------------- 2. lecture seule / identité
test("Lecture seule : une requête non-SELECT est refusée (isError) sans appel amont", async () => {
  up.reset();
  const c = await sseClient();
  try {
    for (const soql of ["DELETE FROM Account", "UPDATE Account SET Name='x'", "  insert into Account", "FIND {ACME} IN ALL FIELDS"]) {
      const r = await c.callTool({ name: "salesforce_query", arguments: { soql } });
      assert.equal(r.isError, true, soql);
      assert.match(r.content[0].text, /SELECT/);
    }
    assert.equal(up.requests("/services/data").length, 0, "aucun appel Salesforce ne doit partir");
  } finally { await c.close(); }
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
    const objects = text(await c.callTool({ name: "salesforce_objects", arguments: {} }));
    assert.deepEqual(objects.map((o) => o.name), ["Account", "Contact", "Opportunity", "Lead"], "seuls les objets queryable");
    assert.ok(up.requests(`/services/data/${SF_V}/sobjects`).every((r) => r.headers.authorization === "Bearer sf-token-alice"));
    assert.deepEqual(up.requests("/describe").map((r) => r.path.split("/")[5]), ["Account", "Contact", "Opportunity"], "SF_OBJECTS décrits au chargement");

    up.reset();
    const account = text(await c.callTool({ name: "salesforce_describe", arguments: { object: "Account" } }));
    assert.deepEqual(account[2], { name: "OwnerId", type: "reference", label: "Propriétaire", ref: ["User"] });
    const reps = text(await c.callTool({ name: "sagex3_representations", arguments: {} }));
    assert.deepEqual(reps, ["BPCUSTOMER", "SINVOICE"]);
    assert.ok(up.requests("$prototypes").every((r) => r.headers.authorization === "Bearer sage-token-alice"));
    up.reset();
    const sinv = text(await c.callTool({ name: "sagex3_describe", arguments: { representation: "SINVOICE" } }));
    assert.deepEqual(sinv, [
      { name: "SINVOICE_NUM", type: "application/x-string", label: "Numéro" },
      { name: "AMTATI", type: "application/x-decimal", label: "Montant TTC" },
    ]);
    assert.equal(up.state.requests.length, 0, `le mock ne doit pas être rappelé : ${JSON.stringify(up.state.requests.map((r) => r.path))}`);

    // Hors cache → appel direct avec le jeton de l'utilisateur, même forme de champs
    const lead = text(await c.callTool({ name: "salesforce_describe", arguments: { object: "Lead" } }));
    assert.deepEqual(lead[2], { name: "OwnerId", type: "reference", label: "Propriétaire", ref: ["User"] });
    assert.equal(up.requests("/sobjects/Lead/describe").length, 1);
    const porder = text(await c.callTool({ name: "sagex3_describe", arguments: { representation: "PORDER" } }));
    assert.equal(porder[0].name, "PORDER_NUM");
    assert.equal(up.requests("$prototypes('PORDER.$query')").length, 1);
  } finally { await c.close(); }
});

test("Cache : par utilisateur — Bob ne réutilise pas la structure d'Alice, il charge la sienne avec son jeton", async () => {
  up.reset();
  const c = await sseClient(KEY_NO_REFRESH);
  try {
    const reps = text(await c.callTool({ name: "sagex3_representations", arguments: {} }));
    assert.deepEqual(reps, ["BPCUSTOMER", "SINVOICE"]);
    const calls = up.requests("$prototypes");
    assert.ok(calls.length > 0 && calls.every((r) => r.headers.authorization === "Bearer sage-token-bob"));
    const sf = await c.callTool({ name: "salesforce_objects", arguments: {} });
    assert.equal(sf.isError, true, "Bob n'est pas connecté à Salesforce : pas de structure empruntée");
  } finally { await c.close(); }
});

test("Lecture seule : noms d'objet / représentation / clé invalides sont rejetés avant tout appel amont", async () => {
  up.reset();
  const c = await sseClient();
  try {
    for (const [name, args] of [
      ["salesforce_describe", { object: "../../../apexrest/MonService/x" }],
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
    const args = [["salesforce_query", { soql: "SELECT Id FROM Account" }], ["salesforce_describe", { object: "Lead" }], ["sagex3_query", { representation: "BPCUSTOMER" }], ["sagex3_describe", { representation: "PORDER" }]];
    for (const [name, a] of args) {
      assert.equal((await alice.callTool({ name, arguments: a })).isError, undefined, `alice ${name}`);
      assert.equal((await carol.callTool({ name, arguments: a })).isError, undefined, `carol ${name}`);
    }
    const bearers = new Set(up.state.requests.map((r) => r.headers.authorization));
    assert.deepEqual([...bearers].sort(), ["Bearer sage-token-alice", "Bearer sage-token-carol", "Bearer sf-token-alice", "Bearer sf-token-carol"], "seuls les jetons des deux appelants circulent");
    assert.equal(up.requests("/", "POST").length, 0, "aucune écriture, aucun échange OAuth déclenché");

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
  up.failNext(`/services/data/${SF_V}/query`, 401);
  const c = await sseClient();
  try {
    const out = text(await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id FROM Account" } }));
    assert.equal(out.records.length, 2);

    const queries = up.requests(`/services/data/${SF_V}/query`, "GET");
    assert.equal(queries.length, 2, "premier appel (401) puis nouvel essai");
    assert.equal(queries[0].headers.authorization, "Bearer sf-token-alice");
    assert.equal(queries[1].headers.authorization, "Bearer sf-token-refreshed");

    const tok = up.requests("/services/oauth2/token", "POST");
    assert.equal(tok.length, 1);
    assert.equal(tok[0].headers["content-type"], "application/x-www-form-urlencoded");
    const body = Object.fromEntries(new URLSearchParams(tok[0].body));
    assert.deepEqual(body, { grant_type: "refresh_token", refresh_token: "sf-refresh-alice", client_id: "sf-client-id", client_secret: "sf-client-secret" });

    // Ordre : query (401) → token → query (200)
    const order = up.state.requests.map((r) => r.path);
    assert.ok(order.indexOf("/services/oauth2/token") > order.indexOf(`/services/data/${SF_V}/query`));

    // Le nouveau jeton est persisté, le refresh_token conservé
    const u = hub.readUsers()[KEY];
    assert.equal(u.salesforce.access_token, "sf-token-refreshed");
    assert.equal(u.salesforce.refresh_token, "sf-refresh-alice");
    assert.equal(u.salesforce.instance_url, up.url);

    // L'appel suivant utilise directement le jeton rafraîchi
    up.reset();
    await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id FROM Account" } });
    assert.equal(up.requests("/query")[0].headers.authorization, "Bearer sf-token-refreshed");
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

    const sf = await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id FROM Account" } });
    assert.equal(sf.isError, true);
    assert.match(sf.content[0].text, /Non connecté à Salesforce/);
  } finally { await c.close(); }
});

test("Refresh : un 401 persistant après refresh remonte en isError", async () => {
  up.reset();
  up.failNext(`/services/data/${SF_V}/query`, 401);
  up.failNext(`/services/data/${SF_V}/query`, 401);
  const c = await sseClient();
  try {
    const r = await c.callTool({ name: "salesforce_query", arguments: { soql: "SELECT Id FROM Account" } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Salesforce 401/);
    assert.equal(up.requests("/services/oauth2/token").length, 1, "un seul refresh, pas de boucle");
  } finally { await c.close(); }
});
