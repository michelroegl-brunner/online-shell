# syntax=docker/dockerfile:1.7
# Web app (Next.js standalone). Built by deploy/docker-compose.yml.

FROM node:24-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@10.31.0 --activate
WORKDIR /app

# ---- Dependencies (whole workspace lockfile, web package only) ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY runner/package.json ./runner/package.json
COPY prisma ./prisma
COPY prisma.config.ts ./
# postinstall runs `prisma generate` (no DB needed).
RUN pnpm install --frozen-lockfile --filter online-shell

# ---- Build ----
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=deps /app/generated ./generated
ENV SKIP_ENV_VALIDATION=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=4096
RUN mkdir -p public && pnpm build

# ---- Runtime ----
FROM node:24-slim AS runner
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=nextjs:nodejs /app/generated ./generated
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
# Full node_modules on top of the traced one: the entrypoint needs the Prisma
# CLI for `migrate deploy`.
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Exercise content + importer (docker compose exec web node deploy/import-exercises.mjs …)
COPY --chown=nextjs:nodejs deploy/import-exercises.mjs ./deploy/import-exercises.mjs
COPY --chown=nextjs:nodejs content ./content

COPY --chown=nextjs:nodejs deploy/web-entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

USER nextjs
EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
