// Connecteur passif SharePoint / OneDrive : Microsoft Graph en délégué (jeton OAuth de l'utilisateur).
// Lecture seule : uniquement des GET (sites, children, search, content). Graph applique les droits de
// l'utilisateur : un dossier « Finance » qu'il ne voit pas dans SharePoint répond 403/404 ici aussi.
import { z } from "zod";
import { unreachable } from "../mcpclient.js";

const LOGIN = (process.env.MS_LOGIN_URL || "https://login.microsoftonline.com").replace(/\/$/, "");
const TENANT = process.env.MS_TENANT_ID || "common";
const GRAPH = (process.env.GRAPH_URL || "https://graph.microsoft.com/v1.0").replace(/\/$/, "");
const SITE = process.env.SP_SITE || ""; // site par défaut, ex. charlois.sharepoint.com:/sites/Finance (vide = OneDrive de l'utilisateur)
const MAX_TEXT = 200_000;

export const id = "sharepoint";
export const label = "SharePoint";
export const source = () => `Microsoft Graph ${GRAPH}${SITE ? ` · site ${SITE}` : " · OneDrive de l'utilisateur"}`;
export const oauth = {
  authUrl: `${LOGIN}/${TENANT}/oauth2/v2.0/authorize`,
  tokenUrl: `${LOGIN}/${TENANT}/oauth2/v2.0/token`,
  clientId: process.env.MS_CLIENT_ID,
  clientSecret: process.env.MS_CLIENT_SECRET,
  scope: "openid offline_access User.Read Files.Read.All Sites.Read.All", // permissions déléguées, lecture seule
};

async function get(tok, path, params = {}, raw = false) {
  const u = new URL(GRAPH + path);
  u.search = new URLSearchParams(params);
  let r = await fetch(u, { headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" }, redirect: "manual" }).catch((e) => { throw unreachable("SharePoint", u, e); });
  if (r.status === 302) r = await fetch(r.headers.get("location")); // URL de téléchargement pré-authentifiée : jamais le jeton
  if (!r.ok) throw Object.assign(new Error(`SharePoint ${r.status}: ${(await r.text()).slice(0, 300)}`), { status: r.status });
  return raw ? r : r.json();
}

/** Racine du lecteur : site SharePoint (id ou hostname:/sites/xxx) ou OneDrive de l'utilisateur. */
const drive = (site = SITE) => (site ? `/sites/${site}${site.includes(":") ? ":" : ""}/drive` : "/me/drive");
const item = (i) => ({ id: i.id, name: i.name, type: i.folder ? "dossier" : "fichier", size: i.size, modified: i.lastModifiedDateTime, webUrl: i.webUrl });

export const identity = (tok) => get(tok, "/me").then((u) => u.mail || u.userPrincipalName);
export const schema = async (tok) => ({ sites: (await get(tok, "/sites", { search: "*" })).value.map((s) => ({ id: s.id, name: s.displayName || s.name, webUrl: s.webUrl })) });

export async function ping(tok) {
  const u = await get(tok, "/me");
  return { message: `Connecté à Microsoft Graph en tant que ${u.displayName} (${u.mail || u.userPrincipalName})${SITE ? ` · site ${SITE}` : " · OneDrive"}` };
}

const siteArg = z.string().regex(/^(?!.*\.\.)[\w.,:/-]+$/).optional().describe("Site SharePoint (id Graph ou hostname:/sites/Nom) ; défaut : SP_SITE, sinon OneDrive");
const pathArg = z.string().regex(/^(?!.*\.\.)[^#?]*$/).default("").describe("Chemin du dossier depuis la racine du lecteur");
const encPath = (p) => p.replace(/^\/+|\/+$/g, "").split("/").map(encodeURIComponent).join("/");

export const tools = [
  {
    name: "sharepoint_sites",
    description: "Sites SharePoint visibles par l'utilisateur (structure en cache).",
    input: {},
    run: async (_tok, _a, schema) => (await schema()).sites,
  },
  {
    name: "sharepoint_list",
    description: "Contenu d'un dossier SharePoint/OneDrive, ex. path='Finance/2025'.",
    input: { path: pathArg, site: siteArg },
    run: async (tok, { path, site }) => {
      const p = encPath(path);
      return (await get(tok, `${drive(site)}/root${p ? `:/${p}:` : ""}/children`, { $top: 200 })).value.map(item);
    },
  },
  {
    name: "sharepoint_search",
    description: "Recherche de fichiers par mots-clés dans le site (ou OneDrive) avec les droits de l'utilisateur.",
    input: { query: z.string(), site: siteArg },
    run: async (tok, { query, site }) => (await get(tok, `${drive(site)}/root/search(q='${encodeURIComponent(query.replace(/'/g, "''"))}')`, { $top: 50 })).value.map(item),
  },
  {
    name: "sharepoint_read",
    description: "Contenu texte d'un fichier (txt, csv, md, json, xml…) par son id. Les binaires renvoient leurs métadonnées.",
    input: { itemId: z.string().regex(/^[\w!.-]+$/), site: siteArg },
    run: async (tok, { itemId, site }) => {
      const meta = item(await get(tok, `${drive(site)}/items/${itemId}`));
      if (meta.type === "dossier") throw new Error("C'est un dossier : utilisez sharepoint_list.");
      const r = await get(tok, `${drive(site)}/items/${itemId}/content`, {}, true);
      const ct = r.headers.get("content-type") || "";
      if (!/^text\/|^application\/(json|xml|csv)\b|\+(json|xml)\b/.test(ct)) return { ...meta, contentType: ct, note: "Binaire (docx, xlsx, pdf…) : ouvrez webUrl." };
      const text = await r.text();
      return { ...meta, truncated: text.length > MAX_TEXT, text: text.slice(0, MAX_TEXT) };
    },
  },
];
