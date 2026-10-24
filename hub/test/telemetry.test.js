// Télémétrie Clevoa : payload réduit à des compteurs, planification quotidienne (horloge simulée), essais bornés, délai d'envoi,
// envoi réel du hub vers le mock, identifiant d'installation persistant, hub indifférent à une panne du backend.
// Le backend (clevoa-backend/handler.js) a ses propres tests : clevoa-backend/test/handler.test.js.
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY, freePort, readStore } from "./helpers/hub.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { VERSION } from "../version.js";

const INSTALL = "3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c";
const CONNECTORS = [
  { id: "salesforce", oauth: { clientId: "x" } }, { id: "sagex3", mock: true, oauth: {}, apiKey: {} },
  { id: "sharepoint", oauth: {} }, { id: "dropbox", oauth: { clientId: "d" } }, { id: "myreport", apiKey: {} },
];

test("Module : payload 100 % anonyme (version, date, booléens par connecteur, compteur) et envoi au démarrage puis à 03:00", async (t) => {
  process.env.CLEVOA_KEY = "k-unit"; process.env.CLEVOA_URL = "https://clevoa.test/api/v1/telemetry";
  const tm = await import("../telemetry.js");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.timers.setTime(Date.parse("2026-10-21T22:00:00"));
  const calls = [];
  const fetchMock = mock.method(globalThis, "fetch", async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ status: "active" }), { status: 200 }); });
  try {
    tm.count(); tm.count(); tm.count();
    const env = process.env.APP_ENV === "production" ? "PRODUCTION" : "PRE-PROD";
    assert.deepEqual(tm.payload(CONNECTORS), { version: VERSION, env, date: "2026-10-21", connectors: { salesforce: true, sagex3: false, sharepoint: false, dropbox: true, myreport: true }, requests: 3, seats: 0 });
    assert.equal(tm.payload(CONNECTORS, 0, INSTALL).installation, INSTALL);

    tm.start(CONNECTORS, () => 0, () => INSTALL);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1, "envoi immédiat au démarrage");
    assert.equal(calls[0].url, "https://clevoa.test/api/v1/telemetry");
    assert.equal(calls[0].init.headers["X-Clevoa-Key"], "k-unit");
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["connectors", "date", "env", "installation", "requests", "seats", "version"], "aucun autre champ");
    assert.ok(!JSON.stringify(calls[0].body).match(/token|email|key|@/i), "rien d'identifiant");
    assert.ok(calls[0].init.signal instanceof AbortSignal, "délai d'envoi borné : un backend muet ne retient pas le hub");
    assert.equal(calls[0].body.requests, 3);

    tm.count();
    t.mock.timers.tick(4 * 3600 * 1000 + 59 * 60 * 1000); // 02:59
    assert.equal(calls.length, 1);
    t.mock.timers.tick(60 * 1000); // 03:00
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 2, "envoi quotidien à 03:00");
    assert.equal(calls[1].body.requests, 1, "compteur remis à zéro après chaque envoi réussi");
    assert.equal(calls[1].body.date, "2026-10-22");
    t.mock.timers.tick(24 * 3600 * 1000);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 3, "puis toutes les 24 h");
  } finally { fetchMock.mock.restore(); }
});

test("Module : Clevoa injoignable au démarrage → nouvel essai à 1 min, 5 min, 30 min, puis horaire quotidien", async (t) => {
  process.env.CLEVOA_KEY = "k-unit"; process.env.CLEVOA_URL = "https://clevoa.test/api/v1/telemetry";
  const tm = await import("../telemetry.js");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.timers.setTime(Date.parse("2026-10-21T10:00:00"));
  let fail = 3; const calls = [];
  const fetchMock = mock.method(globalThis, "fetch", async () => { calls.push(Date.now()); if (fail-- > 0) throw new TypeError("fetch failed"); return new Response(JSON.stringify({ status: "active" }), { status: 200 }); });
  try {
    tm.start(CONNECTORS);
    const settle = () => new Promise((r) => setImmediate(r));
    await settle(); assert.equal(calls.length, 1, "essai immédiat (échec)");
    t.mock.timers.tick(60_000); await settle(); assert.equal(calls.length, 2, "nouvel essai après 1 min");
    t.mock.timers.tick(300_000); await settle(); assert.equal(calls.length, 3, "puis 5 min");
    t.mock.timers.tick(1_800_000); await settle(); assert.equal(calls.length, 4, "puis 30 min : succès");
    t.mock.timers.tick(1_800_000); await settle(); assert.equal(calls.length, 4, "après succès, plus d'essai rapproché");
    t.mock.timers.setTime(Date.parse("2026-10-22T03:00:01")); t.mock.timers.tick(1); await settle();
    assert.equal(calls.length, 5, "retour à l'horaire quotidien");
  } finally { fetchMock.mock.restore(); }
});

test("Module : après trois nouveaux essais en échec, retour à l'horaire quotidien (aucune boucle d'essais)", async (t) => {
  process.env.CLEVOA_KEY = "k-unit"; process.env.CLEVOA_URL = "https://clevoa.test/api/v1/telemetry";
  const tm = await import("../telemetry.js");
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  t.mock.timers.setTime(Date.parse("2026-10-21T10:00:00"));
  const calls = [];
  const fetchMock = mock.method(globalThis, "fetch", async () => { calls.push(Date.now()); throw new TypeError("fetch failed"); });
  try {
    tm.start(CONNECTORS);
    const settle = () => new Promise((r) => setImmediate(r));
    await settle();
    for (const ms of [60_000, 300_000, 1_800_000]) { t.mock.timers.tick(ms); await settle(); }
    assert.equal(calls.length, 4, "essai immédiat puis 1, 5 et 30 min");
    t.mock.timers.tick(6 * 3600_000); await settle();
    assert.equal(calls.length, 4, "plus aucun essai avant 03:00");
    t.mock.timers.setTime(Date.parse("2026-10-22T03:00:01")); t.mock.timers.tick(1); await settle();
    assert.equal(calls.length, 5, "un seul essai à l'horaire quotidien");
    t.mock.timers.tick(3600_000); await settle();
    assert.equal(calls.length, 5, "toujours en échec : pas de rafale de nouveaux essais");
  } finally { fetchMock.mock.restore(); }
});

test("Module : version sous le minimum annoncé par Clevoa → avertissement dans les journaux, hub inchangé", async () => {
  process.env.CLEVOA_KEY = "k-unit"; process.env.CLEVOA_URL = "https://clevoa.test/api/v1/telemetry";
  const tm = await import("../telemetry.js");
  const warn = mock.method(console, "warn", () => {});
  const answer = (body) => mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status: 200 }));
  let f = answer({ status: "active", minimum: "99.0.0" });
  try {
    assert.equal(await tm.send(CONNECTORS), "active");
    assert.match(warn.mock.calls[0].arguments[0], /inférieure au minimum 99\.0\.0/);
    f.mock.restore(); f = answer({ status: "active", minimum: "0.0.1" });
    await tm.send(CONNECTORS);
    f.mock.restore(); f = answer({ status: "active", minimum: "<script>" });
    await tm.send(CONNECTORS);
    assert.equal(warn.mock.calls.length, 1, "minimum atteint ou invalide : aucun avertissement");
  } finally { f.mock.restore(); warn.mock.restore(); }
});

test("Module : une réponse du backend ne peut pas injecter de lignes dans les journaux du hub ; aucune redirection suivie", async () => {
  process.env.CLEVOA_KEY = "k-unit"; process.env.CLEVOA_URL = "https://clevoa.test/api/v1/telemetry";
  const tm = await import("../telemetry.js");
  const out = [];
  const log = mock.method(console, "log", (...a) => out.push(a.join(" ")));
  const warn = mock.method(console, "warn", (...a) => out.push(a.join(" ")));
  let init;
  const f = mock.method(globalThis, "fetch", async (_u, i) => { init = i; return new Response(JSON.stringify({ status: "ok\n[auth] faux", minimum: "99.9.9\n[admin] FAUX MESSAGE" }), { status: 200 }); });
  try {
    await tm.send(CONNECTORS);
    assert.equal(init.redirect, "error", "la clé ne suit jamais une redirection");
    assert.ok(out.length >= 1);
    assert.ok(out.every((l) => !l.includes("\n") && !/faux|FAUX/i.test(l)), `journal propre : ${JSON.stringify(out)}`);
  } finally { f.mock.restore(); log.mock.restore(); warn.mock.restore(); }
});

let up, hub;
before(async () => { up = await startUpstream(); hub = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) } }); });
after(async () => { await hub?.stop(); await up?.stop(); });

test("Hub → Clevoa : POST au démarrage avec la clé et un payload sans aucune donnée utilisateur ; pied de page « Propulsé par Clevoa »", async () => {
  const deadline = Date.now() + 3000;
  while (!up.requests("/api/v1/telemetry").length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  const t = up.requests("/api/v1/telemetry", "POST");
  assert.equal(t.length, 1, "un envoi au démarrage");
  assert.equal(t[0].headers["x-clevoa-key"], "clevoa-key-test");
  const body = JSON.parse(t[0].body);
  assert.deepEqual(Object.keys(body).sort(), ["connectors", "date", "env", "installation", "requests", "seats", "version"]);
  assert.match(body.installation, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, "UUID aléatoire");
  assert.ok(hub.rawStore().startsWith("enc1:") && !hub.rawStore().includes(body.installation), "identifiant conservé dans le fichier chiffré, jamais en clair");
  assert.equal(body.seats, 1, "un siège : le collaborateur connecté du test ; aucune identité transmise");
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(body.connectors, { salesforce: true, sagex3: true, sharepoint: true, dropbox: true, myreport: true });
  assert.equal(body.requests, 0);
  assert.ok(!t[0].body.includes("alice") && !t[0].body.includes("token"), "ni email ni jeton");
  assert.match(hub.logs(), /\[telemetry\] 200 active/);

  const html = await fetch(`${hub.url}/`).then((r) => r.text());
  assert.match(html, /Propulsé par <b>Clevoa<\/b> — Licence Active/);
  const me = await fetch(`${hub.url}/api/me`).then((r) => r.json());
  assert.equal(me.config.find((v) => v.name === "CLEVOA_KEY").value, "••••••••", "clé de licence masquée dans le portail");
});

test("Hub sans CLEVOA_KEY : aucune télémétrie envoyée", async () => {
  up.reset();
  const silent = await startHub({ upstreamUrl: up.url, env: { CLEVOA_KEY: "" } });
  try {
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(up.requests("/api/v1/telemetry").length, 0);
    assert.match(silent.logs(), /désactivée/);
  } finally { await silent.stop(); }
});

test("Identifiant d'installation : créé une fois, conservé dans users.json chiffré, identique après redémarrage", async () => {
  up.reset();
  const first = await startHub({ upstreamUrl: up.url });
  const wait = async () => { const d = Date.now() + 3000; while (!up.requests("/api/v1/telemetry").length && Date.now() < d) await new Promise((r) => setTimeout(r, 50)); };
  try {
    await wait();
    const id = JSON.parse(up.requests("/api/v1/telemetry", "POST")[0].body).installation;
    assert.ok(first.rawStore().startsWith("enc1:"), "fichier chiffré");
    const copy = join(mkdtempSync(join(tmpdir(), "inst-")), "users.json"); writeFileSync(copy, first.rawStore());
    assert.equal(readStore(copy).installation, id);
    up.reset();
    const second = await startHub({ upstreamUrl: up.url, store: first.rawStore() });
    try { await wait(); assert.equal(JSON.parse(up.requests("/api/v1/telemetry", "POST")[0].body).installation, id, "même identifiant après redémarrage"); }
    finally { await second.stop(); }
  } finally { await first.stop(); }
});

test("Backend Clevoa injoignable ou muet : le hub démarre, répond et sert le MCP normalement", async () => {
  const closed = await freePort(); // port libre : connexion refusée
  const mute = createServer((sock) => { sock.on("error", () => {}); }); // accepte la connexion, ne répond jamais
  await new Promise((r) => mute.listen(0, "127.0.0.1", r));
  for (const url of [`http://127.0.0.1:${closed}/api/v1/telemetry`, `http://127.0.0.1:${mute.address().port}/api/v1/telemetry`]) {
    const h = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { CLEVOA_URL: url } });
    try {
      assert.equal((await fetch(`${h.url}/health`)).status, 200);
      const r = await fetch(`${h.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
      assert.equal(r.status, 200);
      assert.match(await r.text(), /sagex3_query/);
    } finally { await h.stop(); }
  }
  mute.close();
});
