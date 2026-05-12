import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

export function loadFixture(name: string): Uint8Array {
    return new Uint8Array(readFileSync(join(HERE, name)));
}
