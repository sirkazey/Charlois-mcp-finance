// Client MCP partagé par les connecteurs "proxy" (Dropbox, MyReport) : une session par appel, fermée ensuite.
// `headers` porte l'autorisation de l'utilisateur ; `sse` choisit le transport SSE (sinon Streamable HTTP).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export async function withMcp({ url, headers, sse = false, label = "MCP" }, fn) {
  const client = new Client({ name: "charlois-finance-hub", version: "1.0.0" });
  const opts = { requestInit: { headers } };
  const transport = sse ? new SSEClientTransport(new URL(url), opts) : new StreamableHTTPClientTransport(new URL(url), opts);
  try {
    await client.connect(transport);
    return await fn(client);
  } catch (e) {
    const cause = e.cause?.code || e.cause?.cause?.code; // fetch failed → ECONNREFUSED, ENOTFOUND…
    throw Object.assign(new Error(cause ? `${label} injoignable (${new URL(url).host}) : ${cause}` : `${label} : ${e.message}`), { status: e.code }); // StreamableHTTPError / SseError portent le statut HTTP
  } finally {
    await client.close().catch(() => {});
  }
}

/** Erreur réseau lisible : « Sage X3 injoignable (hôte:port) : ECONNREFUSED » au lieu de « fetch failed ». */
export const unreachable = (label, url, e) => new Error(`${label} injoignable (${new URL(url).host}) : ${e.cause?.code || e.cause?.message || e.message}`);

/** Texte d'une réponse d'outil MCP. */
export const toolText = (r) => r.content?.map((c) => c.text ?? JSON.stringify(c)).join("\n") ?? "";

/** Exécute un outil distant et renvoie son résultat : structuré si fourni, texte sinon ;
 *  un contenu non textuel (image, resource) est relayé tel quel au client MCP via { $content }. */
export async function callRemote(client, name, args) {
  const r = await client.callTool({ name, arguments: args });
  if (r.isError) throw new Error(toolText(r));
  if (r.content?.some((c) => c.type !== "text")) return { $content: r.content };
  return r.structuredContent ?? toolText(r);
}
