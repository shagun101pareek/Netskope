# System design

This note records the design the implementation has to preserve.

## Goal

A user submits a website they are allowed to inspect. Netskope loads it in an isolated browser, records the network activity, and presents the requests the way a network inspector would: list, detail, waterfall, and aggregate performance.

## Process split

Browser automation is the slow, crashy part of the system. It runs in `apps/worker`. The API only validates input, writes a scan row, and enqueues a job. That queue is Redis via BullMQ, added on Day 2. The API must not call Playwright.

Isolation requirements already reflected in the schema and process layout:

- One scan belongs to one user.
- One worker job will own one browser context. Contexts must not be reused across scans.
- Concurrent scans are concurrent jobs, not concurrent work inside one browser context.
- Request correlation is per scan, using the Chrome DevTools Protocol request id. Concurrent events are matched by that id. Redirect hops that reuse it are stored on `redirect_chain`.

## Health versus readiness for scans

`GET /api/v1/health` answers "can the API use its database and queue?". It stays `ok` when the worker is down so the API process is not restarted for a worker failure. The worker check is still in the payload. `POST /scans` reads that same heartbeat and rejects new scans when it is absent.

## Persistence choices

PostgreSQL stores users, scans, request metadata, response metadata, timings, and request class. Redis stores the heartbeat, the BullMQ queue, rate-limit counters, and short-lived scan status messages. Redis is not the system of record for scan results.

Large response bodies stay out of ordinary rows. The response table stores `body_size` and `response_payload_reference`. The object store or file layout is chosen when capture is implemented, together with a hard byte limit and a retention policy.

## Security boundary

`POST /scans` rejects non-HTTP(S) schemes, credentialed URLs, localhost, private, link-local, and cloud-metadata destinations, including names whose DNS answers include any blocked address. It does not fetch the URL. The worker repeats that check for the navigation URL and for each request the page makes. A blocked request is aborted before connect. Redirects to a new host are checked again. Decisions for one host are reused only inside that scan.

The check and Chromium's own connect are still separate lookups, so a name can change address in that gap. Connections are not pinned to the resolved IP yet.

`authorization`, `cookie`, `set-cookie`, and token-like headers are replaced with `[redacted]` before insert. `body_size` is the encoded byte count from `Network.loadingFinished` when Chrome reports one, and stays null otherwise. Response bodies are not downloaded.

Timing rows are milliseconds from the protocol's `ResourceTiming` block. DNS, connect, TLS, TTFB, and download are separate phases. Connect stops where TLS starts. TTFB is the wait after the request is sent until response headers arrive. Download runs from those headers until `loadingFinished`. Total is `loadingFinished` minus `requestTime`. A mark of `-1`, or a missing mark, leaves that phase `NULL`.

Each stored request is classified once, at insert time. Document wins over a JSON content type. Analytics read at most 500 rows for a scan and compute the average only from durations that were actually measured.

Scan status is published on `netskope:scan:<id>` and also polled from PostgreSQL while a client holds the event stream. The stream does not carry request rows, because capture writes them in one transaction at the end.

## What this design does not do

It does not crawl past the first page, generate API documentation, or build a dependency graph. Those are outside the 14-day scope. No demo video is part of the repository.
