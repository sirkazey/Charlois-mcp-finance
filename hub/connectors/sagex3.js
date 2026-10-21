// Connecteur passif Sage X3 24R1 : API REST native Syracuse (/api1/x3/erp/<dossier>/...), jeton Bearer de l'utilisateur.
// Pré-requis côté Sage : un serveur OAuth2 déclaré dans Syracuse (Administration > Serveurs OAuth2) et les
// utilisateurs rattachés à ce serveur, afin que Syracuse accepte "Authorization: Bearer <access_token>".
// Lecture seule : seules les opérations $query / $details / $prototypes sont exposées.
import { z } from "zod";

const BASE = (process.env.SAGE_URL || "").replace(/\/$/, "");
const FOLDER = process.env.SAGE_FOLDER || "PROD";
const REPRESENTATIONS = (process.env.SAGE_REPRESENTATIONS || "BPCUSTOMER,BPSUPPLIER,SINVOICE,PINVOICE,SORDER,PORDER,GACCENTRY,ITMMASTER").split(",").map((s) => s.trim());

export const id = "sagex3";
export const label = "Sage X3";
export const oauth = {
  authUrl: process.env.SAGE_OAUTH_AUTH_URL,
  tokenUrl: process.env.SAGE_OAUTH_TOKEN_URL,
  clientId: process.env.SAGE_OAUTH_CLIENT_ID,
  clientSecret: process.env.SAGE_OAUTH_CLIENT_SECRET,
  scope: process.env.SAGE_OAUTH_SCOPE || "openid email offline_access",
};

async function get(tok, path, params = {}) {
  const u = new URL(`${BASE}/api1/x3/erp/${FOLDER}/${path}`);
  u.search = new URLSearchParams(params);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" } });
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
  Object.entries(p.$properties || {}).map(([name, v]) => ({ name, type: v.$type, label: v.$title })));

/** Schéma mis en cache la nuit : champs des représentations configurées. */
export async function schema(tok) {
  const fields = {};
  for (const rep of REPRESENTATIONS) fields[rep] = await prototype(tok, rep).catch((e) => ({ error: e.message }));
  return { representations: REPRESENTATIONS, fields };
}

export const tools = (cache) => [
  {
    name: "sagex3_representations",
    description: "Liste les représentations (tables/vues) Sage X3 disponibles.",
    input: {},
    run: async () => cache?.representations ?? REPRESENTATIONS,
  },
  {
    name: "sagex3_describe",
    description: "Champs d'une représentation Sage X3 (cache nocturne, sinon appel direct).",
    input: { representation: z.string().describe("Ex. SINVOICE, BPCUSTOMER") },
    run: async (tok, { representation }) => cache?.fields?.[representation] ?? prototype(tok, representation),
  },
  {
    name: "sagex3_query",
    description: "Interroge une représentation Sage X3 en lecture seule avec les droits de l'utilisateur. Filtre SData, ex : (ACCDAT ge '2025-01-01') and (BPR eq 'C0001')",
    input: {
      representation: z.string().describe("Ex. SINVOICE"),
      where: z.string().optional().describe("Filtre SData : (CHAMP op 'valeur') and (...)  — op : eq, ne, gt, ge, lt, le, like"),
      orderBy: z.string().optional().describe("Ex. 'ACCDAT desc'"),
      count: z.number().int().min(1).max(500).default(100).describe("Nombre max de lignes"),
    },
    run: async (tok, { representation, where, orderBy, count }) => {
      const params = { representation: `${representation}.$query`, count };
      if (where) params.where = where;
      if (orderBy) params.orderBy = orderBy;
      const r = await get(tok, representation, params);
      return (r.$resources || []).map(strip);
    },
  },
  {
    name: "sagex3_get",
    description: "Détail d'un enregistrement Sage X3 par clé, ex. representation=SINVOICE key='FAC-2025-000123'.",
    input: { representation: z.string(), key: z.string() },
    run: async (tok, { representation, key }) => strip(await get(tok, `${representation}('${key.replace(/'/g, "''")}')`, { representation: `${representation}.$details` })),
  },
];

/** Retire les métadonnées Syracuse ($uuid, $etag, $url…) pour alléger la réponse. */
const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$")));
