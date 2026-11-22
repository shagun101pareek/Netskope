# Project status

## Current day

Day 14 — Finalization. Implemented on 22 Nov 2026, on branch `feature/verification`. The 14-day plan is in place on this branch. Nothing has been committed for Days 6–14.

## Completed tasks

- pnpm workspace and Turborepo are in place for `apps/web`, `apps/api`, `apps/worker`, `packages/database`, `packages/shared`, and `packages/config`.
- Docker Compose runs PostgreSQL 17 and Redis 7. Both containers reported healthy.
- Prisma 7 schema is migrated. Tables: `users`, `scans`, `network_requests`, `network_responses`, `request_timings`. Foreign keys cascade on delete.
- Fastify serves `GET /api/v1/health`.
- The worker process publishes `netskope:worker:heartbeat` and removes it on shutdown.
- The web app renders that health report.
- Live Day 1 check: health returned `postgres: up`, `redis: up`, `worker: up`. Deleting the heartbeat made `worker` `down` without failing the API, and the next beat restored it.

Day 2:

- Registration, login, refresh, and logout. Passwords use Argon2id. Refresh tokens are hashed and rotated.
- `POST /scans` checks the URL, requires a live worker, writes a `PENDING` scan, and enqueues BullMQ job `scans`.
- The worker accepts the job and sets the scan to `RUNNING`.
- Live check: a registered user created `https://1.1.1.1/cdn-cgi/trace`, and the running worker moved it to `RUNNING` with `startedAt` set.

Day 3:

- The worker launches headless Chromium and opens a new browser context for each scan. The context is closed after success, failure, and timeout. The browser process closes on worker shutdown. No remote debugging port is passed.
- Before navigation, and again for every HTTP request the page makes, the worker repeats the public-URL check. A blocked request is aborted. Redirects to a new host are checked again.
- Observed requests are stored with method, URL, resource type, redacted headers, and response status when Playwright reported one. Timing rows are not written. Response bodies are not stored.
- A page that loads is marked `COMPLETED`. A policy rejection fails once. Other browser errors retry, then the scan is marked `FAILED`.

Day 4:

- The same isolated context attaches to the Chrome DevTools Protocol `Network` domain. Cache is disabled for the capture so the events are for this load.
- `requestWillBeSent`, `responseReceived`, `loadingFinished`, and `loadingFailed` are correlated by the protocol request id. Concurrent requests stay separate. Redirect hops that reuse one id are stored on `redirect_chain`, oldest first.
- `body_size` is the encoded length from `loadingFinished` when Chrome sends a non-negative integer. It stays null when that event does not report one. Response bodies are not downloaded.
- A request that fails is stored with `failure_reason` and no invented status. A policy abort is recorded as "Blocked by scan policy".

Day 5:

- Each finished request can have a `request_timings` row. DNS, TCP connect, TLS, TTFB, download, and total duration are calculated from Chrome's `ResourceTiming` marks and the `loadingFinished` timestamp.
- Connect time stops where TLS starts. TTFB is the wait after the request is sent until response headers arrive. Download is the time from those headers until loading finishes. Total is loading finish minus `requestTime`.
- A mark of `-1` or a missing mark stays `NULL`. A measured duration of zero stays zero. Redirect rows keep the timing of the final response, not the hop that was replaced. Response headers and encoded size were already stored.

Day 6:

- Each stored request is classified as `DOCUMENT`, `STATIC`, `API`, or `OTHER` on `network_requests.request_class`. A document stays a document even when the body is JSON. Older rows stay null.

Day 7:

- API integration tests cover auth, scan ownership, classified request filters, analytics, comparison, CSV export, and a completed status event.
- Worker tests cover concurrent CDP correlation, redirects, failures, a disk-cached response, header redaction, timing, and a live Chromium capture of `https://example.com/` that expects `requestClass` `DOCUMENT`.

Day 8–11:

- The web app has sign-in, registration, a scan list, and a scan inspector. The inspector filters and sorts requests, opens a detail drawer, draws a waterfall, and subscribes to scan status with `fetch` because `EventSource` cannot send a bearer token.
- Request rows are written when capture finishes, so the table fills in after the scan completes. The event stream carries status only.

Day 12–13:

- Analytics returns the average of measured durations, failed requests, slow URLs, duplicates, and a latency distribution. The dashboard charts that distribution with Recharts.
- Two completed scans can be compared. JSON and CSV export are on the inspector. Scan creation is limited to 30 per user per 10 minutes and fails closed if Redis cannot count.
- `node scripts/perf.mjs` sent 50 requests to `GET /api/v1/health`. On this machine that was 50 requests in 200 ms, p50 2 ms, p95 9 ms. It does not start a browser.

Day 14:

- Dockerfiles exist for the API, worker, and web app. `docker-compose.prod.yml` runs them with Postgres and Redis. `docker-compose.yml` is still only the local data services, so `pnpm infra:up` is unchanged.
- README, architecture, API, and system-design notes describe the inspector, the event stream, and the images. Screenshots from a Playwright pass are in `docs/screenshots/`. No demo video was recorded.

## Pending tasks

- The application images are defined and have not been built on this machine.
- Days 6–14 are uncommitted.

## Known bugs

- Scans the worker had already marked `RUNNING` before capture existed are not replayed. Their queue jobs are finished. New scans go through capture.
- The URL check and Chromium's connect are separate DNS lookups. A name can change address between them. Connections are not pinned to the resolved IP.
- Host decisions are cached for the length of one scan, so a later request to the same host is not resolved again.

## Architectural decisions

- The API and the worker are separate processes. The worker has no HTTP server. Liveness is a Redis key with a 15 second TTL, refreshed every 5 seconds.
- API health stays `ok` when only the worker is down. Postgres or Redis being down returns 503. Scan creation refuses work when the worker key is missing.
- One Chromium process serves the worker. Isolation is a new browser context per scan, not a new browser per scan. Concurrent jobs do not share a context.
- Request correlation key is `(scan_id, request_id)`. `request_id` is the Chrome DevTools Protocol id.
- Timing columns are nullable milliseconds. Unavailable measurements stay NULL, not zero. A measured zero stays zero. `body_size` is null unless `loadingFinished` reported an encoded length.
- Response bodies are not stored in relational columns. `response_payload_reference` stays null.
- `scans.error_message` records why a scan failed.
- Sensitive headers are redacted in the worker before insert.
- Host ports are 3010 (web), 3011 (API), 5434 (Postgres), and 6380 (Redis) because 3000, 3001, 5432, and 6379 were already taken on this machine. Container-internal Postgres and Redis ports are unchanged.
- Shared package imports are extensionless so Next.js Turbopack can compile the TypeScript source. The URL policy is a separate export, `@netskope/shared/url-policy`, so the web bundle does not pull in `node:dns`.
- pnpm is allowed to run build scripts for `prisma`, `@prisma/engines`, `esbuild`, `msgpackr-extract`, and `playwright`.
- Access tokens are JWTs. Refresh tokens are random, stored as SHA-256 hashes, and delivered only in an httpOnly cookie. Rotation reuse revokes that user's active refresh tokens.
- Scan admission rejects non-public http(s) destinations before a row is written. A partial unique index allows one `PENDING` or `RUNNING` scan per user and URL. Prisma cannot model that predicate, so the index lives in the SQL migration and must not be dropped by a later generated migration.

## Next implementation steps

The 14-day plan is implemented. A commit, when requested, should exclude `.env`. Building `docker-compose.prod.yml` is the remaining exercise of the images.
