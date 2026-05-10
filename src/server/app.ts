import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod";

const server = new McpServer({
  name: "Audio File MCP App",
  version: "1.0.0",
});

const resourceUri = "ui://ctpt.co/audio-file/mcp-app.html";

registerAppTool(
  server,
  "display-audio-file",
  {
    title: "Display aufio file",
    description: "Display a UI for an audio file, providing the user with playback, metadata, and statistics",
    inputSchema: z.object({
       path: z.string().describe("Path to the local audio file to display")
    }),
    _meta: { ui: { resourceUri } },
  },
  async ({ path }) => {
    return {
      content: [{ type: "text", text: path }],
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
