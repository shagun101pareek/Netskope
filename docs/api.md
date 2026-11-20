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

`409` when this user already has a `PENDING` or `RUNNING` scan of the same normalized URL. `503` with code `WORKER_UNAVAILABLE` when the worker heartbeat is missing. The scan row is not created in that case.

## GET /api/v1/scans

Requires authentication. Returns `{ "scans": [], "nextCursor": null }` for the signed-in user, newest first. `limit` is a stringified integer from 1 to 100 and defaults to 20. `cursor` is a scan id from `nextCursor`.

## GET /api/v1/scans/:id

Requires authentication. `200` returns `{ "scan": { ... } }` when the scan belongs to the user. `404` otherwise.

A scan the worker has accepted has status `RUNNING` and a `startedAt` timestamp. Browser capture is not running yet, so the scan does not move to `COMPLETED` on its own.

## Not implemented

`/requests` and `/analytics` are not registered. Scan progress over SSE is not registered.

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

## Not implemented

`/auth/*`, `/scans`, `/requests`, and `/analytics` are specified for later days and are not registered.
