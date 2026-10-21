// Connecteur passif Sage X3 24R1 : API REST native Syracuse (/api1/x3/erp/<dossier>/...), jeton Bearer de l'utilisateur.
// Pré-requis côté Sage : un serveur OAuth2 déclaré dans Syracuse (Administration > Serveurs OAuth2) et les
// utilisateurs rattachés à ce serveur, afin que Syracuse accepte "Authorization: Bearer <access_token>".
// Lecture seule : seules les opérations $query / $details / $prototypes sont appelées, toujours en GET.
// MODE SIMULÉ : sans SAGE_URL, le connecteur répond avec 3 fausses tables (YFAC, YCLIENT, ZVENTE) sans jeton.
// CLÉ D'API : alternative à OAuth, saisie par l'utilisateur dans le portail (users.json : sagex3.apiKey, sagex3.login).
// Envoyée selon SAGE_APIKEY_MODE : "bearer" (Authorization: Bearer <clé>) ou "basic" (Authorization: Basic login:clé).
import { z } from "zod";

const BASE = (process.env.SAGE_URL || "").replace(/\/$/, "");
const FOLDER = process.env.SAGE_FOLDER || "PROD";
const REPRESENTATIONS = (process.env.SAGE_REPRESENTATIONS || "BPCUSTOMER,BPSUPPLIER,SINVOICE,PINVOICE,SORDER,PORDER,GACCENTRY,ITMMASTER").split(",").map((s) => s.trim());
const name = z.string().regex(/^\w+$/, "nom de représentation invalide"); // bloque toute traversée de chemin

export const id = "sagex3";
export const label = "Sage X3";
export const mock = !BASE;
export const apiKeyMode = process.env.SAGE_APIKEY_MODE === "basic" ? "basic" : "bearer";
export const apiKey = { mode: apiKeyMode, label: "clé d'API Syracuse personnelle (sans expiration)" }; // saisie proposée par le portail

/** En-tête Authorization construit depuis l'entrée users.json de l'utilisateur. */
const authHeader = (tok) => tok.apiKey
  ? (apiKeyMode === "basic" ? `Basic ${Buffer.from(`${tok.login || ""}:${tok.apiKey}`).toString("base64")}` : `Bearer ${tok.apiKey}`)
  : `Bearer ${tok.access_token}`;
export const oauth = {
  authUrl: process.env.SAGE_OAUTH_AUTH_URL,
  tokenUrl: process.env.SAGE_OAUTH_TOKEN_URL,
  clientId: process.env.SAGE_OAUTH_CLIENT_ID,
  clientSecret: process.env.SAGE_OAUTH_CLIENT_SECRET,
  scope: process.env.SAGE_OAUTH_SCOPE || "openid offline_access", // + api://<app-syracuse>/.default avec Entra ID
};

// ---- Simulateur (3 tables, données inventées) ----
const MOCK = {
  YFAC: { fields: [["NUM", "string", "N° facture"], ["BPR", "string", "Client"], ["ACCDAT", "date", "Date"], ["AMTATI", "decimal", "Montant TTC"]],
    rows: [{ NUM: "YFAC-2025-0001", BPR: "C0001", ACCDAT: "2025-09-12", AMTATI: 1250.5 }, { NUM: "YFAC-2025-0002", BPR: "C0002", ACCDAT: "2025-10-03", AMTATI: 980 }] },
  YCLIENT: { fields: [["BPCNUM", "string", "Code client"], ["BPCNAM", "string", "Raison sociale"], ["CUR", "string", "Devise"]],
    rows: [{ BPCNUM: "C0001", BPCNAM: "Charlois Tonnellerie", CUR: "EUR" }, { BPCNUM: "C0002", BPCNAM: "Domaine Test", CUR: "EUR" }] },
  ZVENTE: { fields: [["SOHNUM", "string", "N° commande"], ["BPCORD", "string", "Client"], ["ORDDAT", "date", "Date"], ["ORDINVATI", "decimal", "Montant"]],
    rows: [{ SOHNUM: "ZV-000123", BPCORD: "C0001", ORDDAT: "2025-10-15", ORDINVATI: 4300 }] },
};
function mockGet(path) {
  const rep = path.match(/^\$prototypes\('(\w+)/)?.[1] ?? path.match(/^(\w+)/)?.[1];
  const t = MOCK[rep];
  if (!t) throw Object.assign(new Error(`Sage X3 (simulé) 404: représentation ${rep} inconnue`), { status: 404 });
  if (path.startsWith("$prototypes")) return { $properties: Object.fromEntries(t.fields.map(([n, $type, $title]) => [n, { $type, $title }])) };
  if (path.includes("('")) return t.rows[0];
  return { $resources: t.rows };
}

async function get(tok, path, params = {}) {
  if (mock) return mockGet(path);
  const u = new URL(`${BASE}/api1/x3/erp/${FOLDER}/${path}`);
  u.search = new URLSearchParams(params);
  const r = await fetch(u, { headers: { Authorization: authHeader(tok), Accept: "application/json" } });
  if (!r.ok) throw Object.assign(new Error(`Sage X3 ${r.status}: ${await r.text()}`), { status: r.status });
  return r.json();
}

/** Identité : via l'endpoint userinfo du serveur OAuth2 s'il est renseigné. */
export const identity = async (tok) => {
  if (!process.env.SAGE_OAUTH_USERINFO_URL) return null;
  const r = await fetch(process.env.SAGE_OAUTH_USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  return (await r.json()).email ?? null;
};

/** Prototype ($prototypes) d'une représentation = liste des champs exposés. */
const prototype = (tok, rep) => get(tok, `$prototypes('${rep}.$query')`).then((p) =>
  Object.entries(p.$properties || {}).map(([n, v]) => ({ name: n, type: v.$type, label: v.$title })));

/** Structure mise en cache (par utilisateur, expirée chaque nuit) : champs des représentations configurées. */
export async function schema(tok) {
  const reps = mock ? Object.keys(MOCK) : REPRESENTATIONS;
  const fields = {};
  for (const rep of reps) fields[rep] = await prototype(tok, rep).catch(() => undefined); // échec = non caché, réessayé en direct
  return { representations: reps, fields };
}

/** Test de connectivité (portail) : liste des tables via la structure. */
export async function ping(tok, schema) {
  const { representations } = await schema();
  const how = tok.apiKey ? ` par clé d'API (${apiKeyMode})` : " par OAuth";
  return { message: mock ? `Mode simulé actif · ${representations.length} tables en cache mémoire` : `Connecté à ${BASE} (dossier ${FOLDER})${how}`, tables: representations };
}

/** Retire les métadonnées Syracuse ($uuid, $etag, $url…) pour alléger la réponse. */
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$")));

export const tools = [
  {
    name: "sagex3_representations",
    description: "Liste les représentations (tables/vues) Sage X3 disponibles.",
    input: {},
    run: async (_tok, _args, schema) => (await schema()).representations,
  },
  {
    name: "sagex3_describe",
    description: "Champs d'une représentation Sage X3.",
    input: { representation: name.describe("Ex. SINVOICE, BPCUSTOMER") },
    run: async (tok, { representation }, schema) => (await schema()).fields[representation] ?? prototype(tok, representation),
  },
  {
    name: "sagex3_query",
    description: "Interroge une représentation Sage X3 en lecture seule avec les droits de l'utilisateur. Filtre SData, ex : (ACCDAT ge '2025-01-01') and (BPR eq 'C0001')",
    input: {
      representation: name.describe("Ex. SINVOICE"),
      where: z.string().optional().describe("Filtre SData : (CHAMP op 'valeur') and (...)  — op : eq, ne, gt, ge, lt, le, like"),
      orderBy: z.string().optional().describe("Ex. 'ACCDAT desc'"),
      count: z.number().int().min(1).max(500).default(100).describe("Nombre max de lignes"),
    },
    run: async (tok, { representation, where, orderBy, count }) => {
      const params = { representation: `${representation}.$query`, count };
      if (where) params.where = where;
      if (orderBy) params.orderBy = orderBy;
      return ((await get(tok, representation, params)).$resources || []).map(strip);
    },
  },
  {
    name: "sagex3_get",
    description: "Détail d'un enregistrement Sage X3 par clé, ex. representation=SINVOICE key='FAC-2025-000123'.",
    input: { representation: name, key: z.string() },
    run: async (tok, { representation, key }) =>
      strip(await get(tok, `${representation}('${encodeURIComponent(key.replace(/'/g, "''"))}')`, { representation: `${representation}.$details` })),
  },
];
