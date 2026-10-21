// Tests du portail kiosque : page HTML, /api/me (cookie mcp_key), flux OAuth Salesforce et Sage X3
// contre le mock, déconnexion, et cohérence des URL appelées par public/index.html avec les routes du serveur.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, HUB_DIR } from "./helpers/hub.js";

let up, hub, key, cookie;
const noFollow = { redirect: "manual" };

before(async () => {
  up = await startUpstream();
  hub = await startHub({ upstreamUrl: up.url }); // aucun utilisateur : la clé sera créée par /api/me
});
after(async () => { await hub?.stop(); await up?.stop(); });

test("GET / sert le portail HTML", async () => {
  const r = await fetch(`${hub.url}/`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  const html = await r.text();
  assert.match(html, /Finance MCP/);
  assert.match(html, /fetch\("\/api\/me"/);
});

test("GET /api/me sans cookie : pose mcp_key et renvoie {key, mcpUrl, systems[2]}", async () => {
  const r = await fetch(`${hub.url}/api/me`);
  assert.equal(r.status, 200);
  const setCookie = r.headers.get("set-cookie");
  assert.ok(setCookie, "Set-Cookie attendu");
  const m = setCookie.match(/^mcp_key=([^;]+); Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000$/);
  assert.ok(m, `format du cookie : ${setCookie}`);
  assert.ok(!/Secure/.test(setCookie), "pas de Secure en http");
  key = m[1];
  cookie = `mcp_key=${key}`;

  const me = await r.json();
  assert.equal(me.key, key);
  assert.equal(me.email, null);
  assert.equal(me.mcpUrl, `${hub.url}/mcp`);
  assert.equal(me.sseUrl, `${hub.url}/sse`);
  assert.equal(me.systems.length, 2);
  assert.deepEqual(me.systems.map((s) => s.id), ["salesforce", "sagex3"]);
  assert.deepEqual(me.systems.map((s) => s.connected), [false, false]);
  assert.deepEqual(me.systems.map((s) => s.configured), [true, true]);
  assert.deepEqual(me.systems.map((s) => s.schemaAt), [null, null]);
  assert.deepEqual(me.systems.map((s) => s.mock), [false, false]);
  // Configuration masquée : valeurs visibles sauf les *SECRET*
  const cfg = Object.fromEntries(me.config.map((v) => [v.name, v.value]));
  assert.equal(cfg.SF_CLIENT_ID, "sf-client-id");
  assert.equal(cfg.SF_CLIENT_SECRET, "••••••••");
  assert.equal(cfg.SAGE_OAUTH_CLIENT_SECRET, "••••••••");
  assert.equal(cfg.SAGE_FOLDER, "PROD");
  assert.ok(!JSON.stringify(me).includes("sf-client-secret"), "le secret ne doit jamais sortir");
  assert.ok(hub.readUsers()[key], "la clé est persistée dans users.json");
});

test("GET /api/me avec le cookie : même clé, pas de nouveau cookie", async () => {
  const r = await fetch(`${hub.url}/api/me`, { headers: { cookie } });
  assert.equal((await r.json()).key, key);
  assert.equal(r.headers.get("set-cookie"), null);
  // La clé du portail est acceptée par les transports MCP
  const sse = await fetch(`${hub.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
  assert.notEqual(sse.status, 401);
});

test("GET /api/me avec un cookie invalide : nouvelle clé", async () => {
  const r = await fetch(`${hub.url}/api/me`, { headers: { cookie: "mcp_key=inconnue" } });
  const me = await r.json();
  assert.notEqual(me.key, "inconnue");
  assert.match(r.headers.get("set-cookie"), /^mcp_key=/);
});

let state;
test("GET /auth/salesforce : 302 vers SF_LOGIN_URL/services/oauth2/authorize avec state et redirect_uri", async () => {
  const r = await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, `${up.url}/services/oauth2/authorize`);
  assert.equal(loc.searchParams.get("response_type"), "code");
  assert.equal(loc.searchParams.get("client_id"), "sf-client-id");
  assert.equal(loc.searchParams.get("redirect_uri"), `${hub.url}/auth/salesforce/callback`);
  assert.equal(loc.searchParams.get("scope"), "openid api refresh_token");
  state = loc.searchParams.get("state");
  assert.match(state, /^[0-9a-f]{32}$/);

  const noCookie = await fetch(`${hub.url}/auth/salesforce`, noFollow);
  assert.equal(noCookie.status, 400);
  const bogus = await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie: "mcp_key=__proto__" }, ...noFollow });
  assert.equal(bogus.status, 400, "clé inconnue (et pollution de prototype) refusée");
  const unknown = await fetch(`${hub.url}/auth/nope`, { headers: { cookie }, ...noFollow });
  assert.equal(unknown.status, 400);
});

test("Callback /auth/salesforce/callback : échange du code, stockage des jetons + email, redirection /", async () => {
  up.reset();
  // Anti login-CSRF : le callback doit revenir avec le cookie qui a lancé le flux
  const other = await fetch(`${hub.url}/api/me`).then((x) => x.headers.get("set-cookie").split(";")[0]);
  assert.equal((await fetch(`${hub.url}/auth/salesforce/callback?code=abc123&state=${state}`, { headers: { cookie: other }, ...noFollow })).status, 400, "autre cookie → 400");
  assert.equal(up.requests("/services/oauth2/token").length, 0, "aucun échange de code pour un autre navigateur");
  const st2 = new URL((await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie }, ...noFollow })).headers.get("location")).searchParams.get("state");
  assert.equal((await fetch(`${hub.url}/auth/salesforce/callback?code=abc123&state=${st2}`, noFollow)).status, 400, "sans cookie → 400");
  state = new URL((await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie }, ...noFollow })).headers.get("location")).searchParams.get("state");

  const r = await fetch(`${hub.url}/auth/salesforce/callback?code=abc123&state=${state}`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 302, await r.text());
  assert.equal(r.headers.get("location"), "/");

  const tok = up.requests("/services/oauth2/token", "POST");
  assert.equal(tok.length, 1);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(tok[0].body)), {
    client_id: "sf-client-id", client_secret: "sf-client-secret",
    grant_type: "authorization_code", code: "abc123", redirect_uri: `${hub.url}/auth/salesforce/callback`,
  });
  const ui = up.requests("/services/oauth2/userinfo", "GET");
  assert.equal(ui.length, 1);
  assert.equal(ui[0].headers.authorization, "Bearer sf-token-abc123");

  const u = hub.readUsers()[key];
  assert.equal(u.email, "alice@example.com");
  assert.equal(u.salesforce.access_token, "sf-token-abc123");
  assert.equal(u.salesforce.refresh_token, "sf-refresh-abc123");
  assert.equal(u.salesforce.instance_url, up.url);

  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(me.email, "alice@example.com");
  assert.equal(me.systems[0].connected, true);

  // Le state est à usage unique ; un state inconnu ou un refus OAuth → 400
  assert.equal((await fetch(`${hub.url}/auth/salesforce/callback?code=abc123&state=${state}`, { headers: { cookie }, ...noFollow })).status, 400);
  assert.equal((await fetch(`${hub.url}/auth/salesforce/callback?code=abc123&state=deadbeef`, { headers: { cookie }, ...noFollow })).status, 400);
});

test("Callback : refus OAuth (error=access_denied) → 400, aucun échange de code", async () => {
  up.reset();
  const st = new URL((await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie }, ...noFollow })).headers.get("location")).searchParams.get("state");
  const r = await fetch(`${hub.url}/auth/salesforce/callback?error=access_denied&error_description=Refus&state=${st}`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /Refus/);
  assert.equal(up.requests("/services/oauth2/token").length, 0);
});

test("Callback : échec de l'échange du code → 502", async () => {
  up.reset();
  const st = new URL((await fetch(`${hub.url}/auth/salesforce`, { headers: { cookie }, ...noFollow })).headers.get("location")).searchParams.get("state");
  up.failNext("/services/oauth2/token", 400, { error: "invalid_grant" });
  const r = await fetch(`${hub.url}/auth/salesforce/callback?code=bad&state=${st}`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 502);
  assert.equal(hub.readUsers()[key].salesforce.access_token, "sf-token-abc123", "jetons précédents inchangés");
});

test("Sage X3 : /auth/sagex3 redirige vers SAGE_OAUTH_AUTH_URL ; le callback stocke les jetons et l'email userinfo", async () => {
  up.reset();
  const r = await fetch(`${hub.url}/auth/sagex3`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("location"));
  assert.equal(loc.origin + loc.pathname, `${up.url}/oauth/authorize`);
  assert.equal(loc.searchParams.get("client_id"), "sage-client-id");
  assert.equal(loc.searchParams.get("redirect_uri"), `${hub.url}/auth/sagex3/callback`);
  assert.equal(loc.searchParams.get("scope"), "openid offline_access");

  const cb = await fetch(`${hub.url}/auth/sagex3/callback?code=xyz&state=${loc.searchParams.get("state")}`, { headers: { cookie }, ...noFollow });
  assert.equal(cb.status, 302, await cb.text());
  assert.equal(cb.headers.get("location"), "/");
  assert.equal(up.requests("/oauth/token", "POST").length, 1);
  assert.equal(up.requests("/oauth/userinfo", "GET")[0].headers.authorization, "Bearer sage-token-xyz");
  const u = hub.readUsers()[key];
  assert.equal(u.sagex3.access_token, "sage-token-xyz");
  assert.equal(u.sagex3.refresh_token, "sage-refresh-xyz");

  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.deepEqual(me.systems.map((s) => s.connected), [true, true]);
});

test("GET /api/test/:system : voyant vert avec le jeton de l'utilisateur, rouge avec le message d'erreur", async () => {
  up.reset();
  const sf = await fetch(`${hub.url}/api/test/salesforce`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(sf.ok, true, JSON.stringify(sf));
  assert.match(sf.message, /Connecté à .* 14990 \/ 15000/);
  assert.equal(up.requests("/limits")[0].headers.authorization, "Bearer sf-token-abc123");

  const sage = await fetch(`${hub.url}/api/test/sagex3`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(sage.ok, true, JSON.stringify(sage));
  assert.deepEqual(sage.tables, ["BPCUSTOMER", "SINVOICE"]);

  up.failNext("/limits", 403, [{ errorCode: "API_DISABLED_FOR_ORG", message: "API désactivée" }]);
  const ko = await fetch(`${hub.url}/api/test/salesforce`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(ko.ok, false);
  assert.match(ko.error, /Salesforce 403/);

  assert.equal((await fetch(`${hub.url}/api/test/salesforce`)).status, 401, "sans cookie");
  assert.equal((await fetch(`${hub.url}/api/test/nope`, { headers: { cookie } })).status, 404);
});

test("POST /api/disconnect/salesforce retire les jetons Salesforce (et seulement eux)", async () => {
  assert.equal((await fetch(`${hub.url}/api/disconnect/salesforce`, { method: "POST" })).status, 401, "sans cookie");
  assert.equal((await fetch(`${hub.url}/api/disconnect/nope`, { method: "POST", headers: { cookie } })).status, 404);
  const r = await fetch(`${hub.url}/api/disconnect/salesforce`, { method: "POST", headers: { cookie } });
  assert.equal(r.status, 204);
  const u = hub.readUsers()[key];
  assert.equal(u.salesforce, undefined);
  assert.equal(u.sagex3.access_token, "sage-token-xyz");
  assert.equal(u.email, "alice@example.com");
  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.deepEqual(me.systems.map((s) => s.connected), [false, true]);
});

test("index.html : chaque URL appelée (fetch / href) correspond à une route du serveur et répond", async () => {
  const html = readFileSync(join(HUB_DIR, "public", "index.html"), "utf8");
  const systems = ["salesforce", "sagex3"];
  const urls = new Set();
  for (const m of html.matchAll(/fetch\(\s*"([^"]+)"(\s*\+\s*(\w+))?/g)) {
    if (m[3]) systems.forEach((s) => urls.add(m[1] + s)); else urls.add(m[1]);
  }
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const u = m[1];
    if (/^https?:/.test(u)) continue;
    if (/\$\{s\.id\}/.test(u)) systems.forEach((s) => urls.add(u.replace("${s.id}", s))); else urls.add(u);
  }
  assert.ok(urls.has("/api/me") && urls.has("/api/disconnect/salesforce") && urls.has("/auth/salesforce") && urls.has("/api/test/sagex3"), [...urls].join(", "));

  // Routes déclarées dans server.js et oauth.js (app.get/post/all et r.get)
  const src = ["server.js", "oauth.js"].map((f) => readFileSync(join(HUB_DIR, f), "utf8")).join("\n");
  const routes = [...src.matchAll(/\b(?:app|r)\.(get|post|all)\(\s*"([^"]+)"/g)].map((m) => ({ method: m[1], re: new RegExp("^" + m[2].replace(/:\w+/g, "[^/]+") + "$") }));
  for (const u of urls) {
    const path = u.split("?")[0];
    assert.ok(routes.some((r) => r.re.test(path)), `aucune route déclarée pour ${u}`);
    const method = /disconnect/.test(path) ? "POST" : "GET";
    const r = await fetch(`${hub.url}${u}`, { method, headers: { cookie }, ...noFollow });
    assert.ok(r.status < 400, `${method} ${u} → ${r.status}`);
  }
});

// ---------------------------------------------------------------- mode simulé Sage X3 (SAGE_URL vide)
test("Mode simulé Sage X3 : sans compte ni jeton, le diagnostic est vert et liste YFAC, YCLIENT, ZVENTE ; les outils MCP répondent", async () => {
  up.reset();
  const sim = await startHub({ upstreamUrl: up.url, env: { SAGE_URL: "" } });
  try {
    const c = `mcp_key=${(await fetch(`${sim.url}/api/me`).then((x) => x.json())).key}`;
    const me = await fetch(`${sim.url}/api/me`, { headers: { cookie: c } }).then((x) => x.json());
    assert.equal(me.systems[1].mock, true);
    assert.match(sim.logs(), /mode simulé/);

    const d = await fetch(`${sim.url}/api/test/sagex3`, { headers: { cookie: c } }).then((x) => x.json());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.deepEqual(d.tables, ["YFAC", "YCLIENT", "ZVENTE"]);
    assert.match(d.message, /simulé/);

    const body = (method, params = {}) => JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
    const rpc = (m, p) => fetch(`${sim.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${c.slice(8)}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: body(m, p) }).then((x) => x.text()).then((t) => JSON.parse(t.match(/^data: (.*)$/m)?.[1] ?? t)); // réponse SSE ou JSON
    const fields = JSON.parse((await rpc("tools/call", { name: "sagex3_describe", arguments: { representation: "YFAC" } })).result.content[0].text);
    assert.deepEqual(fields.map((f) => f.name), ["NUM", "BPR", "ACCDAT", "AMTATI"]);
    const rows = JSON.parse((await rpc("tools/call", { name: "sagex3_query", arguments: { representation: "ZVENTE" } })).result.content[0].text);
    assert.equal(rows[0].SOHNUM, "ZV-000123");
    const nope = (await rpc("tools/call", { name: "sagex3_query", arguments: { representation: "SINVOICE" } })).result;
    assert.equal(nope.isError, true, "table inconnue du simulateur");
    assert.equal(up.requests("/api1/").length, 0, "aucun appel amont en mode simulé");
  } finally { await sim.stop(); }
});
