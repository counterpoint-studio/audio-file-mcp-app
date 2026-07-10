// Syncs the package.json version into the other files that carry a version
// string: server.json (MCP registry manifest), mcpb/manifest.json, and the
// McpServer constructor in src/server/app.ts. Runs as the npm `version`
// lifecycle script so `pnpm version <bump>` keeps everything in lockstep.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function replaceJsonVersions(text, version) {
  let count = 0;
  const updated = text.replace(
    /("version"\s*:\s*")[^"]+(")/g,
    (_, before, after) => {
      count += 1;
      return before + version + after;
    },
  );
  return { updated, count };
}

export function replaceServerConstructorVersion(source, version) {
  const pattern = /(new McpServer\(\s*\{[\s\S]*?version:\s*")[^"]+(")/;
  if (!pattern.test(source)) {
    throw new Error("no McpServer version literal found");
  }
  return source.replace(pattern, `$1${version}$2`);
}

const JSON_TARGETS = [
  { file: "server.json", expectedCount: 2 },
  { file: "mcpb/manifest.json", expectedCount: 1 },
];

function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { version } = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );

  for (const { file, expectedCount } of JSON_TARGETS) {
    const filePath = path.join(root, file);
    const { updated, count } = replaceJsonVersions(
      fs.readFileSync(filePath, "utf8"),
      version,
    );
    if (count !== expectedCount) {
      throw new Error(
        `${file}: expected ${expectedCount} "version" fields, found ${count}`,
      );
    }
    fs.writeFileSync(filePath, updated);
    console.log(`${file} -> ${version}`);
  }

  const appPath = path.join(root, "src", "server", "app.ts");
  fs.writeFileSync(
    appPath,
    replaceServerConstructorVersion(fs.readFileSync(appPath, "utf8"), version),
  );
  console.log(`src/server/app.ts -> ${version}`);
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
