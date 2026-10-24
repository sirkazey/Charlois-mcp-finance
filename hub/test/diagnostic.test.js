// Diagnostic exportable (hub/diagnostic.js) : exécuté comme l'administrateur le lancerait dans le conteneur, contre un hub de
// test en marche. Aucun secret, jeton, clé, e-mail, URL ni identifiant de collaborateur dans le rapport ; états et compteurs justes ;
// mauvaise clé de chiffrement et hub arrêté signalés sans plantage ; aucune écriture.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, connectedUser, KEY, HUB_DIR, freePort } from "./helpers/hub.js";
import { VERSION } from "../version.js";

let up, hub;
const KEY_SSO = "test-key-bob-sso-0123456789";
before(async () => {
  up = await startUpstream();
  hub = await startHub({ upstreamUrl: up.url, users: {
    [KEY]: connectedUser(up.url),
    [KEY_SSO]: { createdAt: "2026-01-01T00:00:00.000Z", email: "bob@example.com", sso: { sub: "oid-bob", tid: "tid-1", upn: "bob@example.com", name: "Bob" }, myreport: { apiKey: "mr-token-bob" } },
  } });
});
after(async () => { await hub?.stop(); await up?.stop(); });

/** Lance le diagnostic avec l'environnement du hub (comme `docker exec … node diagnostic.js`). Asynchrone : le mock amont
 *  tourne dans ce même processus et doit pouvoir répondre aux requêtes de joignabilité. */
const diagnose = (extraEnv = {}, args = ["--sans-reseau"]) => new Promise((resolve) => {
  execFile(process.execPath, [join(HUB_DIR, "diagnostic.js"), ...args], { env: { ...hub.env, ...extraEnv }, timeout: 20_000 }, (err, out, stderr) =>
    resolve({ status: err ? err.code : 0, out, err: stderr, json: out ? JSON.parse(out) : null }));
});

test("Rapport complet : version, environnement, hub, fichier chiffré, connecteurs, télémétrie, sans problème signalé", async () => {
  await fetch(`${hub.url}/health`);
  const { status, json: d } = await diagnose();
  assert.equal(status, 0);
  assert.equal(d.version, VERSION);
  assert.match(d.avertissement, /Relisez-le avant de le transmettre/);
  assert.equal(d.hub.health, 200);
  assert.equal(d.donnees.fichier, "présent"); assert.equal(d.donnees.chiffre, true); assert.equal(d.donnees.dechiffrable, true);
  assert.equal(d.donnees.entrees, 2); assert.equal(d.donnees.liesSso, 1);
  assert.deepEqual(d.donnees.connexions, { salesforce: 1, sagex3: 1, sharepoint: 1, dropbox: 1, myreport: 2 });
  assert.match(d.donnees.installation, /^[0-9a-f-]{36}$/, "identifiant d'installation, déjà connu de Clevoa par la télémétrie");
  assert.deepEqual(d.connecteurs.map((c) => [c.id, c.etat]), [["salesforce", "configuré"], ["sagex3", "configuré"], ["sharepoint", "configuré"], ["dropbox", "configuré"], ["myreport", "configuré"]]);
  assert.equal(d.telemetrie.active, true); assert.equal(d.telemetrie.urlParDefaut, false);
  assert.equal(d.reseauTeste, false);
  assert.deepEqual(d.problemes, []);
  assert.equal(d.variables.SF_CLIENT_SECRET, "renseignée"); assert.equal(d.variables.ENCRYPTION_KEY, "renseignée");
});

test("Aucune valeur sensible : secrets, jetons, clés MCP, e-mails, noms, URL et hôtes absents du rapport", async () => {
  const { out } = await diagnose();
  const users = JSON.stringify(hub.readUsers());
  const forbidden = [
    KEY, KEY_SSO, hub.env.ENCRYPTION_KEY, hub.env.CLEVOA_KEY, hub.env.SF_CLIENT_SECRET, hub.env.MS_CLIENT_SECRET, hub.env.SAGE_OAUTH_CLIENT_SECRET, hub.env.DROPBOX_APP_SECRET,
    "sf-token-alice", "sf-refresh-alice", "sage-token-alice", "ms-token-alice", "dbx-token-alice", "mr-token-alice", "mr-token-bob",
    "alice@example.com", "bob@example.com", "Bob", "oid-bob", "127.0.0.1", hub.env.PUBLIC_URL, up.url,
  ];
  for (const s of forbidden) assert.ok(!out.includes(s), `valeur sensible dans le rapport : ${s}`);
  assert.ok(users.includes("sf-token-alice"), "contrôle du test : les jetons sont bien dans le fichier source");
  assert.ok(!/token|secret|password|@/i.test(Object.values(JSON.parse(out).variables).join(" ")), "variables : états seulement");
});

test("Réseau testé : hôte de chaque système joignable (code HTTP), sans identifiant ni URL dans le rapport", async () => {
  const { json: d, out } = await diagnose({}, []);
  assert.equal(d.reseauTeste, true);
  for (const c of d.connecteurs) {
    assert.equal(c.reseau.joignable, true, `${c.id} joignable`);
    assert.equal(typeof c.reseau.http, "number");
  }
  assert.ok(!out.includes(up.url));
  assert.equal(d.telemetrie.reseau.joignable, true);
});

test("Système injoignable : code d'erreur réseau et problème signalé", async () => {
  const closed = await freePort();
  const { json: d } = await diagnose({ SAGE_URL: `http://127.0.0.1:${closed}` }, []);
  const sage = d.connecteurs.find((c) => c.id === "sagex3");
  assert.equal(sage.reseau.joignable, false); assert.equal(sage.reseau.erreur, "ECONNREFUSED");
  assert.ok(d.problemes.some((p) => p.startsWith("sagex3 : hôte injoignable")));
});

test("Variables piégées : identifiants dans les URL, chemin et paramètres secrets, retour à la ligne, redirection → rien ne fuit", async () => {
  const seen = [];
  const { createServer } = await import("node:http");
  const trap = createServer((req, res) => { seen.push({ method: req.method, url: req.url, auth: req.headers.authorization }); res.writeHead(302, { Location: "http://127.0.0.1:9/ailleurs" }); res.end(); });
  await new Promise((r) => trap.listen(0, "127.0.0.1", r));
  const host = `127.0.0.1:${trap.address().port}`;
  try {
    const { json: d, out } = await diagnose({
      SAGE_URL: `http://sage-user:Sage-PASS-1@${host}/api1/x3?token=TOKEN-SECRET-2`, CLEVOA_URL: `http://lic:LIC-PASS-3@${host}/api/v1/telemetry`,
      PUBLIC_URL: "https://admin:HUB-PASS-4@hub.client.example/", LOG_LEVEL: "debug\nINJECTION-5", TRUST_PROXY: "10.1.2.3/8", MYREPORT_MCP_URL: "pas-une-url",
    }, []);
    for (const s of ["Sage-PASS-1", "sage-user", "TOKEN-SECRET-2", "api1", "LIC-PASS-3", "HUB-PASS-4", "hub.client.example", "INJECTION-5", "10.1.2.3", "pas-une-url", host, "ailleurs"])
      assert.ok(!out.includes(s), `fuite dans le rapport : ${s}`);
    assert.equal(d.variables.LOG_LEVEL, "renseignée"); assert.equal(d.variables.TRUST_PROXY, "renseignée");
    assert.equal(d.connecteurs.find((c) => c.id === "sagex3").reseau.http, 302, "redirection constatée, jamais suivie");
    assert.equal(d.connecteurs.find((c) => c.id === "myreport").reseau.joignable, false);
    assert.ok(seen.length >= 2 && seen.every((r) => r.method === "HEAD" && r.url === "/" && !r.auth), `requêtes reçues : ${JSON.stringify(seen)}`);
  } finally { trap.close(); }
});

test("Mauvaise ENCRYPTION_KEY : signalée, sans plantage ni compteur", async () => {
  const { status, json: d } = await diagnose({ ENCRYPTION_KEY: "une-autre-cle-de-test-0123456789abcdef" });
  assert.equal(status, 0);
  assert.equal(d.donnees.dechiffrable, false); assert.equal(d.donnees.entrees, undefined);
  assert.ok(d.problemes.some((p) => /non déchiffrable/.test(p)));
});

test("Hub arrêté ou absent : /health injoignable signalé ; connecteurs non configurés et simulateurs décrits", async () => {
  const port = await freePort();
  const { json: d } = await diagnose({ PORT: String(port), SAGE_URL: "", MYREPORT_MCP_URL: "", SF_CLIENT_ID: "", CLEVOA_KEY: "" });
  assert.equal(d.hub.health, "injoignable");
  assert.ok(d.problemes.includes("le hub ne répond pas sur /health"));
  const state = Object.fromEntries(d.connecteurs.map((c) => [c.id, c.etat]));
  const prod = process.env.APP_ENV === "production";
  assert.equal(state.sagex3, prod ? "non exposé (production)" : "simulateur");
  assert.equal(state.myreport, prod ? "non exposé (production)" : "simulateur");
  assert.equal(state.salesforce, "non configuré");
  assert.equal(d.telemetrie.active, false);
});

test("Lecture seule : le diagnostic n'écrit pas dans le dossier de données", async () => {
  const file = join(hub.dataDir, "users.json");
  const avant = readFileSync(file, "utf8");
  await diagnose();
  assert.equal(readFileSync(file, "utf8"), avant);
});
