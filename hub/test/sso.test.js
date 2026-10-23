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
  assert.deepEqual(body, { version: body.version, env: "PRE-PROD", sso: "mock", email: null, key: null, systems: [] });
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
test("Connexion SSO : redirection Entra (PKCE, openid profile email, sans prompt), callback → identité liée, clé posée, puis SharePoint tenté sans interaction", async () => {
  up.reset();
  const { loc, tmp, cb, key } = await sso(null, { code: "marie" });
  assert.equal(loc.pathname, "/ms/common/oauth2/v2.0/authorize");
  assert.equal(loc.searchParams.get("scope"), "openid profile email", "le SSO ne demande aucune permission Graph");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.equal(loc.searchParams.get("redirect_uri"), `${hub.url}/auth/sso/callback`);
  assert.equal(loc.searchParams.get("prompt"), null);
  assert.equal(cb.status, 302, await cb.text());
  assert.equal(cb.headers.get("location"), "/auth/sharepoint?silent=1");
  assert.equal(key, tmp, "première identité : la clé du navigateur devient la sienne");
  marie = key;
  const tok = up.requests("/oauth2/v2.0/token", "POST")[0];
  assert.ok(tok.body.includes("code_verifier=") && tok.body.includes("client_secret=ms-client-secret"), tok.body);
  const m = await me(marie);
  assert.equal(m.sso, "mock"); assert.equal(m.email, "marie@charlois.example"); assert.equal(m.key, marie); assert.equal(m.systems.length, 5);
  const u = hub.readUsers()[marie];
  assert.deepEqual([u.sso.sub, u.sso.tid, u.sso.upn, u.sso.name], ["oid-marie", "common", "marie@charlois.example", "Marie"]);
  assert.equal(u.sso.access_token, undefined); assert.equal(u.sso.id_token, undefined, "aucun jeton SSO conservé");
  assert.ok((await listTools(marie)).includes("sagex3_query"), "la clé liée sert les clients MCP");

  // Connexion SharePoint silencieuse : prompt=none + login_hint, puis jetons Graph délégués stockés comme pour le bouton
  const sp = await fetch(`${hub.url}/auth/sharepoint?silent=1`, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  const spLoc = new URL(sp.headers.get("location"));
  assert.equal(spLoc.searchParams.get("prompt"), "none"); assert.equal(spLoc.searchParams.get("login_hint"), "marie@charlois.example");
  assert.equal(spLoc.searchParams.get("scope"), "openid offline_access User.Read Files.Read.All Sites.Read.All");
  const spCb = await fetch(`${hub.url}/auth/sharepoint/callback?code=marie&state=${spLoc.searchParams.get("state")}`, { headers: { cookie: `mcp_key=${marie}` }, ...noFollow });
  assert.equal(spCb.status, 302); assert.equal(spCb.headers.get("location"), "/");
  assert.equal(hub.readUsers()[marie].sharepoint.access_token, "ms-token-marie");
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
  assert.ok(!hub.logs().includes("evil.example"), "rien du jeton n'est journalisé");
  // State lancé par un navigateur, callback présenté par un autre
  const start = await fetch(`${hub.url}/auth/sso`, noFollow);
  const state = new URL(start.headers.get("location")).searchParams.get("state");
  const other = await fetch(`${hub.url}/auth/sso/callback?code=marie&state=${state}`, { headers: { cookie: `mcp_key=${paul}` }, ...noFollow });
  assert.equal(other.status, 400); assert.equal(cookieOf(other), undefined);
  assert.equal(hub.readUsers()[paul].sso.sub, "oid-paul", "Paul n'a pas été relié à Marie");
  // Callback d'un connecteur sans login avec un code : jamais d'identité liée (le flux SharePoint ne touche pas u.sso)
  assert.equal((await fetch(`${hub.url}/auth/sso/callback?code=marie&state=inconnu`, noFollow)).status, 400);
});

test("Révocation : régénérer la clé rend l'ancienne inutilisable (portail et /mcp), la nouvelle porte identité et jetons ; se déconnecter efface le cookie sans révoquer", async () => {
  const r = await fetch(`${hub.url}/api/key/rotate`, { method: "POST", headers: { cookie: `mcp_key=${marie}` } });
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
  assert.equal(out.status, 204); assert.match(out.headers.get("set-cookie"), /^mcp_key=; .*Max-Age=0$/);
  assert.equal((await mcpPost(marie)).status, 200, "la clé reste valide pour les clients MCP");
});

test("Verrous de démarrage : mock interdit en production ; entra exige login.microsoftonline.com, un ID de locataire (GUID) et l'application ; valeur inconnue refusée", async () => {
  const refuse = async (env, re) => {
    await assert.rejects(startHub({ upstreamUrl: up.url, env: { APP_ENV: "preprod", ...env } }), re);
  };
  await refuse({ APP_ENV: "production", SSO_MODE: "mock" }, /SSO_MODE=mock est interdit en production/);
  await refuse({ SSO_MODE: "entra" }, /exige MS_LOGIN_URL vide/); // MS_LOGIN_URL pointe vers le mock
  await refuse({ SSO_MODE: "entra", MS_LOGIN_URL: "https://login.microsoftonline.com" }, /ID de l'annuaire \(GUID\), jamais common/);
  await refuse({ SSO_MODE: "entra", MS_LOGIN_URL: "https://login.microsoftonline.com", MS_TENANT_ID: "3f2504e0-4f89-11d3-9a0c-0305e82c3301", MS_CLIENT_SECRET: "" }, /exige MS_CLIENT_ID et MS_CLIENT_SECRET/);
  await refuse({ SSO_MODE: "mock", MS_LOGIN_URL: "https://login.microsoftonline.com" }, /jamais login\.microsoftonline\.com/);
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
