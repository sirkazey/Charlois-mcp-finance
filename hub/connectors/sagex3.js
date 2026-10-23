// Connecteur passif Sage X3 24R1 : API REST native Syracuse (/api1/x3/erp/<dossier>/...), jeton Bearer de l'utilisateur.
// Pré-requis côté Sage : un serveur OAuth2 déclaré dans Syracuse (Administration > Serveurs OAuth2) et les
// utilisateurs rattachés à ce serveur, afin que Syracuse accepte "Authorization: Bearer <access_token>".
// Lecture seule : seules les opérations $query / $details / $prototypes sont appelées, toujours en GET.
// MODE SIMULÉ : sans SAGE_URL, le connecteur répond avec 3 fausses tables (YFAC, YCLIENT, ZVENTE) sans jeton.
// CLÉ D'API : alternative à OAuth, saisie par l'utilisateur dans le portail (users.json : sagex3.apiKey, sagex3.login).
// Envoyée selon SAGE_APIKEY_MODE : "bearer" (Authorization: Bearer <clé>) ou "basic" (Authorization: Basic login:clé).
import { z } from "zod";
import { unreachable } from "../mcpclient.js";

const BASE = (process.env.SAGE_URL || "").replace(/\/$/, "");
const FOLDER = process.env.SAGE_FOLDER || "PROD";
const TIMEOUT_MS = Number(process.env.SAGE_TIMEOUT_MS || 30000); // Syracuse ouvre une session X3 à chaque appel : parfois lent, jamais infini
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
/** Réponse $prototypes au format réel Syracuse (structure vérifiée sur une instance 24R1). */
export const syracusePrototype = (rep, fields, title = rep) => ({
  $representation: rep, $title: "{@1}", $itemsPerPage: 300,
  $properties: { $resources: { $type: "application/x-array", $item: { $properties: Object.fromEntries(
    fields.map(([n, type, lab], i) => [n, { $title: `{@${i + 2}}`, $type: `application/x-${type}`, $isReadOnly: true }])) } } },
  $localization: Object.fromEntries([["@1", title], ...fields.map(([, , lab], i) => [`@${i + 2}`, lab])]),
});
function mockGet(path) {
  const rep = path.match(/^\$prototypes\('(\w+)/)?.[1] ?? path.match(/^(\w+)/)?.[1];
  const t = MOCK[rep];
  if (!t) throw Object.assign(new Error(`Sage X3 (simulé) 404: représentation ${rep} inconnue`), { status: 404 });
  if (path.startsWith("$prototypes")) return syracusePrototype(rep, t.fields);
  if (path.includes("('")) return t.rows[0];
  return { $resources: t.rows };
}

async function get(tok, path, params = {}) {
  if (mock) return mockGet(path);
  const u = new URL(`${BASE}/api1/x3/erp/${FOLDER}/${path}`);
  // Pas URLSearchParams : il code les espaces en « + », que Syracuse refuse dans where/orderBy (« expected beginning of term »).
  u.search = Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
  const r = await fetch(u, { headers: { Authorization: authHeader(tok), Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch((e) => { throw e.name === "TimeoutError" ? Object.assign(new Error(`Sage X3 : pas de réponse en ${TIMEOUT_MS / 1000} s (${u.pathname})`), { status: 504 }) : unreachable("Sage X3", u, e); });
  if (!r.ok) throw Object.assign(new Error(`Sage X3 ${r.status}: ${await r.text()}`), { status: r.status });
  return r.json();
}

/** Identité : via l'endpoint userinfo du serveur OAuth2 s'il est renseigné. */
export const identity = async (tok) => {
  if (!process.env.SAGE_OAUTH_USERINFO_URL) return null;
  const r = await fetch(process.env.SAGE_OAUTH_USERINFO_URL, { headers: { Authorization: `Bearer ${tok.access_token}` } });
  return (await r.json()).email ?? null;
};

/** Prototype ($prototypes) d'une représentation = liste des champs exposés.
 *  Format réel Syracuse (vérifié sur 24R1) : champs sous $properties.$resources.$item.$properties, types "application/x-<type>",
 *  libellés sous forme de références "{@1503}" résolues dans $localization. Les champs exclus/cachés de la liste ne sont pas retournés. */
export function parsePrototype(p) {
  const loc = p.$localization || {};
  const label = (t) => String(t ?? "").replace(/\{@([^}]+)\}/g, (_, k) => loc[`@${k}`] ?? k);
  const props = p.$properties?.$resources?.$item?.$properties ?? p.$properties ?? {};
  return Object.entries(props).filter(([, v]) => !v.$isExcluded && !v.$isHidden)
    .map(([n, v]) => ({ name: n, type: String(v.$type || "").replace(/^application\/x-/, ""), label: label(v.$title) }));
}
const prototype = (tok, rep) => get(tok, `$prototypes('${rep}.$query')`).then(parsePrototype);

/** Structure mise en cache (par utilisateur, expirée chaque nuit) : champs des représentations configurées. */
export async function schema(tok) {
  const reps = mock ? Object.keys(MOCK) : REPRESENTATIONS;
  const fields = {};
  // Représentation inconnue (404) ou interdite à l'utilisateur (403) : absente de la structure, sans bloquer les autres.
  // Toute autre erreur (401 clé révoquée, réseau) remonte : rien n'est mis en cache.
  const denied = [], broken = []; // 403 : interdite à l'utilisateur ; 5xx : la génération échoue côté Sage (constaté sur 24R1 : 500 « Unexpected token < »)
  const protos = await Promise.all(reps.map((rep) => prototype(tok, rep).catch((e) => {
    if (e.status === 403) denied.push(rep); else if (e.status >= 500) broken.push(rep); else if (e.status !== 404) throw e; // 401 / réseau : bloquant
    return undefined;
  })));
  reps.forEach((rep, i) => { fields[rep] = protos[i]; });
  return { representations: reps.filter((r) => fields[r]), missing: reps.filter((r) => !fields[r] && !denied.includes(r) && !broken.includes(r)), denied, broken, fields };
}

/** Test de connectivité (portail) : liste des tables via la structure. */
export async function ping(tok, schema) {
  const { representations, missing, denied, broken } = await schema(); // structure relue en direct : une clé révoquée (401) donne un voyant rouge
  if (!representations.length) throw new Error(`Sage X3 : aucune des représentations configurées (${[...missing, ...denied, ...broken].join(", ")}) n'est utilisable sur le dossier ${FOLDER} pour cet utilisateur. Ajustez SAGE_REPRESENTATIONS.`);
  const how = tok.apiKey ? ` par clé d'API (${apiKeyMode})` : " par OAuth";
  const absent = (missing.length ? ` · absentes de ce dossier (404) : ${missing.join(", ")}` : "") + (denied.length ? ` · interdites à votre utilisateur X3 (403) : ${denied.join(", ")}` : "")
    + (broken.length ? ` · en erreur côté Sage (5xx, à signaler à l'intégrateur) : ${broken.join(", ")}` : "");
  return { message: mock ? `Mode simulé actif · ${representations.length} tables en cache mémoire` : `Connecté à ${BASE} (dossier ${FOLDER})${how} · ${representations.length} représentations${absent}`, tables: representations };
}

/** Retire les métadonnées Syracuse ($uuid, $etag, $url…) et aplatit les références ({ $title, $description } → libellé),
 *  format constaté sur 24R1 : BPR_REF: { "$title": "404/210", "$description": "ENGIE" } devient BPR_REF: "ENGIE". */
export const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$"))
  .map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) && ("$description" in v || "$title" in v) ? (v.$description || v.$title || "") : v]));

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
