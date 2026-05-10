import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";

const server = new McpServer({
  name: "Audio File MCP App",
  version: "1.0.0",
});

const resourceUri = "ui://ctpt.co/audio-file/mcp-app.html";

registerAppTool(
  server,
  "say-hello",
  {
    title: "Say Hello",
    description: "A tool for testing",
    inputSchema: {},
    _meta: { ui: { resourceUri } },
  },
  async () => {
    return {
      content: [{ type: "text", text: "Hello: " + Math.round(Math.random() * 1000) }],
    };
  },
);

registerAppResource(
  server,
  resourceUri,
  resourceUri,
  { mimeType: RESOURCE_MIME_TYPE },
  async () => {
    const html = await fs.readFile(
      path.join(import.meta.dirname, "..", "..", "dist", "mcp-app.html"),
      "utf-8",
    );
    return {
      contents: [
        { uri: resourceUri, mimeType: RESOURCE_MIME_TYPE, text: html },
      ],
    };
  },
);


async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main();
