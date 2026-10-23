// SSO Microsoft Entra ID (OIDC, code + PKCE) : identifie le collaborateur sur le portail et lie sa clé MCP à son identité Entra.
// Réutilise le routeur OAuth des connecteurs (state, PKCE, échange de code) ; aucune session supplémentaire : le cookie mcp_key reste
// l'unique session, la clé n'est utilisable (portail et clients MCP) qu'une fois liée à une identité.
// Modes : "" (désactivé, comportement historique), "mock" (mire Entra du bouchon mcp-stub, interdite en production), "entra" (Microsoft).
// Authentification ≠ autorisation Graph : le SSO ne demande que openid profile email ; SharePoint garde son propre consentement
// délégué, tenté sans interaction (prompt=none) juste après le SSO, puis interactif si Entra le refuse.
import { store } from "./store.js";
import { IS_PROD } from "./version.js";
import { hasCredential, PUBLIC_URL } from "./oauth.js";

export const MODE = process.env.SSO_MODE || "";
const LOGIN = (process.env.MS_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/$/, "");
const TENANT = process.env.MS_TENANT_ID || "";
const CLIENT_ID = process.env.MS_CLIENT_ID, CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const MICROSOFT = /^https:\/\/login\.microsoftonline\.com$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (MODE) {
  const fail = (m) => { console.error(`[sso] ${m}`); process.exit(1); };
  if (!["mock", "entra"].includes(MODE)) fail(`SSO_MODE doit être vide, mock ou entra (reçu : ${MODE})`);
  if (MODE === "mock" && IS_PROD) fail("SSO_MODE=mock est interdit en production");
  if (MODE === "mock" && MICROSOFT.test(LOGIN)) fail("SSO_MODE=mock exige MS_LOGIN_URL vers le bouchon (jamais login.microsoftonline.com)");
  if (MODE === "entra" && !MICROSOFT.test(LOGIN)) fail("SSO_MODE=entra exige MS_LOGIN_URL vide (login.microsoftonline.com)");
  if (MODE === "entra" && !GUID.test(TENANT)) fail("SSO_MODE=entra exige MS_TENANT_ID = ID de l'annuaire (GUID), jamais common");
  if (!TENANT || !CLIENT_ID || !CLIENT_SECRET) fail("le SSO exige MS_TENANT_ID, MS_CLIENT_ID et MS_CLIENT_SECRET (application Entra ID du hub)");
}
const ISSUER = `${LOGIN}/${TENANT}/v2.0`.toLowerCase();

/** Revendications de l'id_token, vérifiées : émetteur et locataire attendus, audience = notre application, non expiré.
 *  Le jeton arrive en direct du point de terminaison token (TLS, code + PKCE + secret) : la signature n'est pas revérifiée
 *  (OIDC Core § 3.1.3.7, règle 6). */
export function claims(idToken) {
  let c; try { c = JSON.parse(Buffer.from(String(idToken).split(".")[1], "base64url").toString("utf8")); } catch { c = null; }
  const bad = (m) => Object.assign(new Error(`SSO : id_token refusé (${m})`), { status: 400, sso: true });
  if (!c || [c.oid, c.tid, c.iss].some((v) => typeof v !== "string" || !v)) throw bad("revendications absentes");
  if (c.iss.toLowerCase() !== ISSUER || c.tid.toLowerCase() !== TENANT.toLowerCase()) throw bad("émetteur ou locataire inattendu");
  if (c.aud !== CLIENT_ID) throw bad("audience inattendue");
  if (!(c.exp > Date.now() / 1000)) throw bad("expiré");
  return { sub: c.oid, tid: c.tid, upn: c.preferred_username || c.email || "", name: c.name || "", email: c.email || c.preferred_username || null };
}

/** Déconnexion : fermer aussi la session Microsoft du navigateur (sinon, sur un poste partagé, le suivant se reconnecterait
 *  au compte précédent d'un clic). post_logout_redirect_uri doit être enregistrée dans l'application Entra. */
export const logoutUrl = `${LOGIN}/${TENANT}/oauth2/v2.0/logout?${new URLSearchParams({ post_logout_redirect_uri: `${PUBLIC_URL}/?sso=off` })}`;

/** Pseudo-connecteur du routeur OAuth : flux /auth/sso et /auth/sso/callback, sans outil MCP ni jeton conservé. */
export const connector = {
  id: "sso",
  label: MODE === "mock" ? "Microsoft Entra ID (simulé)" : "Microsoft Entra ID",
  oauth: { authUrl: `${LOGIN}/${TENANT}/oauth2/v2.0/authorize`, tokenUrl: `${LOGIN}/${TENANT}/oauth2/v2.0/token`, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, scope: "openid profile email" },
  /** Fin du flux : lie l'identité Entra à une clé MCP et renvoie la clé à poser dans le cookie.
   *  Une identité déjà connue retrouve SA clé, depuis n'importe quel navigateur ; une identité nouvelle reçoit une clé FRAÎCHE,
   *  jamais celle que le navigateur portait avant l'authentification : une clé connue d'avance (fixation de session sur un
   *  poste partagé) ou héritée d'avant le SSO avec les jetons d'un autre collaborateur ne doit jamais devenir la sienne.
   *  La clé anonyme du navigateur est supprimée ; une clé déjà liée à quelqu'un d'autre (poste partagé) reste intacte. */
  bindIdentity(browserKey, tokens) {
    const id = claims(tokens.id_token);
    const key = store.findSso(id.sub, id.tid) ?? store.create();
    if (key !== browserKey && !store.get(browserKey)?.sso) store.remove(browserKey);
    store.setSso(key, id);
    return key;
  },
  /** Un connecteur de la même application Entra (SharePoint) ne peut lier que des jetons du MÊME compte Microsoft que l'identité
   *  du portail : sur un navigateur où un autre compte Microsoft 365 est ouvert, le sélecteur de compte d'Entra ne doit pas
   *  permettre d'attacher le refresh_token Graph d'autrui à sa propre clé. */
  assertSame(key, tokens) {
    const u = store.get(key); if (!u?.sso) return;
    const id = claims(tokens.id_token);
    if (id.sub !== u.sso.sub || id.tid !== u.sso.tid) throw Object.assign(new Error("SSO : compte Microsoft différent de l'identité du portail"), { status: 400, sso: true });
  },
  /** Après le SSO : connexion SharePoint tentée sans interaction si l'utilisateur n'y est pas encore connecté. */
  next: (key) => (!hasCredential(store.get(key)?.sharepoint) ? "/auth/sharepoint?silent=1" : "/"),
};
