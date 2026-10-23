// Connecteur passif Sage X3 24R1 : API REST native Syracuse (/api1/x3/erp/<dossier>/...), jeton Bearer de l'utilisateur.
// Pré-requis côté Sage : un serveur OAuth2 déclaré dans Syracuse (Administration > Serveurs OAuth2) et les
// utilisateurs rattachés à ce serveur, afin que Syracuse accepte "Authorization: Bearer <access_token>".
// Lecture seule : seules les opérations $query / $details / $prototypes sont appelées, toujours en GET.
// MODE SIMULÉ : sans SAGE_URL, le connecteur répond avec 3 fausses tables (YFAC, YCLIENT, ZVENTE) sans jeton.
// CLÉ D'API : alternative à OAuth, saisie par l'utilisateur dans le portail (users.json : sagex3.apiKey, sagex3.login).
// Envoyée selon SAGE_APIKEY_MODE : "bearer" (Authorization: Bearer <clé>) ou "basic" (Authorization: Basic login:clé).
import { z } from "zod";
import { APP_ENV } from "../version.js";
import { unreachable } from "../mcpclient.js";

const BASE = (process.env.SAGE_URL || "").replace(/\/$/, "");
const FOLDER = process.env.SAGE_FOLDER || "PROD";
const LANG = process.env.SAGE_LANG || "fr-FR"; // Syracuse traduit les libellés selon Accept-Language ; une seule étiquette (« fr-FR,fr » a donné de l'anglais sur 24R1)
const TIMEOUT_MS = 30_000; // Syracuse ouvre une session X3 à chaque appel : parfois lent, jamais infini
const REPRESENTATIONS = (process.env.SAGE_REPRESENTATIONS || "BPCUSTOMER,BPSUPPLIER,SINVOICE,PINVOICE,SORDER,PORDER,GACCENTRY,ITMMASTER").split(",").map((s) => s.trim());
const name = z.string().regex(/^\w+$/, "nom de représentation invalide"); // bloque toute traversée de chemin
// Pièges vérifiés sur la préproduction, renvoyés par sagex3_describe (données plutôt que prose dans le schéma d'outil).
const FACTURES = "Le type de pièce n'est pas exposé : il est dans NUM (…FAF… facture, …AVF… avoir). Les montants ne sont pas signés, un avoir compte positif : distinguer factures et avoirs avant de totaliser. INVNUM renseigné = avoir rattaché à cette facture d'origine. Le statut de règlement n'est pas exposé.";
const NOTES = { PINVOICE: FACTURES, SINVOICE: FACTURES };

export const id = "sagex3";
export const label = "Sage X3";
export const source = () => (mock ? "simulateur intégré (aucune donnée réelle)" : `dossier ${FOLDER}`);
export const mock = !BASE;
const apiKeyMode = process.env.SAGE_APIKEY_MODE === "basic" ? "basic" : "bearer";
export const apiKey = { mode: apiKeyMode, label: apiKeyMode === "basic" ? "identifiant et mot de passe Syracuse" : "clé d'API Syracuse personnelle (sans expiration)" }; // saisie proposée par le portail

/** En-tête Authorization construit depuis l'entrée users.json de l'utilisateur. */
const authHeader = (tok) => {
  if (!tok.apiKey) return `Bearer ${tok.access_token}`;
  if (apiKeyMode === "basic") return `Basic ${Buffer.from(`${tok.login || ""}:${tok.apiKey}`).toString("base64")}`;
  return `Bearer ${tok.apiKey}`;
};
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
const syracusePrototype = (rep, fields, title = rep) => ({
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
  const r = await fetch(u, { headers: { Authorization: authHeader(tok), Accept: "application/json", "Accept-Language": LANG }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .catch((e) => { throw e.name === "TimeoutError" ? Object.assign(new Error(`Sage X3 : pas de réponse en ${TIMEOUT_MS / 1000} s (${u.pathname})`), { status: 504 }) : unreachable("Sage X3", u, e); });
  if (!r.ok) throw Object.assign(new Error(`Sage X3 ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status });
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
  // Tous les champs sont conservés : $isExcluded signifie « non affiché par défaut dans la grille », pas « indisponible »
  // (constaté sur 24R1 : FCY et BPR sont exclus de la grille PINVOICE mais filtrables et renvoyés par $query).
  // Un champ de base sans libellé reprend celui de son compagnon X_REF (le libellé « Fournisseur » est porté par BPR_REF).
  // Les blocs répétés de la fiche ($details : lignes, échéances…) sont dépliés en BLOC.CHAMP.
  const type = (v) => String(v.$type || "").replace(/^application\/x-/, "");
  const walk = (map, prefix = "") => Object.entries(map).flatMap(([n, v]) => {
    if (type(v) === "array" && v.$item?.$properties) return walk(v.$item.$properties, `${prefix}${n}.`);
    const lab = label(v.$title) || label(map[`${n}_REF`]?.$title); // compagnon _REF cherché au même niveau (blocs compris)
    return [{ name: `${prefix}${n}`, type: type(v), label: lab }];
  });
  return walk(props);
}
const prototype = (tok, rep, facet = "query") => get(tok, `$prototypes('${rep}.$${facet}')`).then(parsePrototype);

/** Structure mise en cache (par utilisateur, expirée chaque nuit) : champs des représentations configurées. */
export async function schema(tok) {
  const reps = mock ? Object.keys(MOCK) : REPRESENTATIONS;
  const fields = {};
  // Représentation inconnue (404) ou interdite à l'utilisateur (403) : absente de la structure, sans bloquer les autres.
  // Toute autre erreur (401 clé révoquée, réseau) remonte : rien n'est mis en cache.
  const denied = [], broken = []; // 403 : interdite à l'utilisateur ; 5xx : la génération échoue côté Sage (constaté sur 24R1 : 500 « Unexpected token < »)
  const protos = await Promise.all(reps.map((rep) => prototype(tok, rep).catch((e) => {
    if (e.status === 403) denied.push(rep);
    else if (e.status >= 500 && e.status !== 504) broken.push(rep); // 504 = délai dépassé (lenteur passagère) : bloquant, rien n'est mis en cache
    else if (e.status !== 404) throw e; // 401 / réseau / délai : bloquant
    return undefined;
  })));
  reps.forEach((rep, i) => { fields[rep] = protos[i]; });
  return { representations: reps.filter((r) => fields[r]), missing: reps.filter((r) => !fields[r] && !denied.includes(r) && !broken.includes(r)), denied, broken, fields };
}

/** Test de connectivité (portail) : liste des tables via la structure. */
export async function ping(tok, schema) {
  const { representations, missing, denied, broken } = await schema(); // structure relue en direct : une clé révoquée (401) donne un voyant rouge
  if (!representations.length) throw new Error(`Sage X3 : aucune des représentations configurées (${[...missing, ...denied, ...broken].join(", ")}) n'est utilisable sur le dossier ${FOLDER} pour cet utilisateur. Ajustez SAGE_REPRESENTATIONS.`);
  const how = !tok.apiKey ? " par OAuth" : apiKeyMode === "basic" ? " par identifiant et mot de passe Syracuse" : " par clé d'API";
  const notes = [
    missing.length && `absentes de ce dossier (404) : ${missing.join(", ")}`,
    denied.length && `interdites à votre utilisateur X3 (403) : ${denied.join(", ")}`,
    broken.length && `en erreur côté Sage (5xx, à signaler à l'intégrateur) : ${broken.join(", ")}`,
  ].filter(Boolean).map((s) => ` · ${s}`).join("");
  return { message: mock ? `Mode simulé actif · ${representations.length} tables (données inventées)` : `Connecté à ${BASE} (dossier ${FOLDER})${how} · ${representations.length} représentations${notes}`, tables: representations };
}

/** Retire les métadonnées Syracuse ($uuid, $etag, $url…) et aplatit les références ({ $title, $description } → libellé),
 *  format constaté sur 24R1 : BPR_REF: { "$title": "404/210", "$description": "ENGIE" } devient BPR_REF: "ENGIE". */
export const strip = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("$"))
  .map(([k, v]) => [k, v && typeof v === "object" && !Array.isArray(v) && ("$description" in v || "$title" in v) ? (v.$description || v.$title || "") : v]));

export const tools = [
  {
    name: "sagex3_representations",
    description: "Contexte et représentations (tables/vues) Sage X3 disponibles : instance et dossier interrogés (prod ou test), représentations utilisables, absentes ou en erreur.",
    input: {},
    run: async (_tok, _args, schema) => {
      const { representations, missing, denied, broken } = await schema();
      return { instance: mock ? "simulateur intégré (aucune donnée réelle)" : BASE, dossier: mock ? null : FOLDER, environnement_hub: APP_ENV, representations, absentes: missing, interdites: denied, en_erreur: broken };
    },
  },
  {
    name: "sagex3_describe",
    description: "Champs d'une représentation Sage X3. colonnes_liste = les seules valeurs renvoyées par sagex3_query ; champs_fiche = fiche complète renvoyée par sagex3_get (blocs dépliés en BLOC.CHAMP). Le where accepte tout champ d'en-tête mais seules les colonnes de liste sont renvoyées : lire les fiches avec sagex3_get. Filtrer sur X, jamais sur X_REF (libellé). Lire `notes` : pièges connus de la représentation.",
    input: { representation: name.describe("Ex. PINVOICE, BPCUSTOMER") },
    run: async (tok, { representation }, schema) => {
      const fields = (await schema()).fields;
      return {
        representation,
        notes: NOTES[representation],
        colonnes_liste: (Object.hasOwn(fields, representation) && fields[representation]) || await prototype(tok, representation),
        champs_fiche: await prototype(tok, representation, "details").catch((e) => `indisponible : ${e.message}`),
      };
    },
  },
  {
    name: "sagex3_query",
    description: "Interroge une représentation Sage X3 (lecture seule, droits de l'utilisateur). Filtre SData, ex. (ACCDAT ge @2026-01-01@) and (BPR eq 'C0001'). Toujours trier (orderBy 'ACCDAT desc') ou filtrer sur une date : sans cela, des enregistrements techniques (NUM 00000) arrivent en tête. Pièges par représentation : champ notes de sagex3_describe.",
    input: {
      representation: name.describe("Ex. PINVOICE"),
      where: z.string().optional().describe("Filtre SData sur tout champ d'en-tête : (CHAMP op 'valeur') and (...) — op : eq, ne, gt, ge, lt, le, like ; dates entre arobases : @2026-01-01@"),
      orderBy: z.string().optional().describe("Ex. 'ACCDAT desc'"),
      count: z.number().int().min(1).max(500).default(100).describe("Nombre max de lignes"),
    },
    run: async (tok, { representation, where, orderBy, count }) => {
      const params = { representation: `${representation}.$query`, count };
      if (where) params.where = where.replace(/'(\d{4}-\d{2}-\d{2})'/g, "@$1@"); // date entre apostrophes → @date@ (seule syntaxe acceptée par X3, vérifié : l'autre donne un 500)
      if (orderBy) params.orderBy = orderBy;
      return ((await get(tok, representation, params)).$resources || []).map(strip);
    },
  },
  {
    name: "sagex3_get",
    description: "Détail d'un enregistrement Sage X3 par clé, ex. representation=PINVOICE key='TO2192607FAF0006'. Une fiche complète pèse 60 à 130 000 caractères (blocs de lignes) : indiquer champs pour ne garder que l'utile, ex. ['NUM','AMTATI','TOTLINAMT','PIHPID'] (un nom de bloc garde tout le bloc).",
    input: { representation: name, key: z.string(), champs: z.array(z.string().regex(/^\w+$/)).optional().describe("Champs ou blocs à conserver (voir champs_fiche de sagex3_describe) ; vide = fiche entière") },
    run: async (tok, { representation, key, champs }) => {
      const row = strip(await get(tok, `${representation}('${encodeURIComponent(key.replace(/'/g, "''"))}')`, { representation: `${representation}.$details` }));
      return champs?.length ? Object.fromEntries(champs.filter((k) => Object.hasOwn(row, k)).map((k) => [k, row[k]])) : row;
    },
  },
];
