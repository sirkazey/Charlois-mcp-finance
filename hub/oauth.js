// Flux OAuth2 "authorization code" générique + rafraîchissement des jetons.
// Chaque connecteur fournit sa config { authUrl, tokenUrl, clientId, clientSecret, scope }.
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { store } from "./store.js";

export const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, "");
const pending = new Map(); // state -> { key, system, exp }
const redirectUri = (system) => `${PUBLIC_URL}/auth/${system}/callback`;

async function postToken(c, params) {
  const r = await fetch(c.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`OAuth ${c.tokenUrl}: ${r.status} ${JSON.stringify(body)}`);
  return body;
}

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
    const fresh = await postToken(connector.oauth, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    store.setTokens(key, connector.id, fresh);
    return fn({ ...tokens, ...fresh });
  }
}

/** Routes /auth/:system et /auth/:system/callback. `getKey(req)` lit l'identité (cookie) de l'utilisateur. */
export function oauthRouter(connectors, getKey) {
  const r = Router();
  const byId = Object.fromEntries(connectors.map((c) => [c.id, c]));

  r.get("/auth/:system", (req, res) => {
    const c = byId[req.params.system]; const key = getKey(req);
    if (!c?.oauth || !store.get(key)) return res.status(400).send("Système inconnu ou session absente");
    if (!c.oauth.clientId) return res.status(500).send(`${c.label} : OAuth non configuré (variables d'environnement)`);
    for (const [s, p] of pending) if (p.exp < Date.now()) pending.delete(s); // purge des flux abandonnés
    const state = randomBytes(16).toString("hex");
    pending.set(state, { key, system: c.id, exp: Date.now() + 10 * 60_000 });
    const u = new URL(c.oauth.authUrl);
    u.search = new URLSearchParams({ response_type: "code", client_id: c.oauth.clientId, redirect_uri: redirectUri(c.id), scope: c.oauth.scope, state, ...c.oauth.extraAuthParams });
    res.redirect(u);
  });

  r.get("/auth/:system/callback", async (req, res) => {
    const p = pending.get(req.query.state); pending.delete(req.query.state);
    const c = byId[req.params.system];
    // p.key === getKey(req) : le navigateur qui revient doit être celui qui a lancé le flux (anti login-CSRF).
    if (!p || !c?.oauth || p.system !== c.id || p.exp < Date.now() || p.key !== getKey(req)) return res.status(400).send("State OAuth invalide ou expiré");
    if (req.query.error) return res.status(400).send(`Refus OAuth : ${req.query.error_description || req.query.error}`);
    try {
      const tokens = await postToken(c.oauth, { grant_type: "authorization_code", code: req.query.code, redirect_uri: redirectUri(c.id) });
      const email = await c.identity?.(tokens).catch(() => null);
      store.setTokens(p.key, c.id, tokens, email);
      res.redirect("/");
    } catch (e) {
      res.status(502).send(`Échec OAuth ${c.label} : ${e.message}`);
    }
  });
  return r;
}
