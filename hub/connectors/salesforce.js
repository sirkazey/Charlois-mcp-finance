// Connecteur Salesforce : proxy vers le serveur MCP hébergé par Salesforce "SObject Reads" (lecture seule des objets métier).
// Le hub est client MCP (Streamable HTTP) avec le jeton OAuth de l'utilisateur (External Client App, scope mcp_api, PKCE) :
// Salesforce applique le profil, les règles de partage et la sécurité au niveau des champs de ce collaborateur.
// Verrou : SF_MCP_URL doit désigner un serveur de lecture ; un serveur d'écriture (sobject-all, mutations, deletes…) est refusé.
import { z } from "zod";
import { APP_ENV } from "../version.js";
import { withMcp, callRemote } from "../mcpclient.js";

const LOGIN = (process.env.SF_LOGIN_URL || "https://login.salesforce.com").replace(/\/$/, ""); // My Domain de l'org (serveur d'autorisation)
const MCP_URL = process.env.SF_MCP_URL || ""; // ex. https://api.salesforce.com/platform/mcp/v1/d/<org>/platform/sobject-reads
const DEFAULT_LIMIT = Number(process.env.SF_DEFAULT_LIMIT ?? 200); // LIMIT ajouté aux SOQL qui n'en ont pas (0 = désactivé)
const ALLOW = (process.env.SF_MCP_TOOLS || "").split(",").map((s) => s.trim()).filter(Boolean); // liste blanche optionnelle ; vide = tous les outils du serveur (lecture seule par construction)
if (/sobject-all|mutations|deletes|write|crma|data-cloud/i.test(MCP_URL)) { console.error(`[salesforce] SF_MCP_URL désigne un serveur d'écriture ou hors périmètre : ${MCP_URL}. Seul un serveur de lecture (sobject-reads) est accepté.`); process.exit(1); }

export const id = "salesforce";
export const label = "Salesforce";
export const source = () => { const h = new URL(LOGIN).hostname; const m = h.match(/^[^.]+--([^.]+)\.sandbox\./); return m ? `sandbox ${m[1]}` : "production"; }; // ex. charloisgroup--preprod.sandbox.my.salesforce.com → sandbox preprod
export const maxPerMinute = Number(process.env.SF_MAX_PER_MIN ?? 0); // crédits Flex : plafond d'appels sortants par minute (0 = illimité)
export const oauth = {
  authUrl: `${LOGIN}/services/oauth2/authorize`,
  tokenUrl: `${LOGIN}/services/oauth2/token`,
  clientId: process.env.SF_CLIENT_ID,
  clientSecret: process.env.SF_CLIENT_SECRET, // vide si l'External Client App n'exige pas de secret (PKCE)
  scope: process.env.SF_SCOPE || "mcp_api refresh_token", // + openid si l'app l'autorise, pour afficher l'email
};

const mcp = (tok, fn) => withMcp({ url: MCP_URL, headers: { Authorization: `Bearer ${tok.access_token}` }, label: "Salesforce MCP" }, fn);
const allowed = (name) => !ALLOW.length || ALLOW.includes(name);

/** Email de l'utilisateur si le scope openid est accordé ; sinon null (sans conséquence). */
export const identity = async (tok) => {
  const r = await fetch(`${LOGIN}/services/oauth2/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } }).catch(() => null);
  if (r?.ok) return (await r.json()).email ?? null; // nécessite l'étendue openid
  // Sans openid : l'outil getUserInfo du serveur SObject Reads (présent sur la sandbox) ; l'email est extrait de sa réponse.
  // Champ "email" en priorité : le username d'une sandbox porte un suffixe (.preprod) et n'est pas une adresse valide.
  return mcp(tok, async (c) => { const raw = await callRemote(c, "getUserInfo", {}), j = typeof raw === "string" ? raw : JSON.stringify(raw); return j.match(/"email"\s*:\s*"([^"]+@[^"]+)"/i)?.[1] ?? j.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/)?.[0] ?? null; }).catch(() => null);
};

/** Outils du serveur SObject Reads (structure en cache par utilisateur, expirée chaque nuit). */
export const schema = (tok) => mcp(tok, async (c) => ({
  tools: (await c.listTools()).tools.filter((t) => allowed(t.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

export async function ping(_tok, schema) {
  if (!MCP_URL) throw new Error("SF_MCP_URL non renseignée : URL du serveur MCP SObject Reads (Configuration → Serveurs MCP).");
  const { tools } = await schema();
  return { message: `Connecté au serveur MCP Salesforce (${MCP_URL.split("/d/")[1] || MCP_URL}) · ${tools.length} outils en lecture seule`, tables: tools.map((t) => t.name) };
}

export const tools = [
  {
    name: "salesforce_tools",
    description: "Outils du serveur MCP Salesforce SObject Reads (sur la sandbox : find, getObjectSchema, getRelatedRecords, getUserInfo, listRecentSobjectRecords, soqlQuery) avec leur schéma d'arguments. À appeler avant salesforce_call.",
    input: {},
    run: async (_tok, _a, schema) => ({ instance: LOGIN, serveur_mcp: MCP_URL, environnement_hub: APP_ENV, outils: (await schema()).tools }), // instance (prod ou sandbox) visible du modèle
  },
  {
    name: "salesforce_call",
    description: `Appelle un outil du serveur MCP Salesforce avec les droits de l'utilisateur, ex. tool='soqlQuery', arguments={q:'SELECT Name FROM Account WHERE Industry = \\'Wine\\' LIMIT 20'} ; tool='getObjectSchema' sans argument pour l'index des objets, puis arguments={objects:'Account'} pour ses champs. Un soqlQuery sans LIMIT reçoit LIMIT ${DEFAULT_LIMIT} d'office.`,
    input: { tool: z.string().regex(/^[\w.-]+$/), arguments: z.record(z.string(), z.any()).default({}) },
    run: (tok, { tool, arguments: args }) => {
      if (!allowed(tool)) throw new Error(`Outil ${tool} refusé : absent de la liste blanche SF_MCP_TOOLS.`);
      if (tool === "soqlQuery" && DEFAULT_LIMIT && typeof args.q === "string" && !/\bLIMIT\s+\d+\s*$/i.test(args.q.trim())) args = { ...args, q: `${args.q.trim()} LIMIT ${DEFAULT_LIMIT}` }; // garde-fou volume : jamais une requête sans borne
      return mcp(tok, (c) => callRemote(c, tool, args));
    },
  },
];
