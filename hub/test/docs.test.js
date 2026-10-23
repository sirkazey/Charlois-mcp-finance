// Connecteurs documentaires : SharePoint (Microsoft Graph délégué) et Dropbox (proxy vers le serveur MCP officiel).
// Vérifie le passage du jeton de l'utilisateur, le respect de ses droits (403 → erreur), et la liste blanche lecture seule.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY } from "./helpers/hub.js";

let up, hub, c;
before(async () => {
  up = await startUpstream();
  hub = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) } });
  c = new Client({ name: "test-docs", version: "1.0.0" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${hub.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } }));
});
after(async () => { await c?.close(); await hub?.stop(); await up?.stop(); });
const text = (r) => JSON.parse(r.content[0].text);

test("SharePoint : list / search / read avec le Bearer Graph de l'utilisateur ; un dossier interdit remonte le 403 de Graph", async () => {
  up.reset();
  const items = text(await c.callTool({ name: "sharepoint_list", arguments: { path: "Finance/2026" } }));
  assert.deepEqual(items.map((i) => [i.name, i.type]), [["Budget 2026.xlsx", "fichier"], ["Clôtures", "dossier"], ["notes.txt", "fichier"]]);
  const q = up.requests("/children")[0];
  assert.equal(q.path, "/v1.0/me/drive/root:/Finance/2026:/children");
  assert.equal(q.headers.authorization, "Bearer ms-token-alice");

  const onSite = text(await c.callTool({ name: "sharepoint_list", arguments: { path: "", site: "site-finance" } }));
  assert.equal(up.requests("/sites/site-finance/drive/root/children").length, 1); assert.equal(onSite.length, 3);

  const forbidden = await c.callTool({ name: "sharepoint_list", arguments: { path: "Secret" } });
  assert.equal(forbidden.isError, true); assert.match(forbidden.content[0].text, /SharePoint 403/);

  const found = text(await c.callTool({ name: "sharepoint_search", arguments: { query: "budget 2026" } }));
  assert.equal(found[0].id, "01A");
  assert.equal(up.requests("/root/search(q='budget 2026')").length, 1, up.state.requests.map((r) => r.path).join());

  const txt = text(await c.callTool({ name: "sharepoint_read", arguments: { itemId: "01C" } }));
  assert.match(txt.text, /EBITDA 12 %/);
  assert.equal(up.requests("/dl/01C")[0].headers.authorization, undefined, "l'URL pré-authentifiée ne reçoit pas le jeton");
  const evil = await c.callTool({ name: "sharepoint_read", arguments: { itemId: "EVIL" } });
  assert.equal(evil.isError, true); assert.match(evil.content[0].text, /redirection de téléchargement refusée vers evil\.example\.invalid/);
  assert.equal(up.requests("/steal").length, 0, "le hub ne suit jamais une redirection vers un hôte inattendu");
  const bin = text(await c.callTool({ name: "sharepoint_read", arguments: { itemId: "01A" } }));
  assert.match(bin.note, /Binaire/); assert.equal(bin.text, undefined);
  const dir = await c.callTool({ name: "sharepoint_read", arguments: { itemId: "01B" } });
  assert.equal(dir.isError, true);

  const sites = text(await c.callTool({ name: "sharepoint_sites", arguments: {} }));
  assert.deepEqual(sites, [{ id: "site-finance", name: "Finance", webUrl: "https://sp.example/sites/Finance" }]);
  assert.ok(up.state.requests.every((r) => r.method === "GET" || r.path.includes("/dropbox-mcp")), "Graph : uniquement des GET");
});

test("Dropbox : proxy MCP avec le Bearer de l'utilisateur, liste blanche lecture seule, droits Dropbox respectés", async () => {
  up.reset();
  const tools = text(await c.callTool({ name: "dropbox_tools", arguments: {} }));
  assert.deepEqual(tools.map((t) => t.name), ["who_am_i", "list_folder", "file_preview"], "delete est filtré");
  const img = await c.callTool({ name: "dropbox_call", arguments: { tool: "file_preview", arguments: { path: "/x.png" } } });
  assert.equal(img.content[0].type, "image", "contenu image relayé tel quel"); assert.equal(img.content[0].mimeType, "image/png");
  assert.ok(tools[1].inputSchema.properties.path, "le schéma du serveur Dropbox est transmis tel quel");
  assert.ok(up.requests("/dropbox-mcp").length > 0 && up.requests("/dropbox-mcp").every((r) => r.headers.authorization === "Bearer dbx-token-alice"));

  const entries = text(await c.callTool({ name: "dropbox_call", arguments: { tool: "list_folder", arguments: { path: "/Finance" } } }));
  assert.equal(entries[0].name, "Budget 2026.xlsx");

  const denied = await c.callTool({ name: "dropbox_call", arguments: { tool: "list_folder", arguments: { path: "/Secret" } } });
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /accès refusé/);

  up.reset();
  const del = await c.callTool({ name: "dropbox_call", arguments: { tool: "delete", arguments: { path: "/Finance" } } });
  assert.equal(del.isError, true, "outil d'écriture refusé par le schéma");
  assert.equal(up.requests("/dropbox-mcp").length, 0, "rien n'est envoyé à Dropbox pour un outil hors liste blanche");
});

test("Dropbox : un 401 du serveur MCP déclenche le refresh_token Dropbox puis un nouvel essai", async () => {
  up.reset();
  up.failNext("/dropbox-mcp", 401, { error: "expired" });
  const r = await c.callTool({ name: "dropbox_call", arguments: { tool: "who_am_i", arguments: {} } });
  assert.equal(r.isError, undefined, r.content?.[0]?.text);
  const tok = up.requests("/oauth2/token", "POST");
  assert.equal(tok.length, 1);
  assert.equal(new URLSearchParams(tok[0].body).get("refresh_token"), "dbx-refresh-alice");
  assert.ok(up.requests("/dropbox-mcp").some((q) => q.headers.authorization === "Bearer dbx-token-refreshed"));
  assert.equal(hub.readUsers()[KEY].dropbox.access_token, "dbx-token-refreshed");
});

test("MyReport : proxy MCP SSE avec le jeton personnel de l'utilisateur sur le GET et les POST ; outils d'écriture refusés avant tout appel", async () => {
  up.reset();
  const tools = text(await c.callTool({ name: "myreport_tools", arguments: {} }));
  assert.deepEqual(tools.map((t) => [t.name, t.autorise]), [["liste_indicateurs", true], ["valeur_indicateur", true], ["delete_rapport", false]], "liste blanche MYREPORT_TOOLS");
  const calls = up.requests("/myreport/");
  assert.ok(calls.some((r) => r.method === "GET" && r.path === "/myreport/sse") && calls.some((r) => r.method === "POST"));
  assert.ok(calls.every((r) => r.headers.authorization === "Bearer mr-token-alice"), "jeton sur le flux SSE et sur chaque message");

  const v = text(await c.callTool({ name: "myreport_call", arguments: { tool: "valeur_indicateur", arguments: { code: "CA_HT" } } }));
  assert.deepEqual(v, { code: "CA_HT", valeur: 42 });

  up.reset();
  const del = await c.callTool({ name: "myreport_call", arguments: { tool: "delete_rapport", arguments: { id: "1" } } });
  assert.equal(del.isError, true); assert.match(del.content[0].text, /liste blanche MYREPORT_TOOLS/);
  assert.equal(up.requests("/myreport/").length, 0, "rien n'est transféré pour un outil hors liste blanche");
  const hubNoList = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { MYREPORT_TOOLS: "" } });
  try {
    const r = await fetch(`${hubNoList.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "myreport_call", arguments: { tool: "liste_indicateurs" } } }) }).then((x) => x.text());
    assert.match(r, /liste blanche MYREPORT_TOOLS/, "sans liste blanche, aucun transfert");
  } finally { await hubNoList.stop(); }

  const ko = await c.callTool({ name: "myreport_call", arguments: { tool: "valeur_indicateur", arguments: {} } });
  assert.equal(ko.isError, true, "erreur distante (argument manquant) remontée telle quelle");
});

test("MyReport : sans MYREPORT_MCP_URL, simulateur local (tests Docker Desktop) sans jeton ni réseau", { skip: process.env.APP_ENV === "production" && "en production un connecteur non configuré n'est pas exposé" }, async () => {
  up.reset();
  const sim = await startHub({ upstreamUrl: up.url, env: { MYREPORT_MCP_URL: "" } });
  try {
    const cookie = `mcp_key=${(await fetch(`${sim.url}/api/me`).then((x) => x.json())).key}`;
    const d = await fetch(`${sim.url}/api/test/myreport`, { headers: { cookie } }).then((x) => x.json());
    assert.equal(d.ok, true, JSON.stringify(d)); assert.match(d.message, /simulé/);
    assert.deepEqual(d.tables, ["liste_indicateurs", "valeur_indicateur"]);
    const k = cookie.slice(8);
    const c2 = new Client({ name: "t", version: "1" });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`${sim.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k}` } } }));
    const v = text(await c2.callTool({ name: "myreport_call", arguments: { tool: "valeur_indicateur", arguments: { code: "TRESO" } } }));
    assert.deepEqual([v.valeur, v.simule], [904500, true], "réponse simulée marquée");
    await c2.close();
    assert.equal(up.requests("/myreport/").length, 0);
  } finally { await sim.stop(); }
});

test("MyReport : plafond d'appels sortants (MYREPORT_MAX_PER_MIN) tous utilisateurs confondus, sans toucher au serveur au-delà", async () => {
  const capped = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { MYREPORT_MAX_PER_MIN: "2" } });
  try {
    const c2 = new Client({ name: "t", version: "1" });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`${capped.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } }));
    up.reset();
    const rs = [];
    for (let i = 0; i < 3; i++) rs.push(await c2.callTool({ name: "myreport_call", arguments: { tool: "liste_indicateurs", arguments: {} } }));
    assert.deepEqual(rs.map((r) => r.isError ?? false), [false, false, true]);
    assert.match(rs[2].content[0].text, /plafond de 2 appels par minute/);
    const sse = up.requests("/myreport/sse", "GET").length;
    assert.equal(sse, 2, "le troisième appel n'a ouvert aucune session vers MyReport");
    await c2.close();
  } finally { await capped.stop(); }
});

test("Plafond MyReport : une variable vide (Compose) garde le défaut 20 ; le diagnostic du portail est compté dans le plafond", async () => {
  const capped = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { MYREPORT_MAX_PER_MIN: "" } });
  try {
    const { maxPerMinute } = await import(`../connectors/myreport.js?${Date.now()}`); // même lecture d'environnement que le hub enfant
    assert.equal(maxPerMinute, 20, "chaîne vide → défaut, pas 0 (illimité)");
    const cookie = `mcp_key=${KEY}`;
    const c2 = new Client({ name: "t", version: "1" });
    await c2.connect(new StreamableHTTPClientTransport(new URL(`${capped.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${KEY}` } } }));
    for (let i = 0; i < 20; i++) await c2.callTool({ name: "myreport_call", arguments: { tool: "liste_indicateurs", arguments: {} } });
    const d = await fetch(`${capped.url}/api/test/myreport`, { headers: { cookie } }).then((x) => x.json());
    assert.equal(d.ok, false); assert.match(d.error, /plafond de 20 appels par minute/, "le 21e appel, via le diagnostic, est refusé");
    await c2.close();
  } finally { await capped.stop(); }
});
