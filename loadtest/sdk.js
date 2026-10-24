// Réexporte le SDK MCP et zod déjà installés par le hub (hub/node_modules) : aucune dépendance supplémentaire pour la campagne.
export { McpServer } from "../hub/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js";
export { StreamableHTTPServerTransport } from "../hub/node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js";
export { SSEServerTransport } from "../hub/node_modules/@modelcontextprotocol/sdk/dist/esm/server/sse.js";
export { Client } from "../hub/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
export { StreamableHTTPClientTransport } from "../hub/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js";
export { SSEClientTransport } from "../hub/node_modules/@modelcontextprotocol/sdk/dist/esm/client/sse.js";
export { z } from "../hub/node_modules/zod/index.js";
