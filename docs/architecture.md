# Architecture

Netskope is split into three processes so a slow or crashed browser never occupies an API request thread.

```text
Browser
  │
  ▼
apps/web          Next.js. Renders status, and later the inspector.
  │  HTTP / SSE
  ▼
apps/api          Fastify. Auth, validation, scan records, queue publishing.
  │  Prisma              BullMQ (Day 2)
  ▼                      ▼
PostgreSQL             Redis
                         ▲
                         │  job pickup
                    apps/worker
                         │
                         ▼
                    Chromium (Day 3+)
```

## What exists today

| Piece | Responsibility today |
| --- | --- |
| `apps/web` | Next.js on port 3010. Reads `GET /api/v1/health` and shows whether API, Postgres, Redis, and the worker are reachable. |
| `apps/api` | Fastify on port 3011. Registers and signs in users, checks a scan URL, writes a `PENDING` scan, and enqueues a BullMQ job. Refuses the scan when the worker heartbeat is missing. |
| `apps/worker` | Publishes `netskope:worker:heartbeat` and consumes the `scans` queue. Accepting a job sets the scan to `RUNNING`. It does not launch a browser. |
| `packages/database` | Prisma 7 schema and a shared client. Driver adapter is `@prisma/adapter-pg`. |
| `packages/shared` | Health types, payload guards, and the heartbeat contract. |
| Docker Compose | Postgres 17 and Redis 7 only. Host ports are 5434 and 6380 so a machine that already has those services on 5432 and 6379 is left alone. |

The API is considered healthy when Postgres and Redis are up. The worker is reported separately. A load balancer should not restart the API because the worker stopped; they are different failure domains. `POST /scans` refuses to enqueue work when the worker heartbeat is missing.

## Why the worker has no HTTP port

The worker's job is browser automation. An HTTP server on that process would invite the API, or a user, to trigger Chromium inside a request. Liveness is a Redis key instead. On shutdown the worker deletes the key. If the process is killed, the TTL expires and the API reports the worker as down.

## Data model

Users own scans. Deleting a user cascades to scans, requests, responses, and timings.

A network request is correlated by `(scan_id, request_id)`, where `request_id` is the Chrome DevTools Protocol id. Repeated calls to the same URL are different CDP ids, so they stay as separate rows. Redirect hops that reuse one CDP request id are stored on `redirect_chain` instead of breaking the unique key.

Timing columns are nullable. Unavailable browser timings stay `NULL`. Response bodies are not columns. `response_payload_reference` will point at an external object once capture exists, and the worker will enforce size and retention limits before writing it.

`scans.error_message` is only for failed scans. It is not part of the original field list; failed scans need a place to record why they failed without overloading the URL or status.

## Configuration

One `.env` file lives at the repository root. Package scripts run with the package directory as the working directory, so the API and worker import `@netskope/shared/load-env`, which walks up to that file. Next.js loads the same file from `apps/web/next.config.ts`.

## Authentication and the scan queue

Passwords are hashed with Argon2id. The access token is a 15 minute JWT sent as `Authorization: Bearer`. The refresh token is a random 32 byte value stored only as a SHA-256 hash, and the raw value is an httpOnly cookie scoped to `/api/v1/auth`. Refresh rotates the token. Presenting a rotated token revokes that user's active refresh tokens.

Scan creation resolves the hostname and rejects non-public addresses before a row is written. One user can have one `PENDING` or `RUNNING` scan for the same normalized URL. The queue job id is the scan id. The worker marks the scan `RUNNING` and leaves it there; browser capture is the next step, and jobs accepted before that step will not be replayed.

## Explicitly not built yet

Playwright, CDP capture, SSE, the inspector UI, analytics, and exports. The API does not fetch the submitted page. Redirect targets are not followed yet, so they must be checked again when the browser is added.
