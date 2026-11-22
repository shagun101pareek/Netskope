# Docker

`docker-compose.yml` at the repository root runs PostgreSQL and Redis for local development. The web app, API, and worker stay on the host so they can be restarted independently:

```bash
pnpm infra:up
pnpm dev
```

`docker-compose.prod.yml` builds the three application images and runs them with their own Postgres and Redis. It does not replace the local compose file.

```bash
export ACCESS_TOKEN_SECRET="$(openssl rand -base64 32)"
docker compose -f docker-compose.prod.yml up --build
docker compose -f docker-compose.prod.yml run --rm api pnpm --filter @netskope/database exec prisma migrate deploy
```

The web image bakes `API_URL` in at build time. The default is `http://localhost:3011`, which matches the published API port. The worker image is `mcr.microsoft.com/playwright:v1.65.1-noble` so Chromium matches the Playwright version the worker imports. Set `shm_size` on that service; the compose file already does.

Do not copy `.env` into an image. Pass `DATABASE_URL`, `REDIS_URL`, and `ACCESS_TOKEN_SECRET` as environment variables. `ACCESS_TOKEN_SECRET` must be at least 32 characters.
