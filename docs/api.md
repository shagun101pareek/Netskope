# API

Base path: `/api/v1`

Authenticated routes expect `Authorization: Bearer <access token>`. The access token lives for 15 minutes. The refresh token is an httpOnly cookie named `netskope_refresh`, scoped to `/api/v1/auth`.

Failed requests use this body:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed." } }
```

## POST /api/v1/auth/register

Creates a user and a session. `201` returns the user, `accessToken`, and `expiresIn`. The refresh token is only in the cookie.

```json
{ "email": "ada@example.com", "password": "correct-horse-battery" }
```

`409` if the email is already registered. `429` after 10 attempts from the same address in 10 minutes.

## POST /api/v1/auth/login

Checks the password and starts a session. `200` has the same body as registration. Unknown emails and wrong passwords both return `401`. `429` after 20 attempts in 10 minutes.

## POST /api/v1/auth/refresh

Reads the refresh cookie, rotates it, and returns a new access token. `401` if the cookie is missing, expired, or already used. Reuse of a rotated token revokes that user's active refresh tokens.

## POST /api/v1/auth/logout

Revokes the refresh token in the cookie and clears it. `204` when the cookie is present. `401` when it is not.

## POST /api/v1/scans

Requires authentication. Body: `{ "url": "https://example.com" }`.

The URL must be absolute http or https, must not contain credentials, and must not resolve to a loopback, private, link-local, or metadata address. `201` returns `{ "scan": { ... } }` with status `PENDING`.

`409` when this user already has a `PENDING` or `RUNNING` scan of the same normalized URL. `503` with code `WORKER_UNAVAILABLE` when the worker heartbeat is missing. The scan row is not created in that case. `429` after 30 scans from the same user in 10 minutes. `503` with code `RATE_LIMIT_UNAVAILABLE` when Redis cannot count.

## GET /api/v1/scans

Requires authentication. Returns `{ "scans": [], "nextCursor": null }` for the signed-in user, newest first. `limit` is a stringified integer from 1 to 100 and defaults to 20. `cursor` is a scan id from `nextCursor`.

## GET /api/v1/scans/:id

Requires authentication. `200` returns `{ "scan": { ... } }` when the scan belongs to the user. `404` otherwise.

A new scan moves from `PENDING` to `RUNNING` when the worker accepts it. After Chromium loads the page, the status becomes `COMPLETED` and `completedAt` is set. A blocked destination or a browser failure ends as `FAILED` with `errorMessage`. Captured requests, responses, redirect hops, failures, timing phases, and a request class are stored under the browser's protocol request id. A timing phase the browser did not report is null.

Optional body field: `captureBodies` (boolean, default false). When true, the worker stores redacted text response bodies up to 64 KB, except on authentication and payment paths and for binary content. The scan object includes `captureBodies`.

## GET /api/v1/scans/:id/requests

Requires authentication. Query: `q` matches the URL, `method`, `status` (`2xx`, `3xx`, `4xx`, `5xx`, `failed`, or an exact code), `requestClass` (`DOCUMENT`, `STATIC`, `API`, `OTHER`), `sort` (`timestamp`, `duration`, `status`, `url`), and `limit` from 1 to 500, default 200.

Returns `{ "requests": [] }`. Each item has method, URL, class, status, failure reason, mime type, body size, and total duration. Headers and payloads are on the detail route.

## GET /api/v1/scans/:id/requests/:requestRowId

Requires authentication. Returns `{ "request": { ... } }` with redacted headers, the stored request payload, response metadata, timing, initiator, and redirect chain. `404` when the row is not on that scan.

## GET /api/v1/scans/:id/analytics

Requires authentication. Returns request count, failed count (status 400 or higher, or a failure reason), average latency in milliseconds, duplicate groups, the top duplicates, the five slowest requests, and a latency distribution. The average ignores rows whose total duration is null. It is null when no duration was measured.

## GET /api/v1/scans/compare?left=<id>&right=<id>

Requires authentication. Both scans must belong to the user and must differ. Keys are `METHOD url`. The body lists URLs only on the left, only on the right, and the largest positive and negative duration deltas.

## GET /api/v1/scans/:id/export?format=json|csv

Requires authentication. `json` is the default. CSV columns are method, url, request class, status, failure reason, and total duration. The response is an attachment.

## GET /api/v1/scans/:id/events

Requires authentication. `Content-Type: text/event-stream`. Each event is `data: {"type":"status","status":"RUNNING","errorMessage":null}`. A scan that is already `COMPLETED` or `FAILED` sends one event and closes. An in-progress scan stays open, listens on Redis channel `netskope:scan:<id>`, and also reads the row every 2 seconds. The browser client uses `fetch` with the bearer token. Request rows are not part of this stream.

## GET /api/v1/health

Reports process dependencies. No authentication. This route does not accept a URL and does not start a scan.

### Response

`200` when Postgres and Redis are reachable. `503` when either one is not. The worker check does not change the status code.

```json
{
  "status": "ok",
  "service": "api",
  "checks": {
    "postgres": "up",
    "redis": "up",
    "worker": "up"
  },
  "timestamp": "2026-11-19T17:00:00.000Z"
}
```

`status` is `ok` or `degraded`. Each check is `up` or `down`.

### Checks

| Check | How it is decided |
| --- | --- |
| `postgres` | `SELECT 1` through Prisma. |
| `redis` | `PING`. |
| `worker` | Redis key `netskope:worker:heartbeat` contains a JSON object with `service: "worker"` and `status: "ok"`. |

## Inspection routes

All of these require authentication and a scan owned by the caller.

`GET /api/v1/scans/:id/endpoints` groups API calls by method, host, and a normalized path. Filters: `method`, `status`, `domain`, `resourceType`, `endpoint`, `failed=1`, `slow=1`.

`GET /api/v1/scans/:id/invocations?key=` returns the captured calls for one endpoint key from the inventory.

`GET /api/v1/scans/:id/schemas` returns inferred request and response JSON Schemas. A single observation does not mark fields required.

`GET /api/v1/scans/:id/tests` and `POST /api/v1/scans/:id/tests/run` evaluate deterministic checks against stored calls. They do not send traffic. `PATCH /api/v1/scans/:id/tests/:testKey` accepts `{ "enabled": false }` or `{ "expected": 1000 }` for a status or latency budget.

`GET /api/v1/scans/:id/dependencies` returns nodes and edges. An edge exists only for a Chrome parent request or a script URL that was itself requested.

`POST /api/v1/scans/:id/requests/:requestRowId/replays` queues a replay on the worker. Body: `method`, `url`, `headers`, `body`, `confirmed: true`, and `confirmMutation: true` for POST, PUT, PATCH, and DELETE. `sendCredentials` must be omitted or false. Cookie and authorization headers are removed. The URL is checked again at execution time, including redirects. `202` returns the replay. `GET /api/v1/scans/:id/replays/:replayId` returns its result.

`GET /api/v1/scans/compare` still returns URL presence and duration deltas, and also `endpointChanges` and `regressions`.

Request detail includes query parameters, redacted bodies when they were stored, an omission reason when they were not, status text, remote address, and the initiator stack when Chrome provided one.
