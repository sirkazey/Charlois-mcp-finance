// Connecteur passif Salesforce : API REST native, jeton OAuth de l'utilisateur transmis tel quel.
// Lecture seule : seuls /query, /sobjects et /describe sont exposés (aucun POST/PATCH/DELETE).
import { z } from "zod";

const LOGIN = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/$/, "");
const V = process.env.SF_API_VERSION || "v62.0";
const OBJECTS = (process.env.SF_OBJECTS || "Account,Contact,Lead,Opportunity,Order,Case,Product2,Pricebook2").split(",").map((s) => s.trim());

export const id = "salesforce";
export const label = "Salesforce";
export const oauth = {
  authUrl: `${LOGIN}/services/oauth2/authorize`,
  tokenUrl: `${LOGIN}/services/oauth2/token`,
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET,
  scope: "api refresh_token",
};

/** GET REST authentifié sur l'instance de l'utilisateur. */
async function get(tok, path, params = {}) {
  const u = new URL(path, tok.instance_url);
  u.search = new URLSearchParams(params);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`Salesforce ${r.status}: ${await r.text()}`), { status: r.status });
  return r.json();
}

/** Identité (email) après connexion OAuth. */
export const identity = (tok) => get(tok, "/services/oauth2/userinfo").then((u) => u.email);

/** Schéma mis en cache la nuit : liste des objets + champs des objets principaux. */
export async function schema(tok) {
  const { sobjects } = await get(tok, `/services/data/${V}/sobjects`);
  const objects = sobjects.filter((o) => o.queryable).map((o) => ({ name: o.name, label: o.label }));
  const fields = {};
  for (const name of OBJECTS) {
    const d = await get(tok, `/services/data/${V}/sobjects/${name}/describe`).catch(() => null);
    if (d) fields[name] = d.fields.map((f) => ({ name: f.name, type: f.type, label: f.label, ...(f.referenceTo?.length ? { ref: f.referenceTo } : {}) }));
  }
  return { objects, fields };
}

/** Outils MCP. `cache` = schéma en cache (peut être null). */
export const tools = (cache) => [
  {
    name: "salesforce_objects",
    description: "Liste les objets Salesforce interrogeables (depuis le cache nocturne).",
    input: {},
    run: async () => cache?.objects ?? "Cache vide : il sera construit cette nuit ou au premier démarrage.",
  },
  {
    name: "salesforce_describe",
    description: "Champs d'un objet Salesforce (nom, type, libellé, relations). Cache nocturne, sinon appel direct.",
    input: { object: z.string().describe("Nom API de l'objet, ex. Opportunity") },
    run: async (tok, { object }) =>
      cache?.fields?.[object] ??
      (await get(tok, `/services/data/${V}/sobjects/${object}/describe`)).fields.map((f) => ({ name: f.name, type: f.type, label: f.label })),
  },
  {
    name: "salesforce_query",
    description: "Exécute une requête SOQL en lecture seule avec les droits de l'utilisateur. Ex : SELECT Name, Amount, CloseDate FROM Opportunity WHERE CloseDate = LAST_N_MONTHS:12",
    input: { soql: z.string().describe("Requête SOQL (SELECT uniquement)") },
    run: async (tok, { soql }) => {
      if (!/^\s*select\s/i.test(soql)) throw new Error("Seules les requêtes SELECT sont autorisées.");
      let page = await get(tok, `/services/data/${V}/query`, { q: soql });
      const records = page.records;
      while (!page.done && records.length < 2000) { page = await get(tok, page.nextRecordsUrl); records.push(...page.records); }
      return { totalSize: page.totalSize, returned: records.length, records: records.map(({ attributes, ...r }) => r) };
    },
  },
];
