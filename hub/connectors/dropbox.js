// Connecteur passif Dropbox : proxy vers le serveur MCP officiel Dropbox (https://mcp.dropbox.com/mcp).
// Le hub se comporte en client MCP avec le jeton OAuth Dropbox de l'utilisateur ; Dropbox applique ses droits.
// Lecture seule : scopes OAuth *.read uniquement ET liste blanche d'outils (jamais create/move/copy/delete).
import { z } from "zod";
import { withMcp, toolText, callRemote } from "../mcpclient.js";

const MCP_URL = process.env.DROPBOX_MCP_URL || "https://mcp.dropbox.com/mcp";
const READ_ONLY = ["who_am_i", "list_folder", "search", "get_file_metadata", "fetch", "file_preview", "list_shared_links", "get_shared_link_metadata"];

export const id = "dropbox";
export const label = "Dropbox";
export const oauth = {
  authUrl: "https://www.dropbox.com/oauth2/authorize",
  tokenUrl: `${(process.env.DROPBOX_API_URL || "https://api.dropboxapi.com").replace(/\/$/, "")}/oauth2/token`,
  clientId: process.env.DROPBOX_APP_KEY,
  clientSecret: process.env.DROPBOX_APP_SECRET,
  scope: "account_info.read files.metadata.read files.content.read sharing.read",
  extraAuthParams: { token_access_type: "offline" }, // refresh_token Dropbox
};

const mcp = (tok, fn) => withMcp({ url: MCP_URL, headers: { Authorization: `Bearer ${tok.access_token}` }, label: "Dropbox MCP" }, fn);

/** Outils du serveur Dropbox restreints à la liste blanche lecture seule (nom, description, schéma d'entrée). */
export const schema = (tok) => mcp(tok, async (c) => ({
  tools: (await c.listTools()).tools.filter((t) => READ_ONLY.includes(t.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

export const identity = (tok) => mcp(tok, async (c) => toolText(await c.callTool({ name: "who_am_i", arguments: {} })).match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null);

export async function ping(_tok, schema) {
  const { tools } = await schema();
  return { message: `Connecté au serveur MCP Dropbox (${MCP_URL}) · ${tools.length} outils en lecture seule`, tables: tools.map((t) => t.name) };
}

export const tools = [
  {
    name: "dropbox_tools",
    description: "Outils Dropbox disponibles en lecture seule (list_folder, search, fetch…) avec leur schéma d'arguments. À appeler avant dropbox_call.",
    input: {},
    run: async (_tok, _a, schema) => (await schema()).tools,
  },
  {
    name: "dropbox_call",
    description: "Appelle un outil Dropbox en lecture seule avec les droits de l'utilisateur, ex. tool='list_folder', arguments={path:'/Finance'}.",
    input: { tool: z.enum(READ_ONLY), arguments: z.record(z.string(), z.any()).default({}) },
    run: (tok, { tool, arguments: args }) => mcp(tok, (c) => callRemote(c, tool, args)),
  },
];
