FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile

ARG API_URL=http://localhost:3011
ENV API_URL=$API_URL

RUN pnpm --filter @netskope/web build

ENV NODE_ENV=production
EXPOSE 3010

CMD ["pnpm", "--filter", "@netskope/web", "start"]
