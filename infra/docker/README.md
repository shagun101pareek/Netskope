# Docker

`docker-compose.yml` at the repository root runs PostgreSQL and Redis for local development.

Application images for the web app, API, and worker are added when the deployment configuration is finished. They are not defined here yet, because the processes are still run directly with `pnpm dev` and a Dockerfile that has not been exercised would only look finished.
