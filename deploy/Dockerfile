FROM node:22-trixie-slim AS app

WORKDIR /app
RUN chown node:node /app
COPY --chown=node:node package.json package-lock.json ./
USER node
RUN npm ci --no-audit --no-fund

COPY --chown=node:node next.config.ts next-env.d.ts tsconfig.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node packages ./packages
COPY --chown=node:node server ./server
COPY --chown=node:node scripts/dev.mjs scripts/migrate.ts scripts/bootstrap-workspace.ts ./scripts/

ENV COSPACE_MODE=pilot NEXT_TELEMETRY_DISABLED=1
RUN npm run build

ENV NODE_ENV=production
CMD ["node", "scripts/dev.mjs", "--production"]

FROM caddy:2-alpine AS caddy

FROM app AS render
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
COPY --chown=node:node deploy/Caddyfile.example /app/deploy/Caddyfile
CMD ["node", "scripts/dev.mjs", "--render"]
