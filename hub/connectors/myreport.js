// Connecteur MyReport : proxy MCP distant vers le serveur MCP de l'instance MyReport (MyReport Server), en HTTP SSE.
// Aucune logique métier ici : les requêtes d'analyse sont transférées telles quelles, avec le jeton personnel
// que chaque collaborateur saisit dans le portail (users.json : myreport.apiKey). MyReport applique ses droits.
// MODE SIMULÉ : sans MYREPORT_MCP_URL, deux outils fictifs répondent localement (tests Docker Desktop).
import { z } from "zod";
import { withMcp, callRemote } from "../mcpclient.js";

const MCP_URL = process.env.MYREPORT_MCP_URL || "";
const HEADER = process.env.MYREPORT_AUTH_HEADER || "Authorization"; // ex. X-Api-Key si MyReport Server l'exige
const WRITE = /create|update|delete|remove|write|set_|move|copy|purge/i; // garde-fou lecture seule sur les noms d'outils

export const id = "myreport";
export const label = "MyReport";
export const mock = !MCP_URL;
export const apiKey = { mode: "bearer", label: "jeton personnel MyReport Server" };

const headers = (tok) => ({ [HEADER]: HEADER === "Authorization" ? `Bearer ${tok.apiKey}` : tok.apiKey });
const mcp = (tok, fn) => withMcp({ url: MCP_URL, headers: headers(tok), sse: true, label: "MyReport MCP" }, fn);

// ---- Simulateur local ----
const MOCK_TOOLS = [
  { name: "liste_indicateurs", description: "Indicateurs financiers publiés (simulé)", inputSchema: { type: "object", properties: {} } },
  { name: "valeur_indicateur", description: "Valeur mensuelle d'un indicateur (simulé)", inputSchema: { type: "object", properties: { code: { type: "string" }, mois: { type: "string" } }, required: ["code"] } },
];
const MOCK = {
  liste_indicateurs: () => [{ code: "CA_HT", libelle: "Chiffre d'affaires HT" }, { code: "MARGE_BRUTE", libelle: "Marge brute" }, { code: "TRESO", libelle: "Trésorerie nette" }],
  valeur_indicateur: ({ code, mois = "2026-09" }) => ({ code, mois, valeur: { CA_HT: 1842300, MARGE_BRUTE: 611200, TRESO: 904500 }[code] ?? null, devise: "EUR" }),
};

/** Outils du serveur MyReport (hors noms d'écriture), avec leurs schémas. */
export const schema = (tok) => mock
  ? Promise.resolve({ tools: MOCK_TOOLS })
  : mcp(tok, async (c) => ({ tools: (await c.listTools()).tools.filter((t) => !WRITE.test(t.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) }));

export async function ping(_tok, schema) {
  const { tools } = await schema();
  return { message: mock ? `Mode simulé actif · ${tools.length} outils MyReport fictifs` : `Proxy SSE connecté à ${MCP_URL} · ${tools.length} outils`, tables: tools.map((t) => t.name) };
}

export const tools = [
  {
    name: "myreport_tools",
    description: "Outils d'analyse exposés par le serveur MCP MyReport, avec leur schéma d'arguments. À appeler avant myreport_call.",
    input: {},
    run: async (_tok, _a, schema) => (await schema()).tools,
  },
  {
    name: "myreport_call",
    description: "Transfère une requête d'analyse financière à MyReport Server avec le jeton de l'utilisateur, ex. tool='liste_indicateurs'.",
    input: { tool: z.string().regex(/^[\w.-]+$/), arguments: z.record(z.string(), z.any()).default({}) },
    run: async (tok, { tool, arguments: args }) => {
      if (WRITE.test(tool)) throw new Error(`Outil ${tool} refusé : la passerelle est en lecture seule.`);
      if (mock) { if (!MOCK[tool]) throw new Error(`Outil ${tool} inconnu du simulateur`); return MOCK[tool](args); }
      return mcp(tok, (c) => callRemote(c, tool, args));
    },
  },
];
