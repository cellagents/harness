# Harness image. Builds TypeScript to dist/ and ships compiled JS + public
# assets. The thin-client bundle is NOT bundled here any more (it lives in
# its own repo); mount or copy it into HARNESS_THIN_CLIENT_DIST at deploy
# time via the compose stack in game.cellagents.dev.
#
# Build context: this repo root.
#   docker build -t cellagents/harness .

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
COPY config.example.json ./config.example.json
ENV HARNESS_FRONTEND_PUBLIC=/app/public
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:5000/health >/dev/null || exit 1
CMD ["node", "dist/index.js"]
