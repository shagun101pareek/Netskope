import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import type { NextConfig } from "next";

const appDir = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(appDir, "../../.env") });

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@netskope/shared"],
  env: {
    API_URL: process.env.API_URL ?? "http://localhost:3011",
  },
};

export default nextConfig;
