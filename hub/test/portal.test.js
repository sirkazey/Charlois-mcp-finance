// Tests du portail kiosque : page HTML, /api/me (cookie mcp_key), flux OAuth Salesforce et Sage X3
// contre le mock, déconnexion, et cohérence des URL appelées par public/index.html avec les routes du serveur.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startUpstream } from "./helpers/upstream.js";
import { startHub, HUB_DIR, freePort } from "./helpers/hub.js";

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
  assert.match(html, /Charlois AI Gateway/);
  assert.match(html, /ENV: <b/, "badge d'environnement rendu depuis /api/me");
  assert.match(html, /api\("\/api\/me"\)/);
});

test("GET /api/me sans cookie : pose mcp_key et renvoie {key, mcpUrl, systems[5]}", async () => {
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
  assert.match(me.version, /^\d+\.\d+\.\d+$/, "version stricte");
  assert.equal(me.env, process.env.APP_ENV === "production" ? "PRODUCTION" : "PRE-PROD");
  assert.equal(me.key, key);
  assert.equal(me.email, null);
  assert.equal(me.mcpUrl, `${hub.url}/mcp`);
  assert.equal(me.systems.length, 5);
  assert.deepEqual(me.systems.map((s) => s.id), ["salesforce", "sagex3", "sharepoint", "dropbox", "myreport"]);
  assert.deepEqual(me.systems.map((s) => s.connected), [false, false, false, false, false]);
  assert.deepEqual(me.systems.map((s) => s.configured), [true, true, true, true, false]);
  assert.deepEqual(me.systems.map((s) => s.oauth), [true, true, true, true, false], "MyReport : jeton personnel, pas d'OAuth");
  assert.deepEqual(me.systems.map((s) => s.mock), [false, false, false, false, false]);
  assert.deepEqual(me.systems[4].apiKey, { mode: "bearer", label: "jeton personnel MyReport Server" });
  // Configuration masquée : valeurs visibles sauf les *SECRET*
  const cfg = Object.fromEntries(me.config.map((v) => [v.name, v.value]));
  assert.equal(cfg.SF_CLIENT_ID, "sf-client-id");
  assert.equal(cfg.SF_CLIENT_SECRET, "••••••••");
  assert.equal(cfg.SAGE_OAUTH_CLIENT_SECRET, "••••••••");
  assert.equal(cfg.SAGE_FOLDER, "PROD");
  assert.ok(!JSON.stringify(me).includes("sf-client-secret"), "le secret ne doit jamais sortir");
  assert.equal(hub.readUsers()[key], undefined, "une clé sans jeton n'est pas écrite sur disque");
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
  assert.equal(loc.searchParams.get("scope"), "mcp_api refresh_token");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256"); assert.match(loc.searchParams.get("code_challenge"), /^[\w-]{43}$/, "PKCE");
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
  state = st2; // l'appel étranger n'a pas consommé le state : le vrai navigateur peut encore terminer son flux

  const r = await fetch(`${hub.url}/auth/salesforce/callback?code=abc123&state=${state}`, { headers: { cookie }, ...noFollow });
  assert.equal(r.status, 302, await r.text());
  assert.equal(r.headers.get("location"), "/");

  const tok = up.requests("/services/oauth2/token", "POST");
  assert.equal(tok.length, 1);
  const exch = Object.fromEntries(new URLSearchParams(tok[0].body));
  assert.match(exch.code_verifier, /^[\w-]{43}$/, "PKCE code_verifier"); delete exch.code_verifier;
  assert.deepEqual(exch, {
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
  assert.deepEqual(me.systems.map((s) => s.connected), [true, true, false, false, false]);
  assert.equal((await fetch(`${hub.url}/auth/myreport`, { headers: { cookie }, ...noFollow })).status, 400, "pas de flux OAuth pour MyReport");
});

test("SharePoint et Dropbox : OAuth utilisateur (Entra avec scopes délégués lecture, Dropbox avec token_access_type=offline), callbacks et identité", async () => {
  up.reset();
  const sp = new URL((await fetch(`${hub.url}/auth/sharepoint`, { headers: { cookie }, ...noFollow })).headers.get("location"));
  assert.equal(sp.origin + sp.pathname, `${up.url}/ms/common/oauth2/v2.0/authorize`);
  assert.equal(sp.searchParams.get("scope"), "openid offline_access User.Read Files.Read.All Sites.Read.All");
  const spCb = await fetch(`${hub.url}/auth/sharepoint/callback?code=sp1&state=${sp.searchParams.get("state")}`, { headers: { cookie }, ...noFollow });
  assert.equal(spCb.status, 302, await spCb.text());
  assert.equal(up.requests("/v1.0/me")[0].headers.authorization, "Bearer ms-token-sp1");

  const dbx = new URL((await fetch(`${hub.url}/auth/dropbox`, { headers: { cookie }, ...noFollow })).headers.get("location"));
  assert.equal(dbx.origin + dbx.pathname, "https://www.dropbox.com/oauth2/authorize");
  assert.equal(dbx.searchParams.get("token_access_type"), "offline", "refresh_token Dropbox");
  assert.equal(dbx.searchParams.get("scope"), "account_info.read files.metadata.read files.content.read sharing.read");
  const dbxCb = await fetch(`${hub.url}/auth/dropbox/callback?code=d1&state=${dbx.searchParams.get("state")}`, { headers: { cookie }, ...noFollow });
  assert.equal(dbxCb.status, 302, await dbxCb.text());
  assert.ok(up.requests("/dropbox-mcp", "POST").every((r) => r.headers.authorization === "Bearer dbx-token-d1"), "identité via who_am_i avec le jeton de l'utilisateur");

  const u = hub.readUsers()[key];
  assert.deepEqual([u.sharepoint.access_token, u.sharepoint.refresh_token, u.dropbox.access_token, u.dropbox.refresh_token], ["ms-token-sp1", "ms-refresh-sp1", "dbx-token-d1", "dbx-refresh-d1"]);
  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.deepEqual(me.systems.map((s) => s.connected), [true, true, true, true, false]);

  // Diagnostic : voyants verts avec le jeton de chacun
  const t1 = await fetch(`${hub.url}/api/test/sharepoint`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(t1.ok, true, JSON.stringify(t1)); assert.match(t1.message, /Alice Martin/);
  const t2 = await fetch(`${hub.url}/api/test/dropbox`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(t2.ok, true, JSON.stringify(t2)); assert.deepEqual(t2.tables, ["who_am_i", "list_folder", "file_preview"], "delete exclu de la liste blanche");
});

test("GET /api/test/:system : voyant vert avec le jeton de l'utilisateur, rouge avec le message d'erreur", async () => {
  up.reset();
  const sf = await fetch(`${hub.url}/api/test/salesforce`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(sf.ok, true, JSON.stringify(sf));
  assert.match(sf.message, /Connecté au serveur MCP Salesforce .* 3 outils en lecture seule/);
  assert.deepEqual(sf.tables, ["list_sobjects", "describe_sobject", "query_records"]);
  assert.ok(up.requests("/sobject-reads", "POST").every((q) => q.headers.authorization === "Bearer sf-token-abc123"));

  const sage = await fetch(`${hub.url}/api/test/sagex3`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(sage.ok, true, JSON.stringify(sage));
  assert.deepEqual(sage.tables, ["BPCUSTOMER", "SINVOICE"]);

  up.failNext("/sobject-reads", 403, { errors: [{ message: "MCP server inactive" }] });
  const ko = await fetch(`${hub.url}/api/test/salesforce`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(ko.ok, false);
  assert.match(ko.error, /Salesforce MCP/);

  assert.equal((await fetch(`${hub.url}/api/test/salesforce`)).status, 401, "sans cookie");
  assert.equal((await fetch(`${hub.url}/api/test/nope`, { headers: { cookie } })).status, 404);
});

test("Clé d'API Syracuse : POST /api/sagex3/apikey remplace OAuth, l'état passe à connecté (apikey), la clé part en Bearer", async () => {
  assert.equal((await fetch(`${hub.url}/api/sagex3/apikey`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401, "sans cookie");
  assert.equal((await fetch(`${hub.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "  " }) })).status, 400, "clé vide");

  const r = await fetch(`${hub.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "syr-key-alice", login: "ALICE" }) });
  assert.equal(r.status, 204);
  const u = hub.readUsers()[key];
  assert.deepEqual(Object.keys(u.sagex3).sort(), ["apiKey", "login", "updatedAt"], "la clé remplace les jetons OAuth précédents");
  assert.equal(u.sagex3.apiKey, "syr-key-alice");
  assert.equal(u.salesforce.access_token, "sf-token-abc123", "Salesforce intact");

  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.deepEqual([me.systems[1].connected, me.systems[1].method, me.systems[1].apiKey.mode], [true, "apikey", "bearer"]);
  assert.equal((await fetch(`${hub.url}/api/salesforce/apikey`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "x" }) })).status, 404, "pas de jeton personnel pour Salesforce");
  assert.equal((await fetch(`${hub.url}/api/myreport/apikey`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "mr-token-alice" }) })).status, 204);
  const t = await fetch(`${hub.url}/api/test/myreport`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(t.ok, true, JSON.stringify(t)); assert.match(t.message, /Proxy SSE connecté/);
  assert.ok(!JSON.stringify(me).includes("syr-key-alice"), "la clé n'est jamais renvoyée au navigateur");

  up.reset();
  const d = await fetch(`${hub.url}/api/test/sagex3`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.match(d.message, /clé d'API \(bearer\)/);
  assert.ok(up.requests("$prototypes").every((q) => q.headers.authorization === "Bearer syr-key-alice"));

  // Une clé révoquée : voyant rouge « Sage X3 401 », aucun refresh OAuth tenté (le diagnostic relit la structure, jamais le cache)
  up.reset();
  up.failNext("$prototypes", 401);
  const ko = await fetch(`${hub.url}/api/test/sagex3`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(ko.ok, false, JSON.stringify(ko)); assert.match(ko.error, /Sage X3 401/);
  assert.equal(up.requests("/oauth/token").length, 0);
  const again = await fetch(`${hub.url}/api/test/sagex3`, { headers: { cookie } }).then((x) => x.json());
  assert.equal(again.ok, true); assert.ok(up.requests("$prototypes").length >= 2, "le second clic interroge encore Sage");
});

test("Clé d'API en mode basic (SAGE_APIKEY_MODE=basic) : Authorization: Basic base64(login:clé)", async () => {
  const basic = await startHub({ upstreamUrl: up.url, env: { SAGE_APIKEY_MODE: "basic" } });
  try {
    const c = `mcp_key=${(await fetch(`${basic.url}/api/me`).then((x) => x.json())).key}`;
    const me = await fetch(`${basic.url}/api/me`, { headers: { cookie: c } }).then((x) => x.json());
    assert.equal(me.systems[1].apiKey.mode, "basic");
    await fetch(`${basic.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "k-bob", login: "BOB" }) });
    up.reset();
    const d = await fetch(`${basic.url}/api/test/sagex3`, { headers: { cookie: c } }).then((x) => x.json());
    assert.equal(d.ok, true, JSON.stringify(d));
    assert.equal(up.requests("$prototypes")[0].headers.authorization, `Basic ${Buffer.from("BOB:k-bob").toString("base64")}`);
  } finally { await basic.stop(); }
});

test("POST /api/disconnect/salesforce retire les jetons Salesforce (et seulement eux)", async () => {
  assert.equal((await fetch(`${hub.url}/api/disconnect/salesforce`, { method: "POST" })).status, 401, "sans cookie");
  assert.equal((await fetch(`${hub.url}/api/disconnect/nope`, { method: "POST", headers: { cookie } })).status, 404);
  const r = await fetch(`${hub.url}/api/disconnect/salesforce`, { method: "POST", headers: { cookie } });
  assert.equal(r.status, 204);
  const u = hub.readUsers()[key];
  assert.equal(u.salesforce, undefined);
  assert.equal(u.sagex3.apiKey, "syr-key-alice");
  assert.equal(u.email, "alice@example.com");
  const me = await fetch(`${hub.url}/api/me`, { headers: { cookie } }).then((x) => x.json());
  assert.deepEqual(me.systems.map((s) => s.connected), [false, true, true, true, true]);
});

test("index.html : chaque URL appelée (fetch / href) correspond à une route du serveur et répond", async () => {
  const html = readFileSync(join(HUB_DIR, "public", "index.html"), "utf8");
  const systems = ["sagex3", "myreport"]; // systèmes acceptant les deux familles de routes (OAuth et jeton)
  const urls = new Set();
  for (const m of html.matchAll(/\bapi\(\s*"([^"]+)"(?:\s*\+\s*\w+(?:\s*\+\s*"([^"]+)")?)?/g)) {
    if (m[0].includes("+")) systems.forEach((s) => urls.add(m[1] + s + (m[2] || ""))); else urls.add(m[1]);
  }
  for (const m of html.matchAll(/href="([^"]+)"/g)) {
    const u = m[1];
    if (/^https?:/.test(u)) continue;
    const dyn = /\$\{(?:esc\()?s\.id\)?\}/; // ${s.id} ou ${esc(s.id)}
    if (dyn.test(u)) ["sagex3", "sharepoint"].forEach((s) => urls.add(u.replace(dyn, s))); else urls.add(u); // href OAuth : systèmes avec OAuth
  }
  assert.ok(urls.has("/api/me") && urls.has("/api/disconnect/sagex3") && urls.has("/auth/sagex3") && urls.has("/api/test/sagex3") && urls.has("/api/myreport/apikey"), [...urls].join(", "));

  // Routes déclarées dans server.js et oauth.js (app.get/post/all et r.get)
  const src = ["server.js", "oauth.js"].map((f) => readFileSync(join(HUB_DIR, f), "utf8")).join("\n");
  const routes = [...src.matchAll(/\b(?:app|r)\.(get|post|all)\(\s*"([^"]+)"/g)].map((m) => ({ method: m[1], re: new RegExp("^" + m[2].replace(/:\w+/g, "[^/]+") + "$") }));
  for (const u of urls) {
    const path = u.split("?")[0];
    assert.ok(routes.some((r) => r.re.test(path)), `aucune route déclarée pour ${u}`);
    const method = /disconnect|apikey/.test(path) ? "POST" : "GET";
    const body = /apikey/.test(path) ? { headers: { cookie, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "k" }) } : { headers: { cookie } };
    const r = await fetch(`${hub.url}${u}`, { method, ...body, ...noFollow });
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
    assert.match(sim.logs(), /Sage X3 simulé/);

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

// ---------------------------------------------------------------- environnements
test("Production : le hub refuse de démarrer avec une PUBLIC_URL non https (hors localhost) ; les logs annoncent version et environnement", async () => {
  await assert.rejects(startHub({ upstreamUrl: up.url, env: { APP_ENV: "production", PUBLIC_URL: "http://hub.example.com" } }), /PUBLIC_URL doit être en https/);
  const prod = await startHub({ upstreamUrl: up.url, env: { APP_ENV: "production", LOG_LEVEL: "info" } }); // PUBLIC_URL http://127.0.0.1 : test local toléré
  try {
    assert.match(prod.logs(), /Hub MCP v\d+\.\d+\.\d+ · ENV: PRODUCTION/);
    const me = await fetch(`${prod.url}/api/me`).then((x) => x.json());
    assert.equal(me.env, "PRODUCTION");
  } finally { await prod.stop(); }
  const dev = await startHub({ upstreamUrl: up.url, env: { APP_ENV: "preprod", LOG_LEVEL: "debug" } });
  try {
    assert.match(dev.logs(), /ENV: PRE-PROD .*logs détaillés/);
  } finally { await dev.stop(); }
});

// ---------------------------------------------------------------- limitation de débit
test("Rate-limiting : 429 après 20 diagnostics par minute et après 20 échecs d'authentification ; un démarrage sans ENCRYPTION_KEY est refusé", async () => {
  const lim = await startHub({ upstreamUrl: up.url });
  try {
    const c = `mcp_key=${(await fetch(`${lim.url}/api/me`).then((x) => x.json())).key}`;
    const codes = [];
    for (let i = 0; i < 21; i++) codes.push((await fetch(`${lim.url}/api/test/sagex3`, { headers: { cookie: c } })).status);
    assert.equal(codes.filter((x) => x === 200).length, 20); assert.equal(codes[20], 429);
    const auth = [];
    for (let i = 0; i < 21; i++) auth.push((await fetch(`${lim.url}/mcp`, { method: "POST", headers: { Authorization: "Bearer mauvaise-cle", "Content-Type": "application/json" }, body: "{}" })).status);
    assert.equal(auth.filter((x) => x === 401).length, 20); assert.equal(auth[20], 429, "force brute sur la clé bloquée");
    const good = await fetch(`${lim.url}/mcp`, { method: "POST", headers: { Authorization: `Bearer ${c.slice(8)}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }) });
    assert.notEqual(good.status, 429, "une clé valide de la même IP n'est jamais freinée");
  } finally { await lim.stop(); }
  await assert.rejects(startHub({ upstreamUrl: up.url, env: { ENCRYPTION_KEY: "" } }), /ENCRYPTION_KEY/);
});

// ---------------------------------------------------------------- système injoignable
test("Système injoignable : le diagnostic nomme le système, l'hôte et la cause réseau", async () => {
  const port = await freePort(); // rien n'écoute sur ce port → ECONNREFUSED (le port 1 est refusé par fetch comme « bad port »)
  const dead = await startHub({ upstreamUrl: up.url, env: { SAGE_URL: `http://127.0.0.1:${port}`, SAGE_APIKEY_MODE: "bearer" } });
  try {
    const c = `mcp_key=${(await fetch(`${dead.url}/api/me`).then((x) => x.json())).key}`;
    await fetch(`${dead.url}/api/sagex3/apikey`, { method: "POST", headers: { cookie: c, "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: "k" }) });
    const d = await fetch(`${dead.url}/api/test/sagex3`, { headers: { cookie: c } }).then((x) => x.json());
    assert.equal(d.ok, false); assert.match(d.error, /^Sage X3 injoignable \(127\.0\.0\.1:\d+\) : ECONNREFUSED/, d.error);
  } finally { await dead.stop(); }
});
