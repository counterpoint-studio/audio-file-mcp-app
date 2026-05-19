#!/usr/bin/env node
import { readFile, writeFile, chmod } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "dist/server/app.js");
const shebang = "#!/usr/bin/env node\n";

const contents = await readFile(target, "utf8");
if (!contents.startsWith("#!")) {
  await writeFile(target, shebang + contents);
}
await chmod(target, 0o755);
