# System design

This note records the design that Day 1 put in place, and the constraints later days have to preserve.

## Goal

A user submits a website they are allowed to inspect. Netskope loads it in an isolated browser, records the network activity, and presents the requests the way a network inspector would: list, detail, waterfall, and aggregate performance.

## Process split

Browser automation is the slow, crashy part of the system. It runs in `apps/worker`. The API only validates input, writes a scan row, and enqueues a job. That queue is Redis via BullMQ, added on Day 2. The API must not call Playwright.

Isolation requirements already reflected in the schema and process layout:

- One scan belongs to one user.
- One worker job will own one browser context. Contexts must not be reused across scans.
- Concurrent scans are concurrent jobs, not concurrent work inside one browser context.
- Request correlation is per scan, using the CDP request id.

## Health versus readiness for scans

`GET /api/v1/health` answers "can the API use its database and queue?". It stays `ok` when the worker is down so the API process is not restarted for a worker failure. The worker check is still in the payload, and the future `POST /scans` handler will read that same heartbeat and reject new scans when it is absent.

## Persistence choices

PostgreSQL stores users, scans, request metadata, response metadata, and timings. Redis stores coordination state: today a heartbeat, next a BullMQ queue. Redis is not the system of record for scan results.

Large response bodies stay out of ordinary rows. The response table stores `body_size` and `response_payload_reference`. The object store or file layout is chosen when capture is implemented, together with a hard byte limit and a retention policy.

## Security boundary

Nothing in Day 1 fetches a user-supplied URL. Before the first scan endpoint is exposed, the API has to reject non-HTTP(S) schemes, localhost, private and link-local addresses, and cloud metadata endpoints, then re-check the address after DNS resolution and after every redirect. The worker must use the resolved address the API already approved, so DNS rebinding cannot swap the target after validation.

Sensitive headers are not collected yet. The schema comments mark `request_headers` and `response_headers` as redacted-before-write. Redaction has to happen in the worker before `INSERT`, not only in the UI.

## What this design does not do

It does not crawl past the first page, generate API documentation, or build a dependency graph. Those are outside the 14-day scope.
