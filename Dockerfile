FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --production --frozen-lockfile

COPY src ./src

ENV NODE_ENV=production

EXPOSE 57452

CMD ["bun", "run", "src/index.ts"]
