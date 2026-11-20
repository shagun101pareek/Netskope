import "./load-env.js";
import { env } from "./lib/env.js";
import { buildApp } from "./app.js";

const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down api");
  await app.close();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT").then(() => process.exit(0));
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM").then(() => process.exit(0));
});

try {
  await app.listen({ host: env.apiHost, port: env.apiPort });
} catch (error) {
  app.log.error({ err: error }, "api failed to start");
  await app.close();
  process.exit(1);
}
