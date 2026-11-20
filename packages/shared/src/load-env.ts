import { existsSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";

/**
 * Loads the repository-root .env.
 * pnpm and Turbo run package scripts with the package directory as cwd,
 * so a package-local .env would split configuration across apps.
 */
const candidates = [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "../../.env"),
];

const envFile = candidates.find((candidate) => existsSync(candidate));

if (envFile) {
  config({ path: envFile });
}
