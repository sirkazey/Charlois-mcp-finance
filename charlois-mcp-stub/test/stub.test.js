// Interconnexion complète : le vrai hub (processus enfant) branché sur le bouchon (processus enfant), flux OAuth via les
// mires, outils MCP sur le jeu de données canin, droits différents entre Marie (DAF) et Paul (commercial), télémétrie.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startHub, freePort } from "../../hub/test/helpers/hub.js";

const STUB = new URL("../server.js", import.meta.url).pathname;
let stub, stubUrl, hub, marie, paul;
const noFollow = { redirect: "manual" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Joue un flux OAuth complet dans le hub via la mire du bouchon, pour un collaborateur donné. */
async function connect(cookie, system, user) {
  const r = await fetch(`${hub.url}/auth/${system}`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 302, `${system}: redirection vers la mire`);
  const mire = await fetch(r.headers.get("location")).then((x) => x.text());
  const link = [...mire.matchAll(/href="(\/_stub\/approve\?[^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")).find((l) => l.includes(encodeURIComponent(user)));
  assert.ok(link, `${system}: ${user} proposé sur la mire`);
  const back = await fetch(`${stubUrl}${link}`, noFollow); // le bouchon renvoie vers le callback du hub avec un code
  const cb = await fetch(back.headers.get("location"), { headers: { cookie }, ...noFollow });
  assert.equal(cb.status, 302, `${system}: callback ${await cb.text()}`);
}
async function portalUser() {
  const me = await fetch(`${hub.url}/api/me`).then((x) => x.json());
  const cookie = `mcp_key=${me.key}`;
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${hub.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${me.key}` } } }));
  return { key: me.key, cookie, mcp: c };
}
const text = (r) => JSON.parse(r.content[0].text);
const diag = (u, sys) => fetch(`${hub.url}/api/test/${sys}`, { headers: { cookie: u.cookie } }).then((x) => x.json());

before(async () => {
  const port = await freePort();
  stubUrl = `http://127.0.0.1:${port}`;
  stub = spawn(process.execPath, [STUB], { env: { ...process.env, PORT: String(port), TOKEN_TTL_MIN: "10" }, stdio: ["ignore", "pipe", "pipe"] });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(stubUrl + "/")).ok) break; } catch {} await sleep(50); }
  hub = await startHub({ upstreamUrl: stubUrl, env: {
    SF_LOGIN_URL: stubUrl, SF_MCP_URL: `${stubUrl}/platform/mcp/v1/d/charlois/platform/sobject-reads`, MS_LOGIN_URL: `${stubUrl}/ms`, GRAPH_URL: `${stubUrl}/v1.0`, SP_SITE: "charlois.sharepoint.com,site-finance",
    DROPBOX_API_URL: stubUrl, DROPBOX_AUTH_URL: stubUrl, DROPBOX_MCP_URL: `${stubUrl}/dropbox-mcp`,
    SAGE_URL: stubUrl, SAGE_FOLDER: "PROD", SAGE_REPRESENTATIONS: "YFAC,ZVENTE,BPCUSTOMER,PINVOICE,GACCENTRY", SAGE_APIKEY_MODE: "basic",
    SAGE_OAUTH_AUTH_URL: `${stubUrl}/oauth/authorize`, SAGE_OAUTH_TOKEN_URL: `${stubUrl}/oauth/token`, SAGE_OAUTH_USERINFO_URL: `${stubUrl}/oauth/userinfo`,
    MYREPORT_MCP_URL: `${stubUrl}/myreport/sse`, MYREPORT_TOOLS: "liste_indicateurs,synthese_couts_par_race,valeur_indicateur",
    CLEVOA_URL: `${stubUrl}/api/v1/telemetry`, CLEVOA_KEY: "cle-charlois-dev",
  } });
  marie = await portalUser(); paul = await portalUser();
});
after(async () => { await marie?.mcp.close(); await paul?.mcp.close(); await hub?.stop(); stub?.kill("SIGTERM"); });

test("Mires OAuth : Marie se connecte à Salesforce, SharePoint, Dropbox et Sage X3 (IdP) ; son identité vient de la mire", async () => {
  for (const s of ["salesforce", "sharepoint", "dropbox", "sagex3"]) await connect(marie.cookie, "sagex3" === s ? "sagex3" : s, "marie.dupont@charlois.com");
  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie: marie.cookie } }).then((x) => x.json());
  assert.equal(me.email, "marie.dupont@charlois.com");
  assert.deepEqual(me.systems.map((s) => s.connected), [true, true, true, true, false]);
  const r = await fetch(`${hub.url}/api/myreport/apikey`, { method: "POST", headers: { cookie: marie.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "MR-MARIE-2026" }) });
  assert.equal(r.status, 204);
  for (const s of ["salesforce", "sagex3", "sharepoint", "dropbox", "myreport"]) { const d = await diag(marie, s); assert.equal(d.ok, true, `${s}: ${JSON.stringify(d)}`); }
});

test("Salesforce canin via le serveur MCP SObject Reads simulé : outils, SOQL avec Race__c et Inscrits__c, stands d'agility", async () => {
  const tools = text(await marie.mcp.callTool({ name: "salesforce_tools", arguments: {} })).outils;
  assert.deepEqual(tools.map((t) => t.name), ["find", "getObjectSchema", "getRelatedRecords", "getUserInfo", "listRecentSobjectRecords", "soqlQuery"], "les six outils réels du serveur hébergé");
  const sf = (tool, args) => marie.mcp.callTool({ name: "salesforce_call", arguments: { tool, arguments: args } }).then(text);
  const leads = await sf("soqlQuery", { q: "SELECT Name, Company, Race__c, Inscrits__c FROM Lead WHERE Race__c = 'Berger Allemand'" });
  assert.equal(leads.totalSize, 1); assert.equal(leads.records[0].Company, "Élevage des Crocs de Bourgogne"); assert.equal(leads.records[0].Inscrits__c, 38);
  const opps = await sf("soqlQuery", { q: "SELECT Name, Amount, Concours__c FROM Opportunity LIMIT 2" });
  assert.equal(opps.records.length, 2); assert.match(opps.records[0].Concours__c, /Agility Cup/);
  const idx = await sf("getObjectSchema", {});
  assert.ok(idx.objects.some((o) => o.name === "Opportunity"), "index des objets sans paramètre");
  const desc = await sf("getObjectSchema", { objects: "Opportunity" });
  assert.ok(desc.objects[0].fields.some((f) => f.name === "Inscrits__c" && f.type === "double"));
  const found = await sf("find", { q: "FIND {Crocs} IN NAME FIELDS RETURNING Lead(Id, Company)" });
  assert.equal(found.searchRecords.length, 1); assert.equal(found.searchRecords[0].attributes.type, "Lead");
  const who = await sf("getUserInfo", {});
  assert.equal(who.email, "marie.dupont@charlois.com");
  const related = await sf("getRelatedRecords", { "sobject-name": "Account", id: "0013", "relationship-path": "Opportunities" });
  assert.equal(related.records.length, 3);
  const bad = await marie.mcp.callTool({ name: "salesforce_call", arguments: { tool: "soqlQuery", arguments: { q: "DELETE FROM Lead" } } });
  assert.equal(bad.isError, true);
  const write = await fetch(`${stubUrl}/platform/mcp/v1/d/charlois/platform/sobject-all`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(write.status, 403, "les serveurs d'écriture sont inactifs sur l'org simulée");
});

test("Sage X3 canin : factures Royal Canin Pro, axes analytiques race, YFAC en retard et ZVENTE ; Paul n'a pas les achats", async () => {
  const late = text(await marie.mcp.callTool({ name: "sagex3_query", arguments: { representation: "YFAC", where: "(PAYSTA eq 'Retard')", orderBy: "ACCDAT desc" } }));
  assert.deepEqual(late.map((r) => r.NUM), ["YFAC-2026-0201", "YFAC-2026-0184"]); assert.equal(late[0].AXE_RACE, "BERGER_ALL");
  const pinv = text(await marie.mcp.callTool({ name: "sagex3_query", arguments: { representation: "PINVOICE", where: "(BPSNAM like 'Royal')" } }));
  assert.equal(pinv.length, 2); assert.equal(pinv[0].BPSNAM, "Royal Canin Pro");
  const zv = text(await marie.mcp.callTool({ name: "sagex3_get", arguments: { representation: "ZVENTE", key: "ZV-000123" } }));
  assert.equal(zv.CONCOURS, "Agility Cup Lyon"); assert.equal(zv.$uuid, undefined, "métadonnées Syracuse retirées");
  const proto = text(await marie.mcp.callTool({ name: "sagex3_describe", arguments: { representation: "YFAC" } }));
  assert.ok(proto.colonnes_liste.some((f) => f.name === "AXE_RACE" && f.label === "Axe analytique race"));
  assert.ok(proto.champs_fiche.some((f) => f.name === "AXE_RACE"), "fiche ($details) décrite aussi");

  // Paul : clé d'API personnelle en Basic (login:clé), droits restreints côté Sage
  const k = await fetch(`${hub.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie: paul.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "SYR-PAUL-2026", login: "PMARTIN" }) });
  assert.equal(k.status, 204);
  const ok = text(await paul.mcp.callTool({ name: "sagex3_query", arguments: { representation: "ZVENTE" } })); assert.equal(ok.length, 3);
  const ko = await paul.mcp.callTool({ name: "sagex3_query", arguments: { representation: "PINVOICE" } });
  assert.equal(ko.isError, true); assert.match(ko.content[0].text, /Sage X3 403/);
  const bad = await fetch(`${hub.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie: paul.cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "SYR-FAUSSE", login: "PMARTIN" }) });
  assert.equal(bad.status, 204); const d = await diag(paul, "sagex3"); assert.equal(d.ok, false); assert.match(d.error, /401/);
});

test("SharePoint canin : bilans Excel (binaire → métadonnées), CSV lisible, dossier Confidentiel refusé à Paul", async () => {
  const root = text(await marie.mcp.callTool({ name: "sharepoint_list", arguments: { path: "" } }));
  assert.deepEqual(root.map((i) => i.name).sort(), ["Bilans", "Concours", "Confidentiel"]);
  const bilans = text(await marie.mcp.callTool({ name: "sharepoint_search", arguments: { query: "bilan-canin" } }));
  assert.equal(bilans.length, 2);
  const xlsx = text(await marie.mcp.callTool({ name: "sharepoint_read", arguments: { itemId: "01A" } }));
  assert.match(xlsx.contentType, /spreadsheetml/); assert.match(xlsx.note, /Binaire/); assert.ok(xlsx.size > 1000);
  const csv = text(await marie.mcp.callTool({ name: "sharepoint_read", arguments: { itemId: "01E" } }));
  assert.match(csv.text, /Border Collie,142/);
  const notes = text(await marie.mcp.callTool({ name: "sharepoint_read", arguments: { itemId: "01I" } }));
  assert.match(notes.text, /Royal Canin Pro/);

  await connect(paul.cookie, "sharepoint", "paul.martin@charlois.com");
  const rootP = text(await paul.mcp.callTool({ name: "sharepoint_list", arguments: { path: "" } }));
  assert.deepEqual(rootP.map((i) => i.name).sort(), ["Bilans", "Concours"], "Confidentiel invisible pour Paul");
  const denied = await paul.mcp.callTool({ name: "sharepoint_list", arguments: { path: "Confidentiel" } });
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /403/);
  const deniedRead = await paul.mcp.callTool({ name: "sharepoint_read", arguments: { itemId: "01I" } });
  assert.equal(deniedRead.isError, true);
});

test("Téléchargements Graph signés : /dl/<id> sans signature est refusé, le hub suit la redirection signée", async () => {
  assert.equal((await fetch(`${stubUrl}/dl/01I`)).status, 403, "fichier Confidentiel non servi sans signature");
  assert.equal((await fetch(`${stubUrl}/dl/01A?sig=mauvaise`)).status, 403);
  const csv = text(await marie.mcp.callTool({ name: "sharepoint_read", arguments: { itemId: "01E" } }));
  assert.match(csv.text, /Agility Cup/, "lecture via le hub toujours possible");
});

test("Dropbox canin via le serveur MCP simulé (schémas du serveur officiel) : liste blanche, ns_path, fetch par id, vignette signée, delete jamais transmis", async () => {
  const tools = text(await marie.mcp.callTool({ name: "dropbox_tools", arguments: {} }));
  assert.ok(!tools.some((t) => t.name === "delete") && tools.some((t) => t.name === "file_preview"));
  assert.ok(tools.find((t) => t.name === "fetch").inputSchema.properties.id, "fetch prend id, comme le vrai serveur");
  const bilans = text(await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "list_folder", arguments: { path: "/Bilans", recursive: false } } }));
  assert.deepEqual(bilans.entries.map((e) => [e.name, e.object_type, e.path]), [["bilan-canin-2025.xlsx", "file", "ns:4242//Bilans/bilan-canin-2025.xlsx"], ["bilan-canin-2024.xlsx", "file", "ns:4242//Bilans/bilan-canin-2024.xlsx"]]);
  assert.equal(bilans.has_more, false);
  const who = text(await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "who_am_i", arguments: {} } }));
  assert.equal(who.email, "marie.dupont@charlois.com"); assert.equal(who.team_name, "Charlois");
  const meta = text(await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "get_file_metadata", arguments: { path_or_file_id: "id:01A" } } }));
  assert.equal(meta.metadata_type, "file"); assert.ok(meta.file.size > 1000); assert.match(meta.file.mime_type, /spreadsheetml/);
  const csv = text(await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "fetch", arguments: { id: "ns:4242//Concours/inscrits-agility-2026.csv" } } }));
  assert.match(csv.text, /Border Collie,142/); assert.equal(csv.title, "inscrits-agility-2026.csv");
  const prev = text(await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "file_preview", arguments: { file_paths: ["/Concours/podium-agility-2025.png"] } } }));
  assert.equal(prev.results[0].file_type, "png"); assert.match(prev.results[0].thumbnail_url, /\/dl\/01C\?sig=/);
  const png = await fetch(prev.results[0].thumbnail_url.replace(/^http:\/\/[^/]+/, stubUrl));
  assert.equal(png.status, 200); assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 4).toString("hex"), "89504e47", "la vignette signée est un PNG valide");
  const search = text(await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "search", arguments: { query: "bilan" } } }));
  assert.equal(search.results.length, 2); assert.equal(search.results[0].id, "id:01A");
  const del = await marie.mcp.callTool({ name: "dropbox_call", arguments: { tool: "delete", arguments: { path: "/Bilans" } } });
  assert.equal(del.isError, true);
  await connect(paul.cookie, "dropbox", "paul.martin@charlois.com");
  const denied = await paul.mcp.callTool({ name: "dropbox_call", arguments: { tool: "list_folder", arguments: { path: "/Confidentiel" } } });
  assert.equal(denied.isError, true); assert.match(denied.content[0].text, /access_denied/);
});

test("MyReport canin via SSE : synthèse des coûts par race avec le jeton personnel ; purger_cache hors liste blanche", async () => {
  const tools = text(await marie.mcp.callTool({ name: "myreport_tools", arguments: {} }));
  assert.deepEqual(tools.map((t) => [t.name, t.autorise]), [["liste_indicateurs", true], ["synthese_couts_par_race", true], ["valeur_indicateur", true], ["purger_cache", false]]);
  const s = text(await marie.mcp.callTool({ name: "myreport_call", arguments: { tool: "synthese_couts_par_race", arguments: { periode: "2026", race: "border" } } }));
  assert.equal(s.utilisateur, "Marie Dupont"); assert.deepEqual(s.lignes.map((l) => l.race), ["Border Collie"]); assert.equal(s.lignes[0].total, 20710);
  const purge = await marie.mcp.callTool({ name: "myreport_call", arguments: { tool: "purger_cache", arguments: {} } });
  assert.equal(purge.isError, true); assert.match(purge.content[0].text, /liste blanche/);
});

test("Télémétrie : le hub a envoyé son ping anonyme au bouchon Clevoa", async () => {
  for (let i = 0; i < 40 && !(await fetch(`${stubUrl}/api/v1/telemetry`).then((x) => x.json())).length; i++) await sleep(50);
  const t = await fetch(`${stubUrl}/api/v1/telemetry`).then((x) => x.json());
  assert.ok(t.length >= 1); assert.deepEqual(Object.keys(t[0]).sort(), ["connectors", "date", "env", "receivedAt", "requests", "seats", "version"]);
  assert.equal(t[0].seats, 0, "ping de démarrage : aucun siège encore (Marie et Paul se connectent après) ; le champ est un entier, jamais une identité");
  assert.ok(!JSON.stringify(t).includes("marie"), "aucune identité dans la télémétrie");
});
