# Netskope implementation plan

This document records the audit of the existing product and the incremental work that turns it into a network inspection and API analysis tool. The three-process layout is unchanged: Next.js (`apps/web`), Fastify (`apps/api`), and the Chromium worker (`apps/worker`). PostgreSQL and Redis stay the system of record and the queue.

## Existing architecture

```text
Browser
  │
  ▼
apps/web          Next.js. Sign-in, scans, inspector.
  │  HTTP / SSE
  ▼
apps/api          Fastify. Auth, URL policy, scan records, queues.
  │  Prisma              BullMQ
  ▼                      ▼
PostgreSQL             Redis
                         ▲
                         │
                    apps/worker
                         │
                         ▼
                    Chromium via Playwright CDP
```

What was already working before this pass:

- Registration, login, refresh-token rotation, and scan ownership.
- SSRF checks on the submitted URL and again on every browser request, including redirects.
- Rate limits on auth and scan creation. Scan creation fails closed if Redis cannot count.
- `POST /scans` refuses work when the worker heartbeat is missing. A browser crash does not crash the API.
- CDP correlation by request id, redirect chains, redacted headers, timing phases, request class, waterfall, analytics, URL-level comparison, and JSON/CSV export.
- Request payloads up to 8 KB were stored, but they were not redacted and response bodies were not stored.

## What this pass adds

### Deep inspection

- Opt-in `captureBodies` on the scan. The default remains off.
- Response text is fetched with `Network.getResponseBody` only when capture is on, the MIME type is textual, the body is under 64 KB, and the path is not an authentication or payment route.
- Binary, missing, cancelled, and oversized bodies are stored as an omission reason, not as bytes.
- Request payloads are redacted before they are written. JSON redaction is recursive. Multipart uploads keep field names only.
- Query parameters, status text, remote address, request size, and initiator stacks are persisted when Chrome provides them.
- The request drawer has General, Query, request headers, response headers, Payload, Response, Timing, Initiator, and Replay.

### API explorer, schemas, and tests

- Endpoints are grouped by method, host, and a conservative path template. Numeric ids, UUIDs, and long hex segments become `{id}`. `/v1` and `/error/404` are not rewritten.
- Schemas are inferred when the scan is read. A field is required in the JSON Schema only when it appears in every sample and there are at least three samples. One observation is explicitly low confidence.
- Tests are generated from captured calls. Running them does not send traffic. Categories are contract, performance, and reliability. They are labeled as observed behavior, not as a business specification.
- Individual tests can be enabled or disabled. Status and latency budgets can be edited. Definitions export as JSON.

### Comparison, dependencies, analytics, replay

- Comparison still reports exact URL presence and duration deltas. It also reports normalized endpoint changes and schema regressions. Diffs use field names, not raw values.
- The dependency view connects a request only when Chrome recorded a parent request id or a script URL that was itself requested. Everything else stays an independent node.
- Analytics adds API success rate, median, p95, p99 (p99 only with at least 20 API samples), status and resource distributions, requests over time, largest responses, and third-party hosts.
- Replay is a second BullMQ queue consumed by the worker. The API never opens the socket. The user must confirm the send, and must confirm again for POST, PUT, PATCH, and DELETE. Cookie and authorization headers are stripped. The destination is rechecked, including each redirect, with the existing URL policy. Credentials are not forwarded and are not accepted from the replay form, because storing them would put secrets in Postgres or Redis.

## Database

Migration `20261123170000_inspection_platform`:

- `scans.capture_bodies`
- Request query params, size, payload truncation, and omission reason
- Response status text, remote address, redacted body, omission reason, and truncation flag
- `request_replays`
- `test_overrides`

Bodies stay in PostgreSQL because the cap is 64 KB. There is no object store in the current stack, and adding one is not justified at this size. Deleting a user or a scan cascades to requests, bodies, replays, and test overrides.

Schemas and generated tests are derived from the stored scan. The scan id is the version. A later scan is the history. Overrides are the only test rows that need their own table.

## API

Existing scan, request, analytics, compare, export, and event routes stay. New authenticated routes, all scoped to the signed-in user's scan:

- `GET /api/v1/scans/:id/endpoints`
- `GET /api/v1/scans/:id/invocations?key=`
- `GET /api/v1/scans/:id/schemas`
- `GET /api/v1/scans/:id/tests`
- `POST /api/v1/scans/:id/tests/run`
- `PATCH /api/v1/scans/:id/tests/:testKey`
- `GET /api/v1/scans/:id/dependencies`
- `POST /api/v1/scans/:id/requests/:requestRowId/replays`
- `GET /api/v1/scans/:id/replays/:replayId`

`POST /api/v1/scans` accepts optional `captureBodies`.

## Frontend

The scan page keeps the original workflow and adds Overview, Network, API Explorer, Test Cases, Comparisons, Dependencies, and Analytics. The dashboard checkbox is the opt-in for body capture.

## Testing

- Shared inspection tests cover redaction, multipart metadata, body policy, endpoint normalization, schema caution, generated failures, comparison, dependency edges, and replay confirmation.
- The CDP collector test covers JSON redaction, query secrets, status text, remote address, and stack frames.
- Existing API integration tests still cover ownership, analytics, comparison, and export.

## Limits, on purpose

- Body capture is off unless the user opts in, and it never includes auth or payment paths.
- Replay cannot attach credentials. Use another client when the target requires authentication.
- Tests evaluate stored traffic. They do not discover business rules and they do not mutate the target.
- P99 is hidden until there are 20 API samples.
- A dependency is not invented from request order.
- The product still loads one page. It does not crawl a site.

## Sequence that was followed

1. Audit the worker, API, schema, and inspector.
2. Add redaction, body policy, endpoint identity, schema inference, tests, comparison, and replay checks as pure functions.
3. Migrate the schema and teach the worker to persist the new fields.
4. Expose the data through owned API routes.
5. Surface it in the existing scan page.
6. Run the unit and integration tests that cover the new logic.
