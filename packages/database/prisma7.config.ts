import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(packageDir, "../../.env") });

const localDevelopmentUrl =
  "postgresql://netskope:netskope@localhost:5434/netskope?schema=public";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    "DATABASE_URL is not set. Prisma CLI is using the local Docker Compose default. Copy .env.example to .env before migrating.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl ?? localDevelopmentUrl,
  },
});
