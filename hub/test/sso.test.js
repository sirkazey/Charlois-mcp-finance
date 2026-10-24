// SSO Microsoft Entra ID (mode mock, mire Entra du mock amont) : accès anonyme refusé, identité ↔ clé, séparation entre
// utilisateurs, usurpation (id_token falsifié, state étranger), révocation (rotation de clé), connexion SharePoint silencieuse,
// et verrous de démarrage (mock interdit en production, entra exige Microsoft et un ID de locataire).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startUpstream } from "./helpers/upstream.js";
import { startHub } from "./helpers/hub.js";

let up, hub;
const noFollow = { redirect: "manual" };
const cookieOf = (r) => r.headers.get("set-cookie")?.match(/mcp_key=([^;]*)/)?.[1];
const me = (key) => fetch(`${hub.url}/api/me`, { headers: key ? { cookie: `mcp_key=${key}` } : {} }).then((r) => r.json());
const mcpPost = (key) => fetch(`${hub.url}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
async function listTools(key) {
  const c = new Client({ name: "t", version: "1" });
  await c.connect(new StreamableHTTPClientTransport(new URL(`${hub.url}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  try { return (await c.listTools()).tools.map((t) => t.name); } finally { await c.close(); }
}
/** Flux SSO complet d'un navigateur : départ /auth/sso (cookie existant ou clé temporaire), puis callback avec `code` ou `error`. */
async function sso(browserKey, { code, error } = {}) {
  const start = await fetch(`${hub.url}/auth/sso`, { headers: browserKey ? { cookie: `mcp_key=${browserKey}` } : {}, ...noFollow });
  assert.equal(start.status, 302, await start.text());
  const tmp = cookieOf(start) ?? browserKey, loc = new URL(start.headers.get("location"));
  const q = error ? `error=${error}` : `code=${encodeURIComponent(code)}`;
  const cb = await fetch(`${hub.url}/auth/sso/callback?${q}&state=${loc.searchParams.get("state")}`, { headers: { cookie: `mcp_key=${tmp}` }, ...noFollow });
  return { start, loc, tmp, cb, key: cookieOf(cb) };
}

before(async () => {
  up = await startUpstream();
  // Le mode mock n'existe pas en production : la suite s'exécute en pré-prod, le verrou de production est testé à part.
  hub = await startHub({ upstreamUrl: up.url, env: { APP_ENV: "preprod", SSO_MODE: "mock" } });
});
after(async () => { await hub?.stop(); await up?.stop(); });

test("SSO actif : un anonyme n'obtient ni clé ni liste des systèmes ; portail, flux OAuth des systèmes et /mcp lui sont fermés", async () => {
  const r = await fetch(`${hub.url}/api/me`);
  assert.equal(r.headers.get("set-cookie"), null, "aucune clé créée pour un anonyme");
  const body = await r.json();
  assert.deepEqual(body, { version: body.version, env: "PRE-PROD", instance: "", sso: "mock", email: null, key: null, systems: [] });
  assert.equal((await fetch(`${hub.url}/api/test/sagex3`)).status, 401);
  assert.equal((await fetch(`${hub.url}/auth/salesforce`, noFollow)).status, 400, "pas de flux OAuth système sans identité");
  assert.equal((await mcpPost()).status, 401);
  // Clé temporaire posée au départ du SSO : inutilisable tant que l'identité n'est pas liée
  const start = await fetch(`${hub.url}/auth/sso`, noFollow);
  const tmp = cookieOf(start);
  assert.ok(tmp, "clé temporaire posée pour lier le retour du navigateur");
  assert.equal((await mcpPost(tmp)).status, 401);
  assert.equal((await me(tmp)).key, null);
  assert.equal((await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie: `mcp_key=${tmp}` }, ...noFollow })).status, 400);
  assert.match(hub.logs(), /SSO mock/);
});

let marie, paul;
test("Connexion SSO : redirection Entra (S256, openid profile email, sans prompt), callback → identité liée à une clé fraîche, puis SharePoint tenté sans interaction", async () => {
  up.reset();
  const { loc, tmp, cb, key } = await sso(null, { code: "marie" });
  assert.equal(loc.pathname, "/ms/common/oauth2/v2.0/authorize");
  assert.equal(loc.searchParams.get("scope"), "openid profile email", "le SSO ne demande aucune permission Graph");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(loc.searchParams.get("redirect_uri"), `${hub.url}/auth/sso/callback`);
  assert.equal(loc.searchParams.get("prompt"), null);
  assert.equal(cb.status, 302, await cb.text());
  assert.equal(cb.headers.get("location"), "/auth/sharepoint?silent=1");
  assert.ok(key && key !== tmp, "première identité : clé fraîche, jamais celle que le navigateur portait avant l'authentification");
  assert.equal(hub.readUsers()[tmp], undefined); assert.equal((await mcpPost(tmp)).status, 401, "la clé temporaire est morte");
  marie = key;
  const tok = up.requests("/oauth2/v2.0/token", "POST")[0];
  assert.ok(tok.body.includes("code_verifier=") && tok.body.includes("client_secret=ms-client-secret"), tok.body);
  const m = await me(marie);
  assert.equal(m.sso, "mock"); assert.equal(m.email, "marie@charlois.example"); assert.equal(m.key, marie); assert.equal(m.systems.length, 5);
  const u = hub.readUsers()[marie];
  assert.deepEqual([u.sso.sub, u.sso.tid, u.sso.upn, u.sso.name], ["oid-marie", "common", "marie@charlois.example", "Marie"]);
  assert.ok(!JSON.stringify(u).includes("ms-token-") && !JSON.stringify(u).includes("ms-refresh-"), "aucun jeton SSO conservé");
  assert.ok((await listTools(marie)).includes("sagex3_query"), "la clé liée sert les clients MCP");

  // Connexion SharePoint silencieuse : prompt=none + login_hint, puis jetons Graph délégués stockés comme pour le bouton
  const sp = await fetch(`${hub.url}/auth/sharepoint?silent=1`, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  const spLoc = new URL(sp.headers.get("location"));
  assert.equal(spLoc.searchParams.get("prompt"), "none"); assert.equal(spLoc.searchParams.get("login_hint"), "marie@charlois.example");
  assert.equal(spLoc.searchParams.get("scope"), "openid offline_access User.Read Files.Read.All Sites.Read.All");
  const spCb = await fetch(`${hub.url}/auth/sharepoint/callback?code=marie&state=${spLoc.searchParams.get("state")}`, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  assert.equal(spCb.status, 302); assert.equal(spCb.headers.get("location"), "/");
  assert.equal(hub.readUsers()[marie].sharepoint.access_token, "ms-token-marie");
  assert.equal(hub.readUsers()[marie].sharepoint.id_token, undefined, "l'id_token SharePoint n'est pas conservé"); assert.equal(hub.readUsers()[marie].sso.sub, "oid-marie", "le flux SharePoint ne touche pas l'identité");
  assert.ok((await me(marie)).systems.find((s) => s.id === "sharepoint").connected);
  // Déjà connecté à SharePoint : un nouveau SSO revient directement au portail
  assert.equal((await sso(marie, { code: "marie" })).cb.headers.get("location"), "/");
});

test("SharePoint silencieux refusé par Entra (consent_required) : retour au portail sans erreur ni jeton ; le parcours interactif reste disponible", async () => {
  const { key: p } = await sso(null, { code: "paul" }); paul = p;
  assert.ok(paul && paul !== marie);
  const sp = await fetch(`${hub.url}/auth/sharepoint?silent=1`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  const spLoc = new URL(sp.headers.get("location"));
  const cb = await fetch(`${hub.url}/auth/sharepoint/callback?error=consent_required&state=${spLoc.searchParams.get("state")}`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(cb.status, 302); assert.equal(cb.headers.get("location"), "/");
  assert.equal(hub.readUsers()[paul].sharepoint, undefined);
  const interactive = await fetch(`${hub.url}/auth/sharepoint`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(new URL(interactive.headers.get("location")).searchParams.get("prompt"), null, "sans silent=1 : flux interactif habituel");
  // Un refus explicite hors mode silencieux reste une erreur visible
  const denied = await fetch(`${hub.url}/auth/sharepoint/callback?error=access_denied&state=${new URL(interactive.headers.get("location")).searchParams.get("state")}`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(denied.status, 400);
});

test("Identité ↔ clé : la même identité retrouve sa clé depuis un autre navigateur ; une autre identité a une autre clé et ne voit pas ses connexions ; poste partagé sans mélange", async () => {
  // Marie enregistre un jeton Sage X3 ; Paul ne le voit pas
  const r = await fetch(`${hub.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie: `mcp_key=${marie}`, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "SYR-MARIE" }) });
  assert.equal(r.status, 204);
  assert.equal((await me(marie)).systems.find((s) => s.id === "sagex3").connected, true);
  assert.equal((await me(paul)).systems.find((s) => s.id === "sagex3").connected, false);
  const diag = await fetch(`${hub.url}/api/test/sagex3`, { headers: { cookie: `mcp_key=${paul}` } }).then((x) => x.json());
  assert.equal(diag.ok, false); assert.match(diag.error, /Non connecté à Sage X3/);

  // Marie depuis un navigateur vierge : même clé, la clé temporaire de ce navigateur disparaît
  const again = await sso(null, { code: "marie" });
  assert.equal(again.key, marie); assert.notEqual(again.tmp, marie);
  assert.equal((await me(again.tmp)).key, null); assert.equal(hub.readUsers()[again.tmp], undefined);
  assert.equal(hub.readUsers()[marie].sagex3.apiKey, "SYR-MARIE", "ses jetons sont intacts");

  // Poste partagé : Paul se connecte dans le navigateur de Marie → la clé de Paul, celle de Marie et ses jetons restent intacts
  const shared = await sso(marie, { code: "paul" });
  assert.equal(shared.key, paul);
  assert.equal(hub.readUsers()[marie].sso.sub, "oid-marie"); assert.equal(hub.readUsers()[marie].sagex3.apiKey, "SYR-MARIE");
  // Nouvelle identité dans un navigateur déjà lié à Marie : clé neuve, jamais la sienne
  const third = await sso(marie, { code: "jean" });
  assert.ok(third.key && ![marie, paul].includes(third.key));
  assert.equal(hub.readUsers()[third.key].sso.sub, "oid-jean"); assert.equal(hub.readUsers()[marie].sso.sub, "oid-marie");
  assert.equal(Object.values(hub.readUsers()).filter((u) => u.sso).length, 3);
});

test("Usurpation : id_token d'un autre locataire, d'une autre application, d'un autre émetteur ou expiré → 400 sans clé ; state d'un autre navigateur → 400", async () => {
  for (const flaw of ["tid", "aud", "iss", "exp"]) {
    const { cb, key, tmp } = await sso(null, { code: `eve:${flaw}` });
    assert.equal(cb.status, 400, `${flaw} : ${await cb.text()}`);
    assert.equal(key, undefined, `${flaw} : aucune clé posée`);
    assert.equal((await me(tmp)).key, null);
  }
  assert.ok(!Object.values(hub.readUsers()).some((u) => u.sso?.sub === "oid-eve"), "Eve n'existe pas dans le store");
  for (const s of ["evil.example", "other-tenant", "other-app"]) assert.ok(!hub.logs().includes(s), "rien du jeton n'est journalisé");
  const noid = await sso(null, { code: "eve:noid" }); assert.equal(noid.cb.status, 400, "revendications absentes → 400"); assert.equal(noid.key, undefined);
  // State lancé par un navigateur, callback présenté par un autre
  const start = await fetch(`${hub.url}/auth/sso`, noFollow);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const other = await fetch(`${hub.url}/auth/sso/callback?code=marie&state=${state}`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(other.status, 400); assert.equal(cookieOf(other), undefined);
  assert.equal(hub.readUsers()[paul].sso.sub, "oid-paul", "Paul n'a pas été relié à Marie");
  assert.equal((await fetch(`${hub.url}/auth/sso/callback?code=marie&state=inconnu`, noFollow)).status, 400, "state inconnu");
});

test("Révocation : régénérer la clé rend l'ancienne inutilisable (portail et /mcp), la nouvelle porte identité et jetons ; se déconnecter efface le cookie sans révoquer", async () => {
  const evil = await fetch(`${hub.url}/api/key/rotate`, { method: "POST", headers: { cookie: `mcp_key=${marie}`, Origin: "https://evil.charlois.example" } });
  assert.equal(evil.status, 403, "formulaire d'un site frère : refusé"); assert.equal((await me(marie)).key, marie);
  const r = await fetch(`${hub.url}/api/key/rotate`, { method: "POST", headers: { cookie: `mcp_key=${marie}`, Origin: hub.url } });
  assert.equal(r.status, 200);
  const fresh = (await r.json()).key;
  assert.ok(fresh && fresh !== marie); assert.equal(cookieOf(r), fresh);
  assert.equal((await mcpPost(marie)).status, 401, "ancienne clé refusée par les clients MCP");
  assert.equal((await me(marie)).key, null, "ancienne clé refusée par le portail");
  assert.equal((await fetch(`${hub.url}/api/key/rotate`, { method: "POST", headers: { cookie: `mcp_key=${marie}` } })).status, 401);
  const m = await me(fresh);
  assert.equal(m.email, "marie@charlois.example"); assert.equal(m.systems.find((s) => s.id === "sagex3").connected, true);
  assert.ok((await listTools(fresh)).length > 0);
  assert.equal(hub.readUsers()[marie], undefined); assert.equal(hub.readUsers()[fresh].sso.sub, "oid-marie");
  marie = fresh;
  assert.equal((await sso(null, { code: "marie" })).key, marie, "le SSO retrouve la nouvelle clé");

  const out = await fetch(`${hub.url}/api/logout`, { method: "POST", headers: { cookie: `mcp_key=${marie}` } });
  assert.equal(out.status, 200); assert.match(out.headers.get("set-cookie"), /^mcp_key=; .*Max-Age=0$/);
  const next = new URL((await out.json()).next);
  assert.equal(next.pathname, "/ms/common/oauth2/v2.0/logout", "le portail enchaîne sur la déconnexion Microsoft"); assert.equal(next.searchParams.get("post_logout_redirect_uri"), `${hub.url}/?sso=off`);
  assert.equal((await mcpPost(marie)).status, 200, "la clé reste valide pour les clients MCP");
});

test("Verrous de démarrage : mock interdit en production ; entra exige login.microsoftonline.com, un ID de locataire (GUID) et l'application ; valeur inconnue refusée", async () => {
  const refuse = async (env, re) => {
    await assert.rejects(startHub({ upstreamUrl: up.url, env: { APP_ENV: "preprod", ...env } }), re);
  };
  await refuse({ APP_ENV: "production", SSO_MODE: "mock" }, /SSO_MODE=mock est interdit en production/);
  await refuse({ SSO_MODE: "entra" }, /exige MS_LOGIN_URL vide/); // MS_LOGIN_URL pointe vers le mock
  await refuse({ SSO_MODE: "entra", MS_LOGIN_URL: "https://login.microsoftonline.com" }, /ID de l'annuaire \(GUID\), jamais common/);
  await refuse({ SSO_MODE: "entra", MS_LOGIN_URL: "https://login.microsoftonline.com", MS_TENANT_ID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", MS_CLIENT_SECRET: "" }, /exige MS_TENANT_ID, MS_CLIENT_ID et MS_CLIENT_SECRET/);
  await refuse({ SSO_MODE: "mock", MS_LOGIN_URL: "https://login.microsoftonline.com" }, /jamais login\.microsoftonline\.com/);
  await refuse({ SSO_MODE: "mock", MS_TENANT_ID: "" }, /exige MS_TENANT_ID/);
  await refuse({ SSO_MODE: "oauth2-proxy" }, /SSO_MODE doit être vide, mock ou entra/);
  // Mode entra correctement configuré : démarre, et /auth/sso part bien vers Microsoft avec le locataire
  const h = await startHub({ upstreamUrl: up.url, env: { APP_ENV: "preprod", SSO_MODE: "entra", MS_LOGIN_URL: "https://login.microsoftonline.com", MS_TENANT_ID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" } });
  try {
    const r = await fetch(`${h.url}/auth/sso`, noFollow);
    const loc = new URL(r.headers.get("location"));
    assert.equal(loc.origin + loc.pathname, "https://login.microsoftonline.com/3f2504e0-4f89-11d3-9a0c-0305e82c3301/oauth2/v2.0/authorize");
    assert.equal(loc.searchParams.get("client_id"), "ms-client-id");
    assert.match(h.logs(), /SSO entra/);
  } finally { await h.stop(); }
});

// ---------------------------------------------------------------- cloisonnement des clés entre collaborateurs
/** Flux SSO où le code est émis par la page d'autorisation du mock (PKCE S256 vérifié au /token), comme chez Entra. */
async function ssoViaAuthorize(browserKey, who, { cookieForCallback, stateFrom } = {}) {
  const start = await fetch(`${hub.url}/auth/sso`, { headers: browserKey ? { cookie: `mcp_key=${browserKey}` } : {}, ...noFollow });
  const tmp = cookieOf(start) ?? browserKey, loc = new URL(start.headers.get("location"));
  loc.searchParams.set("mock_user", who);
  const issued = new URL((await fetch(loc, noFollow)).headers.get("location")); // le mock renvoie vers /auth/sso/callback?code=&state=
  if (stateFrom) issued.searchParams.set("state", stateFrom);
  const cb = await fetch(issued, { headers: { cookie: `mcp_key=${cookieForCallback ?? tmp}` }, ...noFollow });
  return { tmp, code: issued.searchParams.get("code"), state: issued.searchParams.get("state"), cb, key: cookieOf(cb) };
}

test("Cloisonnement : Marie ne peut pas obtenir la clé de Paul en manipulant cookies, states, codes ou sessions, et inversement", async () => {
  const mk = await me(marie), pk = await me(paul);
  assert.equal(mk.key, marie); assert.equal(pk.key, paul);
  // 1. L'API ne révèle jamais la clé ni l'identité d'un autre : chaque réponse ne contient que la clé de l'appelant
  for (const [mine, other] of [[mk, paul], [pk, marie]]) assert.ok(!JSON.stringify(mine).includes(other), "la clé d'un autre n'apparaît jamais dans /api/me");
  assert.ok(!JSON.stringify(mk).includes("paul@") && !JSON.stringify(pk).includes("marie@"));
  // 2. Cookie manipulé : clé voisine, clé vide, nom de propriété spécial → aucune session, aucune clé posée
  for (const forged of [paul.slice(0, -1) + (paul.endsWith("a") ? "b" : "a"), "", "__proto__", "constructor", encodeURIComponent(paul + " ")]) {
    const r = await fetch(`${hub.url}/api/me`, { headers: { cookie: `mcp_key=${forged}` } });
    assert.equal((await r.json()).key, null, `cookie ${forged.slice(0, 12)}…`); assert.equal(r.headers.get("set-cookie"), null);
    assert.equal((await mcpPost(forged)).status, 401);
  }
  // 3. Rejeu d'un callback : un state consommé est mort, même pour le bon navigateur
  const first = await ssoViaAuthorize(null, "marie");
  assert.equal(first.key, marie);
  const replay = await fetch(`${hub.url}/auth/sso/callback?code=${first.code}&state=${first.state}`, { headers: { cookie: `mcp_key=${first.tmp}` }, ...noFollow });
  assert.equal(replay.status, 400); assert.equal(cookieOf(replay), undefined);
  // 4. Code volé : Paul lance un SSO ; Marie présente son code (et son state) avec son propre cookie → state lié au navigateur de Paul
  const paulStart = await fetch(`${hub.url}/auth/sso`, noFollow);
  const paulLoc = new URL(paulStart.headers.get("location")); paulLoc.searchParams.set("mock_user", "paul");
  const paulIssued = new URL((await fetch(paulLoc, noFollow)).headers.get("location"));
  const steal = await fetch(paulIssued, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  assert.equal(steal.status, 400); assert.equal(cookieOf(steal), undefined);
  // 5. Code volé, state propre : Marie lance son SSO et échange le code de Paul → PKCE refuse (code_verifier d'un autre départ), rien ne change
  const marieStart = await fetch(`${hub.url}/auth/sso`, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  const marieState = new URL(marieStart.headers.get("location")).searchParams.get("state");
  up.reset();
  const swap = await fetch(`${hub.url}/auth/sso/callback?code=${paulIssued.searchParams.get("code")}&state=${marieState}`, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  assert.equal(swap.status, 502, await swap.text()); assert.equal(cookieOf(swap), undefined);
  assert.ok(up.requests("/oauth2/v2.0/token", "POST").length === 1, "l'échange a bien été tenté et refusé par le fournisseur");
  assert.equal(hub.readUsers()[marie].sso.sub, "oid-marie"); assert.equal(hub.readUsers()[paul].sso.sub, "oid-paul");
  assert.equal((await me(marie)).key, marie, "Marie garde sa clé, n'a pas celle de Paul");
  // 6. Session SSE de Paul : la clé de Marie ne peut pas y poster (403)
  const ac = new AbortController();
  const sse = await fetch(`${hub.url}/sse`, { headers: { Authorization: `Bearer ${paul}` }, signal: ac.signal });
  const reader = sse.body.getReader(); let buf = "";
  while (!/sessionId=/.test(buf)) buf += new TextDecoder().decode((await reader.read()).value);
  const sessionId = buf.match(/sessionId=([\w-]+)/)[1];
  const post = (k) => fetch(`${hub.url}/messages?sessionId=${sessionId}`, { method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.equal((await post(marie)).status, 403); assert.equal((await post(paul)).status, 202);
  ac.abort();
  // 7. Rotation : Paul régénère sa clé, celle de Marie est intacte ; l'ancienne clé de Paul ne donne rien à personne
  const rot = await fetch(`${hub.url}/api/key/rotate`, { method: "POST", headers: { cookie: `mcp_key=${paul}` } }).then((r) => r.json());
  assert.equal((await me(paul)).key, null); assert.equal((await me(marie)).key, marie);
  assert.equal((await me(rot.key)).email, "paul@charlois.example");
  paul = rot.key;
  // 8. Aucune clé dans les journaux du hub
  for (const k of [marie, paul, rot.key, first.tmp]) assert.ok(!hub.logs().includes(k), "clé absente des journaux");
});

test("Poste partagé : fixation de session impossible, clé antérieure au SSO jamais reprise, jetons d'un autre compte Microsoft jamais liés", async () => {
  // 1. Fixation : l'attaquant lit la clé temporaire posée par un départ SSO abandonné ; la victime s'authentifie ensuite sur ce navigateur
  const start = await fetch(`${hub.url}/auth/sso`, noFollow);
  const known = cookieOf(start), state = new URL(start.headers.get("location")).searchParams.get("state");
  const victim = await fetch(`${hub.url}/auth/sso/callback?code=lea&state=${state}`, { headers: { cookie: `mcp_key=${known}` }, ...noFollow });
  assert.equal(victim.status, 302); assert.ok(cookieOf(victim) && cookieOf(victim) !== known, "la victime reçoit une clé fraîche");
  assert.equal((await mcpPost(known)).status, 401, "la clé connue de l'attaquant ne donne rien"); assert.equal(hub.readUsers()[known], undefined);
  // 2. Clé antérieure au SSO portant les jetons d'un autre : jamais adoptée, supprimée avec ses jetons
  const { connectedUser, KEY } = await import("./helpers/hub.js");
  const h = await startHub({ upstreamUrl: up.url, users: { [KEY]: connectedUser(up.url) }, env: { APP_ENV: "preprod", SSO_MODE: "mock" } });
  try {
    assert.equal((await fetch(`${h.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: "{}" })).status, 401, "clé sans identité inutilisable dès l'activation du SSO");
    const s = await fetch(`${h.url}/auth/sso`, { headers: { cookie: `mcp_key=${KEY}` }, ...noFollow });
    const st = new URL(s.headers.get("location")).searchParams.get("state");
    const cb = await fetch(`${h.url}/auth/sso/callback?code=alice&state=${st}`, { headers: { cookie: `mcp_key=${KEY}` }, ...noFollow });
    const fresh = cookieOf(cb);
    assert.ok(fresh && fresh !== KEY, "clé fraîche, pas la clé héritée");
    const users = h.readUsers();
    assert.equal(users[KEY], undefined, "la clé héritée et ses jetons disparaissent");
    assert.equal(users[fresh].sagex3, undefined); assert.equal(users[fresh].salesforce, undefined, "aucun jeton hérité");
    assert.equal(cb.headers.get("location"), "/auth/sharepoint?silent=1");
  } finally { await h.stop(); }
  // 3. SharePoint interactif avec un autre compte Microsoft ouvert dans le navigateur : refusé, rien n'est stocké
  const sp = await fetch(`${hub.url}/auth/sharepoint`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  const spState = new URL(sp.headers.get("location")).searchParams.get("state");
  const other = await fetch(`${hub.url}/auth/sharepoint/callback?code=marie&state=${spState}`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(other.status, 400, await other.text()); assert.equal(hub.readUsers()[paul].sharepoint, undefined);
  const sp2 = await fetch(`${hub.url}/auth/sharepoint`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  const own = await fetch(`${hub.url}/auth/sharepoint/callback?code=paul&state=${new URL(sp2.headers.get("location")).searchParams.get("state")}`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(own.status, 302); assert.equal(hub.readUsers()[paul].sharepoint.access_token, "ms-token-paul");
  // 4. Les clés temporaires des départs abandonnés ne sont jamais écrites sur le disque
  assert.ok(Object.values(hub.readUsers()).every((u) => u.sso), "users.json ne contient que des collaborateurs identifiés");
});
