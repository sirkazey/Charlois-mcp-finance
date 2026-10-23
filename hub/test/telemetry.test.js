// Télémétrie Clevoa : payload anonyme, planification quotidienne (horloge simulée), envoi réel du hub vers le mock,
// et fonction Lambda clevoa-backend/handler.js exécutée avec des événements API Gateway simulés.
import { test, mock, before, after } from "node:test";
import assert from "node:assert/strict";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY } from "./helpers/hub.js";
import { VERSION } from "../version.js";
import { telemetry as lambda } from "../../clevoa-backend/handler.js";

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
    assert.deepEqual(tm.payload(CONNECTORS), { version: VERSION, env, date: "2026-10-21", connectors: { salesforce: true, sagex3: false, sharepoint: false, dropbox: true, myreport: true }, requests: 3 });

    tm.start(CONNECTORS);
    await new Promise((r) => setImmediate(r));
    assert.equal(calls.length, 1, "envoi immédiat au démarrage");
    assert.equal(calls[0].url, "https://clevoa.test/api/v1/telemetry");
    assert.equal(calls[0].init.headers["X-Clevoa-Key"], "k-unit");
    assert.deepEqual(Object.keys(calls[0].body).sort(), ["connectors", "date", "env", "requests", "version"], "aucun autre champ");
    assert.ok(!JSON.stringify(calls[0].body).match(/token|email|key|@/i), "rien d'identifiant");
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

test("Lambda clevoa-backend : clé client exigée, payload validé, { status: 'active' } et statistiques simulées", async () => {
  const ev = (body, headers = { "X-Clevoa-Key": "cle-charlois", "content-type": "application/json" }) => ({ headers, body: typeof body === "string" ? body : JSON.stringify(body) });
  const ok = { version: "1.0.0", date: "2026-10-22", connectors: { salesforce: true, sagex3: false }, requests: 42 };

  const noKey = await lambda(ev(ok, {}));
  assert.equal(noKey.statusCode, 401); assert.equal(JSON.parse(noKey.body).status, "unauthorized");

  const r = await lambda(ev(ok));
  assert.equal(r.statusCode, 200); assert.equal(r.headers["Content-Type"], "application/json");
  const b = JSON.parse(r.body);
  assert.equal(b.status, "active"); assert.ok(b.recorded); assert.equal(b.totalToday, 1);
  assert.equal(JSON.parse((await lambda(ev(ok))).body).totalToday, 2, "enregistrement simulé cumulé");

  assert.equal((await lambda(ev("{pas du json"))).statusCode, 400);
  assert.equal((await lambda(ev({ ...ok, email: "x@y" }))).statusCode, 400, "tout champ hors payload anonyme est refusé");
  assert.equal((await lambda(ev({ ...ok, requests: -1 }))).statusCode, 400);
  assert.equal((await lambda(ev({ ...ok, connectors: { a: "oui" } }))).statusCode, 400);
  const b64 = await lambda({ headers: { "x-clevoa-key": "k" }, isBase64Encoded: true, body: Buffer.from(JSON.stringify(ok)).toString("base64") });
  assert.equal(b64.statusCode, 200, "corps encodé en base64 par API Gateway");
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
  assert.deepEqual(Object.keys(body).sort(), ["connectors", "date", "env", "requests", "version"]);
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
