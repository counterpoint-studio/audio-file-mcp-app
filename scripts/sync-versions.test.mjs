import { describe, it, expect } from "vitest";
import {
  replaceJsonVersions,
  replaceServerConstructorVersion,
} from "./sync-versions.mjs";

describe("replaceJsonVersions", () => {
  it("replaces every version field and reports the count", () => {
    const input = `{
  "version": "1.0.0",
  "packages": [{ "version": "1.0.0" }]
}`;
    const { updated, count } = replaceJsonVersions(input, "2.3.4");
    expect(count).toBe(2);
    expect(updated).toBe(`{
  "version": "2.3.4",
  "packages": [{ "version": "2.3.4" }]
}`);
  });

  it("leaves other version-suffixed keys alone", () => {
    const input = `{ "manifest_version": "0.3", "version": "1.0.0" }`;
    const { updated, count } = replaceJsonVersions(input, "2.0.0");
    expect(count).toBe(1);
    expect(updated).toBe(`{ "manifest_version": "0.3", "version": "2.0.0" }`);
  });

  it("preserves formatting outside the version fields", () => {
    const input = `{ "transport": { "type": "stdio" }, "version": "1.1.0" }`;
    const { updated } = replaceJsonVersions(input, "1.2.0");
    expect(updated).toBe(
      `{ "transport": { "type": "stdio" }, "version": "1.2.0" }`,
    );
  });
});

describe("replaceServerConstructorVersion", () => {
  it("replaces the version in the McpServer constructor", () => {
    const source = `const server = new McpServer({
  name: "Audio File MCP App",
  version: "1.1.0",
});`;
    expect(replaceServerConstructorVersion(source, "1.2.0")).toBe(
      `const server = new McpServer({
  name: "Audio File MCP App",
  version: "1.2.0",
});`,
    );
  });

  it("does not touch version literals outside the constructor", () => {
    const source = `const other = { version: "9.9.9" };
const server = new McpServer({ name: "x", version: "1.0.0" });`;
    const result = replaceServerConstructorVersion(source, "2.0.0");
    expect(result).toContain(`{ version: "9.9.9" }`);
    expect(result).toContain(`version: "2.0.0" }`);
  });

  it("throws when no McpServer version is present", () => {
    expect(() =>
      replaceServerConstructorVersion(`const x = 1;`, "1.0.0"),
    ).toThrow(/McpServer/);
  });
});
