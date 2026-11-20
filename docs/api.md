# API

Base path: `/api/v1`

Errors from Fastify use its default error shape until the authentication and scan routes introduce the shared error schema. The health route below is the only implemented endpoint.

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
