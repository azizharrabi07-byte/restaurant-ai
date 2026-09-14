# syntax=docker/dockerfile:1

FROM node:20-alpine AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# The committed lockfile is in sync, so `npm ci` is reproducible. Do NOT add an
# `|| npm install` fallback: it silently masks lockfile drift, which is exactly
# what broke CI.
RUN npm ci

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# AI/API keys are injected at runtime via environment variables,
# never baked into the image.
# The build is VERIFIED to succeed with zero env vars set (Supabase/Mistral
# simply report as unconfigured). Do NOT "fix" a build failure by injecting
# fake keys here.
RUN npm run build \
  || (echo "Build failed. Check code or set the required env vars in your shell before 'docker compose build'." && exit 1)

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# `public/` is tracked in git via public/.gitkeep, so this COPY always has a
# source; Next's standalone output does not include it.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000
# Next's standalone server.js binds to process.env.HOSTNAME || "0.0.0.0", and
# Docker sets HOSTNAME to the container id — pin it so the in-container
# healthcheck (http://localhost:3000/api/health) resolves.
ENV HOSTNAME=0.0.0.0

# Same probe as docker-compose.yml. /api/health needs no env vars and does not
# touch the database, so an unconfigured container is still reported alive.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]