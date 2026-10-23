// Mires d'authentification du bouchon : OAuth2 "authorization code" avec refresh (Salesforce, Microsoft, Dropbox, IdP de Sage),
// clés d'API / Basic (Sage X3 Syracuse), jeton ou X-Api-Key (MyReport). Les jetons d'accès expirent (TOKEN_TTL_MIN) pour
// exercer le renouvellement automatique du hub ; les refresh tokens n'expirent pas.
import { randomBytes } from "node:crypto";
import { USERS } from "./data.js";

const TTL = Number(process.env.TOKEN_TTL_MIN ?? 10) * 60_000;
const codes = new Map(); // code -> { sys, user, exp }

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const dec = (t) => { try { return JSON.parse(Buffer.from(t, "base64url").toString()); } catch { return null; } };

/** Émet un couple de jetons pour un système et un utilisateur. */
export function issue(sys, user, base) {
  const extra = { sf: { instance_url: base, id: `${base}/id/00D/${user}`, issued_at: String(Date.now()) }, ms: { scope: "User.Read Files.Read.All Sites.Read.All" }, dbx: { account_id: `dbid:${user}`, uid: "1" }, sage: {} }[sys];
  return { access_token: enc({ sys, user, exp: Date.now() + TTL, r: randomBytes(4).toString("hex") }), refresh_token: enc({ sys, user, refresh: true, r: randomBytes(4).toString("hex") }), token_type: "Bearer", expires_in: TTL / 1000, ...extra };
}

/** Utilisateur porté par un jeton d'accès valide pour ce système, sinon null (expiré, autre système, inconnu). */
export const bearerUser = (req, sys) => {
  const t = dec(req.headers.authorization?.match(/^Bearer (.+)$/)?.[1] || "");
  return t && t.sys === sys && !t.refresh && t.exp > Date.now() && USERS[t.user] ? t.user : null;
};

/** Page de connexion simulée : on choisit le collaborateur, le bouchon renvoie un code vers redirect_uri. */
export function authorizePage(sys, label) {
  return (req, res) => {
    const { redirect_uri, state, client_id } = req.query;
    if (!redirect_uri || !client_id) return res.status(400).send("redirect_uri et client_id requis");
    let back; try { back = new URL(String(redirect_uri)); } catch { back = null; }
    if (!back || !/^https?:$/.test(back.protocol)) return res.status(400).send("redirect_uri invalide (URL http(s) attendue)");
    back.searchParams.set("error", "access_denied"); back.searchParams.set("error_description", "Refus"); if (state) back.searchParams.set("state", String(state));
    const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    const q = (u) => new URLSearchParams({ sys, user: u, redirect_uri: back.origin + back.pathname, state: state || "" });
    res.type("html").send(`<!doctype html><meta charset="utf-8"><title>Connexion ${label} (bouchon)</title>
<body style="font:16px system-ui;max-width:420px;margin:60px auto"><h2>${label} — connexion simulée</h2>
<p>Application : <code>${esc(client_id)}</code></p><p>Choisissez le collaborateur :</p>
${Object.entries(USERS).map(([u, p]) => `<p><a href="/_stub/approve?${q(u)}" style="display:block;padding:12px;border:1px solid #999;border-radius:8px;text-decoration:none;color:#111">${p.name} — ${p.role}<br><small>${u}</small></a></p>`).join("")}
<p><a href="${esc(back.href)}">Refuser</a></p></body>`); // nosemgrep: javascript.express.security.injection.raw-html-format.raw-html-format -- redirect_uri validée (URL http(s) parsée) et échappée ; mire de simulation, jamais déployée en production
  };
}

export function approve(req, res) {
  const { sys, user, redirect_uri, state } = req.query;
  if (!USERS[user]) return res.status(400).send("utilisateur inconnu");
  const code = randomBytes(8).toString("hex");
  codes.set(code, { sys, user, exp: Date.now() + 120_000 });
  const u = new URL(redirect_uri); u.searchParams.set("code", code); if (state) u.searchParams.set("state", state);
  res.redirect(u.href);
}

/** Endpoint /token : échange d'un code ou d'un refresh_token. */
export function tokenEndpoint(sys) {
  return (req, res) => {
    const p = req.body || {};
    if (!p.client_id) return res.status(400).json({ error: "invalid_client" });
    const base = `${req.protocol}://${req.headers.host}`;
    if (p.grant_type === "authorization_code") {
      const c = codes.get(p.code); codes.delete(p.code);
      if (!c || c.sys !== sys || c.exp < Date.now()) return res.status(400).json({ error: "invalid_grant", error_description: "code inconnu ou expiré" });
      return res.json(issue(sys, c.user, base));
    }
    if (p.grant_type === "refresh_token") {
      const t = dec(p.refresh_token || "");
      if (!t?.refresh || t.sys !== sys) return res.status(400).json({ error: "invalid_grant", error_description: "refresh_token invalide" });
      const { refresh_token, ...fresh } = issue(sys, t.user, base); // comme Salesforce : pas de nouveau refresh_token
      return res.json(fresh);
    }
    res.status(400).json({ error: "unsupported_grant_type" });
  };
}

/** Sage X3 Syracuse : jeton OAuth de l'IdP, clé d'API en Bearer, ou Basic login:clé. */
export function sageUser(req) {
  const h = req.headers.authorization || "";
  const b = bearerUser(req, "sage"); if (b) return b;
  const key = h.match(/^Bearer (.+)$/)?.[1];
  if (key) return Object.keys(USERS).find((u) => USERS[u].sageKey === key) || null;
  const basic = h.match(/^Basic (.+)$/)?.[1];
  if (basic) { const [login, pwd] = Buffer.from(basic, "base64").toString().split(":"); return Object.keys(USERS).find((u) => USERS[u].sageLogin === login && USERS[u].sageKey === pwd) || null; }
  return null;
}

/** MyReport Server : jeton personnel en Bearer ou en X-Api-Key. */
export function myreportUser(req) {
  const key = req.headers["x-api-key"] || req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  return Object.keys(USERS).find((u) => USERS[u].myreportKey === key) || null;
}
