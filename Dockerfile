# syntax=docker/dockerfile:1

ARG NODE_VERSION=20-alpine

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION} AS base
WORKDIR /app
ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit

FROM base AS deps-dev
COPY package.json package-lock.json ./
RUN npm ci --no-audit

FROM deps-dev AS test
COPY . .
RUN npm run lint && npm test

FROM base AS runtime

RUN apk add --no-cache tini

RUN addgroup -S nodejs && adduser -S nodeapp -G nodejs

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=nodeapp:nodejs . .

RUN rm -rf tests eslint.config.js .env.example

USER nodeapp

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
