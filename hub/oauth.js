// Flux OAuth2 "authorization code" générique + rafraîchissement des jetons.
// Chaque connecteur fournit sa config { authUrl, tokenUrl, clientId, clientSecret, scope }.
import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { store } from "./store.js";

export const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, "");
const pending = new Map(); // state -> { key, system, exp }
// Pré-prod avec bouchon : le hub joint le bouchon par son nom Docker, le navigateur par localhost. Ex. "http://mcp-stub:4000=>http://localhost:4000".
const [rewriteFrom, rewriteTo] = (process.env.BROWSER_URL_REWRITE || "").split("=>");
const redirectUri = (system) => `${PUBLIC_URL}/auth/${system}/callback`;

async function postToken(c, params) {
  const r = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: c.clientId, ...(c.clientSecret ? { client_secret: c.clientSecret } : {}), ...params }), // secret optionnel (apps PKCE sans secret)
  });
  const body = await r.json().catch(() => ({}));
  // L'erreur ne porte ni l'URL du fournisseur, ni son corps brut, ni rien de la configuration : seulement le statut HTTP et un code court validé (ex. invalid_grant).
  const code = /^[\w.-]{1,40}$/.test(body.error) ? body.error : "erreur";
  if (!r.ok) throw Object.assign(new Error(`Échange de jeton OAuth refusé (${r.status} ${code})`), { status: r.status, code });
  return body;
}
const refreshing = new Map(); // "clé:système" -> promesse de refresh en cours, partagée entre appels concurrents

/** Vrai si l'entrée users.json contient de quoi s'authentifier (jeton OAuth ou clé d'API personnelle). */
export const hasCredential = (t) => !!(t?.access_token || t?.apiKey);

/** Exécute fn(tokens) avec le jeton de l'utilisateur `key`.
 *  Sur 401 avec un refresh_token : renouvelle l'access_token en arrière-plan, le persiste, puis réessaie une fois.
 *  Transparent pour l'utilisateur : il ne se reconnecte que si le refresh_token lui-même est révoqué. */
export async function withToken(connector, key, fn) {
  if (connector.mock) return fn({ access_token: "simulé" });
  const tokens = store.get(key)?.[connector.id];
  if (!hasCredential(tokens)) throw new Error(`Non connecté à ${connector.label}. Ouvrez le portail et cliquez « Se connecter à ${connector.label} ».`);
  try {
    return await fn(tokens);
  } catch (e) {
    if (e.status !== 401 || !tokens.refresh_token) throw e;
    const current = store.get(key)?.[connector.id];
    if (current?.access_token && current.access_token !== tokens.access_token) return fn(current); // déjà rafraîchi par un appel concurrent
    const id = `${key}:${connector.id}`;
    const refresh = refreshing.get(id) ?? postToken(connector.oauth, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })
      .then((fresh) => { store.setTokens(key, connector.id, fresh); return fresh; })
      .catch((re) => {
        if (re.status !== 400 && re.status !== 401) throw re;
        store.clearTokens(key, connector.id); // refresh_token révoqué : l'entrée disparaît, le portail repasse à « non connecté »
        throw new Error(`Session ${connector.label} expirée ou révoquée : reconnectez-vous sur le portail.`);
      })
      .finally(() => refreshing.delete(id));
    refreshing.set(id, refresh);
    return fn({ ...tokens, ...(await refresh) });
  }
}

/** Routes /auth/:system et /auth/:system/callback. `getKey(req)` lit l'identité (cookie) de l'utilisateur. */
export function oauthRouter(connectors, getKey) {
  const r = Router();
  const byId = Object.fromEntries(connectors.map((c) => [c.id, c]));
  r.use((_req, res, next) => { res.type("text/plain"); next(); }); // toute erreur part en texte brut : un paramètre reflété (error_description) ne peut pas devenir du HTML

  r.get("/auth/:system", (req, res) => {
    const c = byId[req.params.system]; const key = getKey(req);
    if (!c?.oauth || !store.get(key)) return res.status(400).send("Système inconnu ou session absente");
    if (!c.oauth.clientId) return res.status(500).send(`${c.label} : OAuth non configuré (variables d'environnement)`);
    for (const [s, p] of pending) if (p.exp < Date.now()) pending.delete(s); // purge des flux abandonnés
    const state = randomBytes(16).toString("hex"), verifier = randomBytes(32).toString("base64url"); // PKCE S256 sur tous les flux
    pending.set(state, { key, system: c.id, verifier, exp: Date.now() + 10 * 60_000 });
    const u = new URL(c.oauth.authUrl);
    u.search = new URLSearchParams({ response_type: "code", client_id: c.oauth.clientId, redirect_uri: redirectUri(c.id), scope: c.oauth.scope, state,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", ...c.oauth.extraAuthParams });
    res.redirect(rewriteFrom ? u.href.replace(rewriteFrom, rewriteTo) : u.href);
  });

  r.get("/auth/:system/callback", async (req, res) => {
    const p = pending.get(req.query.state), c = byId[req.params.system];
    // p.key === getKey(req) : le navigateur qui revient doit être celui qui a lancé le flux (anti login-CSRF).
    if (!p || !c?.oauth || p.system !== c.id || p.exp < Date.now() || p.key !== getKey(req)) return res.status(400).send("State OAuth invalide ou expiré");
    pending.delete(req.query.state); // consommé seulement par le bon navigateur ; un appel étranger ne le grille pas
    if (req.query.error) { // rien de ce que renvoie le fournisseur n'est reflété au navigateur ni au journal : vocabulaire fixe
      const denied = req.query.error === "access_denied";
      console.error(`[oauth] ${c.id} ${denied ? "refus de l'utilisateur (access_denied)" : "erreur renvoyée par le fournisseur"}`);
      return res.status(400).send(denied ? "Connexion refusée (access_denied) : réessayez depuis le portail." : "Le fournisseur OAuth a renvoyé une erreur : réessayez depuis le portail ou contactez l'administrateur.");
    }
    try {
      const tokens = await postToken(c.oauth, { grant_type: "authorization_code", code: req.query.code, redirect_uri: redirectUri(c.id), code_verifier: p.verifier });
      const email = c.identity ? await c.identity(tokens).catch(() => null) : null;
      store.setTokens(p.key, c.id, tokens, email);
      res.redirect("/");
    } catch (e) {
      console.error(`[oauth] ${c.id} : échec de l'échange de jeton`); // rien de l'erreur n'est journalisé (le fournisseur peut y glisser des données) ; le statut est rendu au navigateur
      res.status(502).send(`Échec de la connexion ${c.label} (${e.status ?? "réseau"}) : réessayez depuis le portail.`);
    }
  });
  return r;
}
