# Project status

## Current day

Day 2 — Authentication and job queue. Implemented and verified on 20 Nov 2026, on branch `feature/authScanQueue`.

## Completed tasks

- pnpm workspace and Turborepo are in place for `apps/web`, `apps/api`, `apps/worker`, `packages/database`, `packages/shared`, and `packages/config`.
- Docker Compose runs PostgreSQL 17 and Redis 7. Both containers reported healthy.
- Prisma 7 schema is migrated. Tables: `users`, `scans`, `network_requests`, `network_responses`, `request_timings`. Foreign keys cascade on delete.
- Fastify serves `GET /api/v1/health`.
- The worker process publishes `netskope:worker:heartbeat` and removes it on shutdown. It does not launch a browser.
- The web app renders that health report.
- `pnpm typecheck`, `pnpm test` (6 tests), and `pnpm lint` passed.
- Live check: health returned `postgres: up`, `redis: up`, `worker: up`. Deleting the heartbeat made `worker` `down` without failing the API, and the next beat restored it. `http://localhost:3010` returned 200 and showed all four services up.

Day 2:

- Registration, login, refresh, and logout. Passwords use Argon2id. Refresh tokens are hashed and rotated.
- `POST /scans` checks the URL, requires a live worker, writes a `PENDING` scan, and enqueues BullMQ job `scans`.
- The worker accepts the job and sets the scan to `RUNNING`. It does not open a browser.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed: 18 API tests and 2 worker tests.
- Live check: a registered user created `https://1.1.1.1/cdn-cgi/trace`, and the running worker moved it to `RUNNING` with `startedAt` set.

## Pending tasks

- Day 3: Playwright opens an isolated browser for a `RUNNING` scan and records network events. Do not mark those scans `COMPLETED` until capture actually finishes.
- Redirect targets are not rechecked yet. That check belongs in the worker when navigation exists.
- Application Docker images (Day 14).

## Known bugs

- A scan accepted by the worker stays `RUNNING`. The queue job is finished, so it will not be picked up again when browser capture is added. New scans created after that change will go through capture.

## Architectural decisions

- The API and the worker are separate processes. The worker has no HTTP server. Liveness is a Redis key with a 15 second TTL, refreshed every 5 seconds.
- API health stays `ok` when only the worker is down. Postgres or Redis being down returns 503. Scan creation, once it exists, will refuse work when the worker key is missing.
- Request correlation key is `(scan_id, request_id)` where `request_id` is the Chrome DevTools Protocol id. Redirect hops that reuse that id go in `redirect_chain`.
- Timing columns are nullable. Unavailable measurements stay NULL, not zero.
- Response bodies are not stored in relational columns. `response_payload_reference` is reserved for an external object.
- `scans.error_message` records why a scan failed.
- Host ports are 3010 (web), 3011 (API), 5434 (Postgres), and 6380 (Redis) because 3000, 3001, 5432, and 6379 were already taken on this machine. Container-internal Postgres and Redis ports are unchanged.
- Shared package imports are extensionless so Next.js Turbopack can compile the TypeScript source.
- pnpm is allowed to run build scripts for `prisma`, `@prisma/engines`, `esbuild`, and `msgpackr-extract`. BullMQ uses the last of those for queue serialization.
- Access tokens are JWTs. Refresh tokens are random, stored as SHA-256 hashes, and delivered only in an httpOnly cookie. Rotation reuse revokes that user's active refresh tokens.
- Scan admission rejects non-public http(s) destinations before a row is written. A partial unique index allows one `PENDING` or `RUNNING` scan per user and URL. Prisma cannot model that predicate, so the index lives in the SQL migration and must not be dropped by a later generated migration.

## Next implementation steps

Day 3 only: the worker launches Chromium for a scan it has marked `RUNNING`, captures the first network events, and still does not pretend the scan is complete until the capture path is real.
