import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import fs from "node:fs/promises";
import path from "node:path";
import * as z from "zod";
import { normalizeIncomingPath } from "./path-utils.js";

const server = new McpServer({
  name: "Audio File MCP App",
  version: "1.0.0",
});

const resourceUri = "ui://ctpt.co/audio-file/mcp-app.html";

const regionSchema = z.object({
  startSeconds: z.number().min(0).finite(),
  endSeconds: z.number().min(0).finite(),
});

let callSeq = 0;

registerAppTool(
  server,
  "display-audio-file",
  {
    title: "Display audio file",
    description: "Display a UI for an audio file, providing the user with playback, metadata, and statistics. Use when the user specifically asks to hear or see an audio file, or when otherwise clear from context that one would be helpful.",
    inputSchema: z.object({
      path: z
        .string()
        .describe("Absolute path to an audio file on the user's machine"),
      playheadSeconds: z
        .number()
        .min(0)
        .finite()
        .optional()
        .describe(
          "Optional initial playhead position in seconds (decimal)",
        ),
      region: regionSchema
        .optional()
        .describe(
          "Optional initial selected/highlighted region in seconds (decimal)",
        ),
    }),
    _meta: { ui: { resourceUri } },
  },
  async ({ path, playheadSeconds, region }) => {
    const normalized = normalizeIncomingPath(path);
    if (!normalized) {
      throw new Error("Path parameter is required");
    }
    const seq = ++callSeq;
    const createdAt = Date.now();
    const structuredContent: Record<string, unknown> = {
      path: normalized,
      createdAt,
      seq,
    };
    if (playheadSeconds !== undefined) {
      structuredContent.playheadSeconds = playheadSeconds;
    }
    if (region !== undefined && region.endSeconds > region.startSeconds) {
      structuredContent.region = region;
    }
    return {
      content: [{ type: "text", text: normalized }],
      structuredContent,
    };
  },
);

registerAppResource(
  server,
  resourceUri,
  resourceUri,
  {
    mimeType: RESOURCE_MIME_TYPE,
    _meta: { ui: { prefersBorder: false } },
  },
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

server.registerResource(
    "audiofile",
    new ResourceTemplate("audiofile://{path}", {list: undefined}),
    {
        description: "Audio file served as MCP resource (base64 blob)",
        mimeType: "application/octet-stream",
    },
    async (uri, { path }): Promise<ReadResourceResult> => {
        const pathStrRaw = Array.isArray(path) ? path[0] : path;
        if (!pathStrRaw) {
            throw new Error("Path parameter is required");
        }
        const pathStr = normalizeIncomingPath(decodeURIComponent(pathStrRaw));
        if (!pathStr) {
            throw new Error("Path parameter is required");
        }
        const exists = await fs.stat(pathStr).then(() => true).catch(() => false);
        if (!exists) {
            throw new Error(`File not found: ${pathStr}`);
        }
        console.error("[audiofile resource] Serving file:", pathStr);
        const data = await fs.readFile(pathStr, { encoding: "base64" });
        console.error("[audiofile resource] File size (base64):", data.length);
        return {
            contents: [
                { uri: uri.href, mimeType: "application/octet-stream", blob: data },
            ],
        };
    }
);


async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main();
