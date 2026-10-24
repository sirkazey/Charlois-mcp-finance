// Compatibilité MCP, au niveau du protocole brut (JSON-RPC sur HTTP), indépendamment du client du SDK : négociation de version
// pour chaque révision supportée, identité et consignes du serveur, schémas et annotations des outils, erreurs propres,
// reconnexion SSE, corps invalides sans erreur 500.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { SUPPORTED_PROTOCOL_VERSIONS, LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY } from "./helpers/hub.js";
import { VERSION } from "../version.js";

let up, hub;
before(async () => {
  up = await startUpstream();
  hub = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { MCP_SERVER_NAME: "client-test" } });
});
after(async () => { await hub?.stop(); await up?.stop(); });

/** Un échange JSON-RPC brut sur /mcp, comme le ferait n'importe quel client MCP HTTP. Renvoie { status, body }. */
async function rpc(message, { key = KEY, raw } = {}) {
  const r = await fetch(`${hub.url}/mcp`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: raw ?? JSON.stringify(message),
  });
  const text = await r.text();
  const data = text.split("\n").find((l) => l.startsWith("data: ")); // réponse en flux SSE d'un seul événement
  let body = null;
  try { body = JSON.parse(data ? data.slice(6) : text); } catch { /* corps non JSON */ }
  return { status: r.status, body };
}
const init = (protocolVersion) => rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion, capabilities: {}, clientInfo: { name: "compat", version: "1.0.0" } } });

test("Négociation : chaque révision du protocole supportée par le SDK est acceptée telle quelle", async () => {
  assert.ok(SUPPORTED_PROTOCOL_VERSIONS.includes("2024-11-05") && SUPPORTED_PROTOCOL_VERSIONS.includes("2025-06-18"));
  for (const v of SUPPORTED_PROTOCOL_VERSIONS) {
    const { status, body } = await init(v);
    assert.equal(status, 200, v);
    assert.equal(body.result.protocolVersion, v, `révision ${v} conservée`);
  }
});

test("Négociation : une révision inconnue reçoit la plus récente du serveur (le client décide s'il continue)", async () => {
  const { body } = await init("2099-01-01");
  assert.equal(body.result.protocolVersion, LATEST_PROTOCOL_VERSION);
});

test("Identité : nom d'instance, version du hub, capacité outils, consignes de citation de la source", async () => {
  const { body } = await init(LATEST_PROTOCOL_VERSION);
  assert.deepEqual(body.result.serverInfo, { name: "client-test", version: VERSION });
  assert.ok(body.result.capabilities.tools);
  assert.match(body.result.instructions, /LECTURE SEULE/);
  assert.match(body.result.instructions, /Source : …/);
});

test("Outils : schéma d'entrée objet, description, annotation readOnlyHint sur chacun", async () => {
  const { body } = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tools = body.result.tools;
  assert.equal(tools.length, 14);
  for (const t of tools) {
    assert.match(t.name, /^[a-z0-9_]{1,64}$/, t.name);
    assert.ok(t.description?.length > 20, `${t.name} : description`);
    assert.equal(t.inputSchema.type, "object", `${t.name} : schéma objet`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name} : lecture seule annoncée`);
  }
});

test("Erreurs : outil inconnu, arguments invalides, méthode inconnue → erreur JSON-RPC ou isError, jamais une erreur 500", async () => {
  const unknown = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "outil_inexistant", arguments: {} } });
  assert.equal(unknown.status, 200);
  assert.ok(unknown.body.error || unknown.body.result?.isError, JSON.stringify(unknown.body));
  const badArgs = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "sagex3_query", arguments: { representation: 42 } } });
  assert.ok(badArgs.body.error || badArgs.body.result?.isError, "arguments hors schéma refusés");
  const method = await rpc({ jsonrpc: "2.0", id: 5, method: "resources/write", params: {} });
  assert.equal(method.body.error?.code, -32601, "méthode inconnue");
});

test("Corps invalides : JSON mal formé, message non JSON-RPC → 4xx, le hub continue de répondre", async () => {
  const broken = await rpc(null, { raw: "{pas du json" });
  assert.ok(broken.status >= 400 && broken.status < 500, `JSON mal formé : ${broken.status}`);
  const notRpc = await rpc({ bonjour: "monde" });
  assert.ok(notRpc.status >= 400 && notRpc.status < 500, `message non JSON-RPC : ${notRpc.status}`);
  assert.equal((await fetch(`${hub.url}/health`)).status, 200);
});

test("Reconnexion SSE : un client qui ferme puis rouvre sa session avec la même clé retrouve ses outils", async () => {
  for (let i = 0; i < 3; i++) {
    const c = new Client({ name: "reconnexion", version: "1.0.0" });
    await c.connect(new SSEClientTransport(new URL(`${hub.url}/sse`), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } }));
    assert.equal((await c.listTools()).tools.length, 14, `connexion ${i + 1}`);
    await c.close();
  }
});

test("Journaux détaillés (LOG_LEVEL=debug) : nom de l'outil et durée seulement ; ni arguments, ni résultats, ni clé, ni jeton", async () => {
  const dbg = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { LOG_LEVEL: "debug" } });
  try {
    const call = (name, args) => fetch(`${dbg.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name, arguments: args } }) }).then((r) => r.text());
    const ok = await call("sagex3_query", { representation: "BPCUSTOMER", where: "BPCNAM eq 'ARGUMENT-SECRET-42'" });
    await call("salesforce_call", { tool: "soqlQuery", arguments: { q: "SELECT Id FROM Account WHERE Name = 'ARGUMENT-SECRET-43'" } });
    const logs = dbg.logs();
    assert.match(logs, /\[debug\] sagex3_query (ok|erreur)/, "l'appel est tracé");
    for (const s of ["ARGUMENT-SECRET-42", "ARGUMENT-SECRET-43", KEY, "sage-token-alice", "sf-token-alice", "alice@example.com"]) assert.ok(!logs.includes(s), `fuite dans les journaux : ${s}`);
    assert.ok(ok.length > 0);
  } finally { await dbg.stop(); }
});
