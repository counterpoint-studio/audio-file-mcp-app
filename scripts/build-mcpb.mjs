#!/usr/bin/env node
import { execSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stageDir = resolve(repoRoot, "build/mcpb");
const distDir = resolve(repoRoot, "dist");
const binDir = resolve(repoRoot, "node_modules/.bin");
const viteBin = resolve(binDir, "vite");
const tscBin = resolve(binDir, "tsc");
const mcpbBin = resolve(binDir, "mcpb");

const pkg = JSON.parse(
  await readFile(resolve(repoRoot, "package.json"), "utf8"),
);
const version = pkg.version;
const outFile = resolve(distDir, `audio-file-mcp-app-${version}.mcpb`);

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", cwd: repoRoot, ...opts });
}

// 1. Build HTML + server JS (mirrors `pnpm run build:dist`)
run(`"${viteBin}" build`, { env: { ...process.env, INPUT: "mcp-app.html" } });
run(`"${tscBin}" -p tsconfig.server-build.json`);
run(`node scripts/add-shebang.mjs`);

// 2. Stage bundle dir
await rm(stageDir, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

await cp(resolve(repoRoot, "mcpb/manifest.json"), resolve(stageDir, "manifest.json"));
await cp(resolve(distDir, "server"), resolve(stageDir, "dist/server"), {
  recursive: true,
});
await cp(resolve(distDir, "mcp-app.html"), resolve(stageDir, "dist/mcp-app.html"));

const stagedPkg = {
  name: pkg.name,
  version: pkg.version,
  type: "module",
  dependencies: pkg.dependencies ?? {},
};
await writeFile(
  resolve(stageDir, "package.json"),
  JSON.stringify(stagedPkg, null, 2) + "\n",
);

// 3. Install production deps into staged dir (npm avoids the symlinked pnpm layout)
run("npm install --omit=dev --ignore-scripts --no-audit --no-fund", {
  cwd: stageDir,
});

// 4. Pack
if (existsSync(outFile)) await rm(outFile);
run(`"${mcpbBin}" pack "${stageDir}" "${outFile}"`);

console.log(`\nWrote ${outFile}`);
