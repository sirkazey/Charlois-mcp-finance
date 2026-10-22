// Connecteur MyReport : proxy MCP distant vers le serveur MCP de l'instance MyReport (MyReport Server), en HTTP SSE.
// Aucune logique métier ici : les requêtes d'analyse sont transférées telles quelles, avec le jeton personnel
// que chaque collaborateur saisit dans le portail (users.json : myreport.apiKey). MyReport applique ses droits.
// MODE SIMULÉ : sans MYREPORT_MCP_URL, deux outils fictifs répondent localement (tests Docker Desktop), marqués "simule".
import { z } from "zod";
import { withMcp, callRemote } from "../mcpclient.js";

const MCP_URL = process.env.MYREPORT_MCP_URL || "";
const HEADER = process.env.MYREPORT_AUTH_HEADER || "Authorization"; // ex. X-Api-Key si MyReport Server l'exige
// Liste BLANCHE des outils MyReport transférables (lecture seule), à renseigner d'après myreport_tools. Vide = aucun transfert.
const ALLOW = (process.env.MYREPORT_TOOLS || "").split(",").map((s) => s.trim()).filter(Boolean);

export const id = "myreport";
export const label = "MyReport";
export const mock = !MCP_URL;
export const apiKey = { mode: "bearer", label: "jeton personnel MyReport Server" };
export const maxPerMinute = Number(process.env.MYREPORT_MAX_PER_MIN ?? 20); // MyReport n'a qu'une production : plafond d'appels sortants, tous utilisateurs confondus (0 = illimité)

const headers = (tok) => ({ [HEADER]: HEADER === "Authorization" ? `Bearer ${tok.apiKey}` : tok.apiKey });
const mcp = (tok, fn) => withMcp({ url: MCP_URL, headers: headers(tok), sse: true, label: "MyReport MCP" }, fn);

// ---- Simulateur local ----
const MOCK_TOOLS = [
  { name: "liste_indicateurs", description: "Indicateurs financiers publiés (simulé)", inputSchema: { type: "object", properties: {} } },
  { name: "valeur_indicateur", description: "Valeur mensuelle d'un indicateur (simulé)", inputSchema: { type: "object", properties: { code: { type: "string" }, mois: { type: "string" } }, required: ["code"] } },
];
const MOCK = {
  liste_indicateurs: () => ({ simule: true, indicateurs: [{ code: "CA_HT", libelle: "Chiffre d'affaires HT" }, { code: "MARGE_BRUTE", libelle: "Marge brute" }, { code: "TRESO", libelle: "Trésorerie nette" }] }),
  valeur_indicateur: ({ code, mois = "2026-09" }) => ({ simule: true, code, mois, valeur: { CA_HT: 1842300, MARGE_BRUTE: 611200, TRESO: 904500 }[code] ?? null, devise: "EUR" }),
};

/** Outils du serveur MyReport avec leurs schémas ; `autorise` indique s'ils figurent dans MYREPORT_TOOLS. */
export const schema = (tok) => mock
  ? Promise.resolve({ tools: MOCK_TOOLS.map((t) => ({ ...t, autorise: true })) })
  : mcp(tok, async (c) => ({ tools: (await c.listTools()).tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema, autorise: ALLOW.includes(name) })) }));

export async function ping(_tok, schema) {
  const { tools } = await schema();
  const ok = tools.filter((t) => t.autorise).length;
  return { message: mock ? `Mode simulé actif · ${tools.length} outils MyReport fictifs` : `Proxy SSE connecté à ${MCP_URL} · ${ok} / ${tools.length} outils autorisés (MYREPORT_TOOLS)`, tables: tools.map((t) => t.name + (t.autorise ? "" : " ✕")) };
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
    description: "Transfère une requête d'analyse financière à MyReport Server avec le jeton de l'utilisateur, ex. tool='liste_indicateurs'. Seuls les outils de la liste blanche MYREPORT_TOOLS sont transférés.",
    input: { tool: z.string().regex(/^[\w.-]+$/), arguments: z.record(z.string(), z.any()).default({}) },
    run: async (tok, { tool, arguments: args }) => {
      if (mock) { if (!MOCK[tool]) throw new Error(`Outil ${tool} inconnu du simulateur`); return MOCK[tool](args); }
      if (!ALLOW.includes(tool)) throw new Error(`Outil ${tool} refusé : absent de la liste blanche MYREPORT_TOOLS (lecture seule).`);
      return mcp(tok, (c) => callRemote(c, tool, args));
    },
  },
];
