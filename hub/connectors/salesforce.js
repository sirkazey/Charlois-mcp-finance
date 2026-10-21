// Connecteur passif Salesforce : API REST native, jeton OAuth de l'utilisateur transmis tel quel.
// Lecture seule : seuls /query, /sobjects, /describe et /limits sont appelés, toujours en GET.
import { z } from "zod";

const LOGIN = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/$/, "");
const V = process.env.SF_API_VERSION || "v62.0";
const OBJECTS = (process.env.SF_OBJECTS || "Account,Contact,Lead,Opportunity,Order,Case,Product2,Pricebook2").split(",").map((s) => s.trim());
const name = z.string().regex(/^\w+$/, "nom API invalide"); // bloque toute traversée de chemin

export const id = "salesforce";
export const label = "Salesforce";
export const oauth = {
  authUrl: `${LOGIN}/services/oauth2/authorize`,
  tokenUrl: `${LOGIN}/services/oauth2/token`,
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  // refresh_token + offline_access : jeton de rafraîchissement (la Connected App doit l'autoriser : « Refresh token is valid until revoked »).
  scope: "openid api refresh_token offline_access",
};

/** GET REST authentifié sur l'instance de l'utilisateur. */
async function get(tok, path, params = {}) {
  const u = new URL(path, tok.instance_url);
  u.search = new URLSearchParams(params);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`Salesforce ${r.status}: ${await r.text()}`), { status: r.status });
  return r.json();
}

const fieldOf = (f) => ({ name: f.name, type: f.type, label: f.label, ...(f.referenceTo?.length ? { ref: f.referenceTo } : {}) });
const describe = (tok, object) => get(tok, `/services/data/${V}/sobjects/${object}/describe`).then((d) => d.fields.map(fieldOf));

/** Identité (email) après connexion OAuth. */
export const identity = (tok) => get(tok, "/services/oauth2/userinfo").then((u) => u.email);

/** Structure mise en cache (par utilisateur, expirée chaque nuit) : objets interrogeables + champs des objets principaux. */
export async function schema(tok) {
  const { sobjects } = await get(tok, `/services/data/${V}/sobjects`);
  const objects = sobjects.filter((o) => o.queryable).map((o) => ({ name: o.name, label: o.label }));
  const fields = {};
  for (const o of OBJECTS) fields[o] = await describe(tok, o).catch(() => undefined);
  return { objects, fields };
}

/** Test de connectivité (portail) : un GET minimal sur /limits. */
export async function ping(tok) {
  const l = await get(tok, `/services/data/${V}/limits`);
  return { message: `Connecté à ${tok.instance_url} · API restante : ${l.DailyApiRequests?.Remaining ?? "?"} / ${l.DailyApiRequests?.Max ?? "?"}` };
}

/** Outils MCP : run(tok, args, schema) où schema() renvoie la structure en cache de l'utilisateur. */
export const tools = [
  {
    name: "salesforce_objects",
    description: "Liste les objets Salesforce interrogeables (structure en cache, rafraîchie chaque nuit).",
    input: {},
    run: async (_tok, _args, schema) => (await schema()).objects,
  },
  {
    name: "salesforce_describe",
    description: "Champs d'un objet Salesforce (nom, type, libellé, relations).",
    input: { object: name.describe("Nom API de l'objet, ex. Opportunity") },
    run: async (tok, { object }, schema) => (await schema()).fields[object] ?? describe(tok, object),
  },
  {
    name: "salesforce_query",
    description: "Exécute une requête SOQL en lecture seule avec les droits de l'utilisateur. Ajoutez LIMIT. Ex : SELECT Name, Amount, CloseDate FROM Opportunity WHERE CloseDate = LAST_N_MONTHS:12 LIMIT 200",
    input: { soql: z.string().describe("Requête SOQL (SELECT uniquement)") },
    run: async (tok, { soql }) => {
      if (!/^\s*select\s/i.test(soql)) throw new Error("Seules les requêtes SELECT sont autorisées.");
      const page = await get(tok, `/services/data/${V}/query`, { q: soql });
      return { totalSize: page.totalSize, done: page.done, records: page.records.map(({ attributes, ...r }) => r) };
    },
  },
];
