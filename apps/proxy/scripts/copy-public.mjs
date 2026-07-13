import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "dist", "public");
mkdirSync(dest, { recursive: true });
cpSync(join(root, "src", "public"), dest, { recursive: true });
