FROM node:22-bookworm-slim

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @netskope/database exec prisma generate

ENV NODE_ENV=production
EXPOSE 3011

CMD ["pnpm", "--filter", "@netskope/api", "start"]
