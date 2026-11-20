function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredPort(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const port = Number(raw);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  return port;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  logLevel: process.env.LOG_LEVEL ?? "info",
  apiHost: process.env.API_HOST ?? "0.0.0.0",
  apiPort: requiredPort("API_PORT", 3011),
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3010",
  databaseUrl: required("DATABASE_URL"),
  redisUrl: required("REDIS_URL"),
  accessTokenSecret: requiredSecret("ACCESS_TOKEN_SECRET"),
};

function requiredSecret(name: string): string {
  const value = required(name);
  if (value.length < 32) {
    throw new Error(`${name} must be at least 32 characters`);
  }
  return value;
}
