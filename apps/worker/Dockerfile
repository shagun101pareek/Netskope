FROM mcr.microsoft.com/playwright:v1.65.1-noble

USER root
WORKDIR /app

ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @netskope/database exec prisma generate

ENV NODE_ENV=production

CMD ["pnpm", "--filter", "@netskope/worker", "start"]
