// Backend Clevoa exécuté localement, sans AWS : événements API Gateway simulés, stockage en mémoire, et adaptateur DynamoDB
// vérifié contre un faux client (forme exacte des requêtes UpdateItem et Scan).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { telemetry, report, validate, compareVersions, memoryStore, dynamoStore, setStore } from "../handler.js";

const ID_A = "3f1c2a4e-8b7d-4c1e-9a2b-5d6e7f8a9b0c";
const ID_B = "9b8a7f6e-5d4c-4b3a-8a1b-0c9d8e7f6a5b";
const ok = { installation: ID_A, version: "1.3.2", env: "PRODUCTION", date: "2026-10-24", connectors: { salesforce: true, sagex3: false }, requests: 42, seats: 3 };
const ev = (body, key = "cle-charlois") => ({ headers: key ? { "X-Clevoa-Key": key, "content-type": "application/json" } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });
const parse = (r) => ({ status: r.statusCode, body: JSON.parse(r.body) });
let db;

beforeEach(() => {
  process.env.CLEVOA_KEYS = "charlois=cle-charlois, autre=cle-autre, cle-sans-nom, troisieme=cle-troisieme";
  for (const n of ["MIN_VERSION", "LATEST_VERSION", "SILENCE_HOURS", "RETENTION_DAYS", "ALERT_TOPIC_ARN", "TELEMETRY_TABLE"]) delete process.env[n];
  db = memoryStore(); setStore(db);
});

test("Fermé par défaut : CLEVOA_KEYS vide → 503, aucune clé acceptée", async () => {
  process.env.CLEVOA_KEYS = "";
  const r = parse(await telemetry(ev(ok)));
  assert.equal(r.status, 503); assert.equal(r.body.status, "unavailable"); assert.equal(r.body.error, undefined, "aucun détail de configuration pour l'appelant");
  assert.equal((await db.list()).length, 0);
});

test("Clé absente ou inconnue → 401, rien n'est enregistré", async () => {
  assert.equal((await telemetry(ev(ok, null))).statusCode, 401);
  assert.equal((await telemetry(ev(ok, "cle-inconnue"))).statusCode, 401);
  assert.equal((await telemetry(ev(ok, "cle-charloi"))).statusCode, 401, "préfixe d'une clé valide refusé");
  assert.equal((await telemetry(ev(ok, "cle-sans-nom"))).statusCode, 401, "entrée sans nom de client ignorée");
  assert.equal((await db.list()).length, 0);
});

test("Envoi valide : fiche de l'installation persistée (client, version, connecteurs, dernier contact), sans la clé", async () => {
  const r = parse(await telemetry(ev(ok)));
  assert.equal(r.status, 200); assert.equal(r.body.status, "active"); assert.ok(r.body.recorded);
  assert.equal(r.body.totalToday, undefined, "aucune information sur les autres installations");
  const [it] = await db.list();
  assert.equal(it.id, `charlois#${ID_A}#PRODUCTION`);
  assert.deepEqual({ client: it.client, version: it.version, env: it.env, requests: it.requests, seats: it.seats }, { client: "charlois", version: "1.3.2", env: "PRODUCTION", requests: 42, seats: 3 });
  assert.deepEqual(it.connectors, { salesforce: true, sagex3: false });
  assert.equal(it.firstSeen, it.lastSeen);
  assert.ok(it.expiresAt > Date.now() / 1000 + 399 * 86400, "conservation : 400 jours après le dernier contact par défaut");
  assert.ok(!JSON.stringify(it).includes("cle-charlois"), "la clé client n'est jamais stockée");
});

test("Contacts successifs : une seule fiche, firstSeen conservé, version mise à jour", async () => {
  await telemetry(ev(ok));
  const first = (await db.list())[0].firstSeen;
  await new Promise((r) => setTimeout(r, 5));
  await telemetry(ev({ ...ok, version: "1.3.3", requests: 7 }));
  const all = await db.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].firstSeen, first); assert.notEqual(all[0].lastSeen, first);
  assert.equal(all[0].version, "1.3.3"); assert.equal(all[0].requests, 7);
});

test("Séparation : même identifiant d'installation sous deux clés = deux fiches, chacune rangée sous son client", async () => {
  await telemetry(ev(ok, "cle-charlois"));
  await telemetry(ev({ ...ok, version: "9.9.9" }, "cle-autre"));
  await telemetry(ev({ ...ok, installation: ID_B }, "cle-troisieme"));
  const ids = (await db.list()).map((i) => i.id).sort();
  assert.equal(ids.length, 3);
  assert.ok(ids.includes(`autre#${ID_A}#PRODUCTION`) && ids.includes(`charlois#${ID_A}#PRODUCTION`) && ids.includes(`troisieme#${ID_B}#PRODUCTION`));
  assert.equal((await db.list()).find((i) => i.id === `charlois#${ID_A}#PRODUCTION`).version, "1.3.2", "l'autre client n'a pas écrasé la fiche");
});

test("Même identifiant en production et en pré-production (sauvegarde restaurée) : deux fiches distinctes, même avec une seule clé", async () => {
  await telemetry(ev(ok));
  await telemetry(ev({ ...ok, env: "PRE-PROD", version: "1.3.3" }));
  const all = await db.list();
  assert.deepEqual(all.map((i) => i.id).sort(), [`charlois#${ID_A}#PRE-PROD`, `charlois#${ID_A}#PRODUCTION`]);
  assert.equal(all.find((i) => i.env === "PRODUCTION").version, "1.3.2", "la pré-production ne masque pas la production");
});

test("Hub antérieur à 1.3.2 (sans identifiant) : accepté, une fiche par environnement", async () => {
  const { installation, ...legacy } = ok;
  assert.equal((await telemetry(ev({ ...legacy, env: "PRE-PROD" }))).statusCode, 200);
  assert.equal((await db.list())[0].id, "charlois#ancienne#PRE-PROD");
});

test("Payload invalide : JSON, champs supplémentaires, types, bornes, taille, identifiant incorrect", async () => {
  const bad = async (body) => (await telemetry(ev(body))).statusCode;
  assert.equal(await bad("{pas du json"), 400);
  assert.equal(await bad({ ...ok, email: "x@y" }), 400, "tout champ hors payload est refusé");
  assert.equal(await bad({ ...ok, token: "abc" }), 400);
  assert.equal(await bad({ ...ok, installation: "pas-un-uuid" }), 400);
  assert.equal(await bad({ ...ok, installation: ID_A.toUpperCase() }), 400);
  assert.equal(await bad({ ...ok, version: "1.3" }), 400);
  assert.equal(await bad({ ...ok, env: "AUTRE" }), 400);
  assert.equal(await bad({ ...ok, date: "24/10/2026" }), 400);
  assert.equal(await bad({ ...ok, requests: -1 }), 400);
  assert.equal(await bad({ ...ok, requests: 1.5 }), 400);
  assert.equal(await bad({ ...ok, seats: "7" }), 400);
  assert.equal(await bad({ ...ok, connectors: { a: "oui" } }), 400);
  assert.equal(await bad({ ...ok, connectors: { "Pas Valide": true } }), 400);
  assert.equal(await bad({ ...ok, connectors: [true] }), 400);
  assert.equal(await bad([ok]), 400);
  assert.equal(await bad({ ...ok, connectors: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`c${i}`, true])) }), 400);
  assert.equal((await telemetry(ev(JSON.stringify(ok) + " ".repeat(5000)))).statusCode, 413);
  assert.equal((await telemetry({ headers: { "x-clevoa-key": "cle-autre" }, isBase64Encoded: true, body: "A".repeat(20000) })).statusCode, 413, "taille contrôlée avant décodage base64");
  assert.equal((await db.list()).length, 0, "rien n'est enregistré");
  assert.equal(validate(ok), null);
});

test("Corps encodé en base64 par API Gateway", async () => {
  const r = await telemetry({ headers: { "x-clevoa-key": "cle-autre" }, isBase64Encoded: true, body: Buffer.from(JSON.stringify(ok)).toString("base64") });
  assert.equal(r.statusCode, 200);
});

test("Versions : minimum et dernière version renvoyés au hub s'ils sont configurés ; comparaison X.Y.Z", async () => {
  assert.equal(parse(await telemetry(ev(ok))).body.minimum, undefined);
  process.env.MIN_VERSION = "1.3.2"; process.env.LATEST_VERSION = "1.4.0";
  const b = parse(await telemetry(ev(ok))).body;
  assert.equal(b.minimum, "1.3.2"); assert.equal(b.latest, "1.4.0");
  assert.equal(compareVersions("1.3.1", "1.3.2"), -1);
  assert.equal(compareVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareVersions("1.3.2-rc.1", "1.3.2"), -1);
  assert.equal(compareVersions("1.3.2", "1.3.2"), 0);
});

test("Stockage en panne → 500 et aucune réponse « active » (le hub retentera)", async () => {
  setStore({ async put() { throw Object.assign(new Error("réseau"), { name: "ServiceUnavailable" }); }, async list() { return []; } });
  const r = parse(await telemetry(ev(ok)));
  assert.equal(r.status, 500); assert.equal(r.body.status, "error");
});

test("Rapport : installations silencieuses au-delà de SILENCE_HOURS et versions sous MIN_VERSION, alerte publiée", async () => {
  const now = Date.parse("2026-10-24T08:00:00Z");
  await db.put({ id: "charlois#a", client: "charlois", env: "PRODUCTION", version: "1.3.2", lastSeen: "2026-10-24T03:00:00Z" });
  await db.put({ id: "charlois#b", client: "charlois", env: "PRE-PROD", version: "1.3.1", lastSeen: "2026-10-21T03:00:00Z" });
  await db.put({ id: "autre#c", client: "autre", env: "PRODUCTION", version: "1.2.1", lastSeen: "2026-10-23T03:00:00Z" });
  const published = [];
  const publish = async (subject, message) => published.push({ subject, message });

  await db.put({ id: "charlois#ancienne#PRODUCTION", client: "charlois", env: "PRODUCTION", version: "1.3.1", lastSeen: "2026-09-01T03:00:00Z" });
  let r = await report({}, { now, publish });
  assert.equal(r.total, 4);
  assert.deepEqual(r.lost.map((s) => s.id), ["charlois#ancienne#PRODUCTION"], "au-delà de 30 jours : perdue, sans alerte");
  assert.deepEqual(r.silent.map((s) => s.id), ["charlois#b"], "48 h sans contact par défaut");
  assert.deepEqual(r.outdated, [], "pas de minimum configuré");
  assert.equal(published.length, 0, "sans ALERT_TOPIC_ARN, rien n'est publié");

  process.env.MIN_VERSION = "1.3.2"; process.env.SILENCE_HOURS = "24"; process.env.ALERT_TOPIC_ARN = "arn:aws:sns:eu-west-3:000000000000:test";
  r = await report({}, { now, publish });
  assert.deepEqual(r.silent.map((s) => s.id).sort(), ["autre#c", "charlois#b"]);
  assert.deepEqual(r.outdated.map((s) => s.id).sort(), ["autre#c", "charlois#b"]);
  assert.equal(published.length, 1);
  assert.match(published[0].message, /charlois#b/);
  assert.ok(!published[0].message.includes("ancienne"), "une fiche perdue n'alimente pas l'alerte, même sous la version minimale");
  assert.ok(!/cle-/.test(published[0].message), "aucune clé dans l'alerte");
});

test("Rapport : une alerte SNS en échec n'interrompt pas la fonction (pas de doublon par nouvel essai)", async () => {
  process.env.ALERT_TOPIC_ARN = "arn:aws:sns:eu-west-3:000000000000:test";
  await db.put({ id: "charlois#b", client: "charlois", env: "PRE-PROD", version: "1.3.1", lastSeen: new Date(Date.now() - 72 * 3600_000).toISOString() });
  const r = await report({}, { publish: async () => { throw Object.assign(new Error("x"), { name: "AuthorizationError" }); } });
  assert.equal(r.silent.length, 1); assert.equal(r.alertError, "AuthorizationError");
});

test("Rapport sans alerte : rien n'est publié même avec ALERT_TOPIC_ARN", async () => {
  process.env.ALERT_TOPIC_ARN = "arn:aws:sns:eu-west-3:000000000000:test";
  await db.put({ id: "charlois#a", client: "charlois", env: "PRODUCTION", version: "1.3.2", lastSeen: new Date().toISOString() });
  const published = [];
  const r = await report({}, { publish: async (s, m) => published.push(m) });
  assert.equal(r.silent.length, 0); assert.equal(published.length, 0);
});

test("Adaptateur DynamoDB : UpdateItem avec firstSeen conservé, Scan paginé et relu", async () => {
  const sent = [];
  class UpdateItemCommand { constructor(input) { this.input = input; } }
  class ScanCommand { constructor(input) { this.input = input; } }
  const pages = [
    { Items: [{ id: { S: "charlois#a" }, version: { S: "1.3.2" }, requests: { N: "4" }, connectors: { M: { salesforce: { BOOL: true } } }, seats: { NULL: true } }], LastEvaluatedKey: { id: { S: "charlois#a" } } },
    { Items: [{ id: { S: "autre#b" }, version: { S: "1.3.1" } }] },
  ];
  const client = { async send(cmd) { sent.push(cmd); return cmd instanceof ScanCommand ? pages.shift() : {}; } };
  const s = dynamoStore("table-test", { client, UpdateItemCommand, ScanCommand });

  await s.put({ id: "charlois#a", version: "1.3.2", requests: 4, seats: null, connectors: { salesforce: true }, lastSeen: "2026-10-24T03:00:00Z", expiresAt: 1 });
  const u = sent[0].input;
  assert.equal(u.TableName, "table-test");
  assert.deepEqual(u.Key, { id: { S: "charlois#a" } });
  assert.match(u.UpdateExpression, /^SET .*#first = if_not_exists\(#first, :now\)$/);
  assert.equal(u.ExpressionAttributeNames["#first"], "firstSeen");
  assert.ok(!Object.values(u.ExpressionAttributeNames).includes("id"), "la clé primaire n'est pas réécrite");
  const values = Object.values(u.ExpressionAttributeValues);
  assert.ok(values.some((v) => v.M?.salesforce?.BOOL === true) && values.some((v) => v.N === "4") && values.some((v) => v.NULL === true));

  const all = await s.list();
  assert.equal(sent.filter((c) => c instanceof ScanCommand).length, 2, "deux pages lues");
  assert.deepEqual(sent[2].input.ExclusiveStartKey, { id: { S: "charlois#a" } });
  assert.deepEqual(all[0], { id: "charlois#a", version: "1.3.2", requests: 4, connectors: { salesforce: true }, seats: null });
  assert.equal(all[1].id, "autre#b");
});
