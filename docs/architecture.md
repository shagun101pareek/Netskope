# Architecture

Netskope is split into three processes so a slow or crashed browser never occupies an API request thread.

```text
Browser
  │
  ▼
apps/web          Next.js. Sign-in, scan list, inspector, waterfall, analytics.
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
| `apps/web` | Next.js on port 3010. Sign-in, scan creation, request table, detail drawer, waterfall, analytics chart, comparison, and JSON or CSV download. Live status uses `fetch` against the event stream because `EventSource` cannot send a bearer token. |
| `apps/api` | Fastify on port 3011. Auth, URL checks, scan creation, request queries, analytics, comparison, export, and scan-status SSE. |
| `apps/worker` | Heartbeat, BullMQ consumer, one Chromium context per scan, classification, and a Redis status publish when a scan starts, finishes, or fails. |
| `packages/database` | Prisma 7 schema and a shared client. Driver adapter is `@prisma/adapter-pg`. |
| `packages/shared` | Health types, payload guards, the heartbeat contract, the URL safety check, and the scan event channel name. |
| Docker Compose | `docker-compose.yml` runs Postgres 17 and Redis 7 for local development. `docker-compose.prod.yml` builds the web, API, and worker images. Host ports are 5434 and 6380 so a machine that already has those services on 5432 and 6379 is left alone. |

The API is considered healthy when Postgres and Redis are up. The worker is reported separately. A load balancer should not restart the API because the worker stopped; they are different failure domains. `POST /scans` refuses to enqueue work when the worker heartbeat is missing.

## Why the worker has no HTTP port

The worker's job is browser automation. An HTTP server on that process would invite the API, or a user, to trigger Chromium inside a request. Liveness is a Redis key instead. On shutdown the worker deletes the key. If the process is killed, the TTL expires and the API reports the worker as down.

## Data model

Users own scans. Deleting a user cascades to scans, requests, responses, and timings.

A network request is correlated by `(scan_id, request_id)`, where `request_id` is the Chrome DevTools Protocol id. Events for the same id are one row. Redirect hops that reuse that id are stored on `redirect_chain`.

Timing columns are milliseconds. A phase Chrome did not record stays `NULL`, including a connection that was reused. A measured zero stays zero. Response bodies are not columns. `response_payload_reference` stays null.

`network_requests.request_class` is `DOCUMENT`, `STATIC`, `API`, or `OTHER`. A document stays a document even when the response is JSON. Static covers stylesheet, image, media, font, script, text track, and manifest. API covers fetch, XHR, event source, websocket, preflight, ping, a JSON or XML content type, or a path under `/api/`, `/graphql`, or `/vN/`. Anything else is `OTHER`. Rows captured before classification stay null.

`scans.error_message` is only for failed scans. It is not part of the original field list; failed scans need a place to record why they failed without overloading the URL or status.

## Configuration

One `.env` file lives at the repository root. Package scripts run with the package directory as the working directory, so the API and worker import `@netskope/shared/load-env`, which walks up to that file. Next.js loads the same file from `apps/web/next.config.ts`.

Node resolves `@prisma/client/runtime/client` to the CommonJS build, which does not expose `NullTypes` to an ESM import. `packages/database/rewrite-prisma-runtime.mjs` runs after `prisma generate` and points those imports at `client.mjs`. BullMQ re-exports `Queue` through a helper that Node's ESM loader does not treat as a named export, so the API and worker load those runtime values with `createRequire`.

## Authentication and the scan queue

Passwords are hashed with Argon2id. The access token is a 15 minute JWT sent as `Authorization: Bearer`. The refresh token is a random 32 byte value stored only as a SHA-256 hash, and the raw value is an httpOnly cookie scoped to `/api/v1/auth`. Refresh rotates the token. Presenting a rotated token revokes that user's active refresh tokens.

Scan creation resolves the hostname and rejects non-public addresses before a row is written. One user can have one `PENDING` or `RUNNING` scan for the same normalized URL. The queue job id is the scan id. The worker marks the scan `RUNNING`, opens a new browser context, and checks the navigation URL and every later request, including redirects, before Chromium connects. A page that finishes loading becomes `COMPLETED`. A policy rejection fails once. Other browser failures retry, then the scan becomes `FAILED`.

The browser is launched without a remote debugging port. The context is closed when the scan finishes, fails, or times out. The Chromium process closes when the worker shuts down. Jobs that had already reached `RUNNING` before this capture existed are not replayed.

The worker publishes `{ type: "status", status }` on Redis channel `netskope:scan:<scan id>` when a scan becomes `RUNNING`, `COMPLETED`, or `FAILED`. The API also polls the row every two seconds while an event stream is open. Requests are inserted in one transaction at the end of capture, so the stream does not emit individual requests. The client refetches the table when the status is terminal.

Scan creation is limited to 30 requests per user in 10 minutes. If Redis cannot count, creation fails closed.

## Explicitly not built

Response bodies are not stored. The product does not crawl past the first page, generate API documentation, or build a dependency graph. The API does not fetch the submitted page itself.
