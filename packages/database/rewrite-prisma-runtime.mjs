import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./src/generated/prisma/", import.meta.url));
const from = '"@prisma/client/runtime/client"';
const to = '"@prisma/client/runtime/client.mjs"';

await rewrite(root);

async function rewrite(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await rewrite(fullPath);
      continue;
    }
    if (!entry.name.endsWith(".ts")) {
      continue;
    }
    const source = await readFile(fullPath, "utf8");
    if (!source.includes(from)) {
      continue;
    }
    await writeFile(fullPath, source.replaceAll(from, to));
  }
}
