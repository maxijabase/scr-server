# Single-stage build -- Bun ships a single binary runtime, no separate
# compile step and no Node/Yarn/PostCSS toolchain (unlike the old Go+packr
# build, which existed only to embed the now-removed web UI).
FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src

ENV NODE_ENV=production

EXPOSE 57452

CMD ["bun", "run", "src/index.ts"]
