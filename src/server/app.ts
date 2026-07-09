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
import { asScalar, parseNonNegInt } from "./range-params.js";
import { annotationDataSchema } from "../shared/annotation-data.js";
import { resolveAnnotations } from "./resolve-annotations.js";

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
  "display_audio_file",
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
      annotations: annotationDataSchema
        .optional()
        .describe(
          "Optional annotation lanes drawn between the waveform and spectrogram. " +
            "Each lane has an optional label, optional CSS color, spans [{start,end}] " +
            "in seconds, and an optional envelope ([{time,value}] with value 0..1) that " +
            "fades span opacity. Times are in seconds on the audio's own timeline.",
        ),
      annotationsPath: z
        .string()
        .optional()
        .describe(
          "Absolute path to a JSON file containing the same { lanes: [...] } structure " +
            "as `annotations`. Use instead of `annotations` for large payloads. Ignored if " +
            "`annotations` is also given.",
        ),
    }),
    _meta: { ui: { resourceUri } },
  },
  async ({ path, playheadSeconds, region, annotations, annotationsPath }) => {
    const normalized = normalizeIncomingPath(path);
    if (!normalized) {
      throw new Error("Path parameter is required");
    }
    const stat = await fs.stat(normalized);
    const seq = ++callSeq;
    const createdAt = Date.now();
    const structuredContent: Record<string, unknown> = {
      path: normalized,
      createdAt,
      seq,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
    };
    if (playheadSeconds !== undefined) {
      structuredContent.playheadSeconds = playheadSeconds;
    }
    if (region !== undefined && region.endSeconds > region.startSeconds) {
      structuredContent.region = region;
    }
    const resolvedAnnotations = await resolveAnnotations(
      { annotations, annotationsPath },
      (p) => fs.readFile(p, "utf-8"),
    );
    if (resolvedAnnotations) {
      structuredContent.annotations = resolvedAnnotations;
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

const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

// Base64 is returned in the `text` field rather than `blob` because Goose's
// MCP-Apps host only forwards `text` resource content to the iframe.
server.registerResource(
    "audiofile-range",
    new ResourceTemplate("audiofile-range://{path}/{start}/{length}", {
        list: undefined,
    }),
    {
        description:
            "Byte range of a local audio file as base64 in `text`; path/start/length are URL-encoded.",
        mimeType: "application/octet-stream;encoding=base64",
    },
    async (uri, { path, start, length }): Promise<ReadResourceResult> => {
        const rawPath = asScalar(path);
        if (!rawPath) throw new Error("Path parameter is required");
        const pathStr = normalizeIncomingPath(decodeURIComponent(rawPath));
        if (!pathStr) throw new Error("Path parameter is required");
        const startNum = parseNonNegInt(asScalar(start));
        const lengthNum = parseNonNegInt(asScalar(length));
        if (startNum === null || lengthNum === null) {
            throw new Error("start and length must be non-negative integers");
        }
        if (lengthNum === 0 || lengthNum > MAX_CHUNK_BYTES) {
            throw new Error(`length must be in (0, ${MAX_CHUNK_BYTES}]`);
        }
        const fh = await fs.open(pathStr, "r");
        try {
            const buf = Buffer.allocUnsafe(lengthNum);
            const { bytesRead } = await fh.read(buf, 0, lengthNum, startNum);
            const slice =
                bytesRead === lengthNum ? buf : buf.subarray(0, bytesRead);
            return {
                contents: [
                    {
                        uri: uri.href,
                        mimeType: "application/octet-stream;encoding=base64",
                        text: slice.toString("base64"),
                    },
                ],
            };
        } finally {
            await fh.close();
        }
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
}

main();
