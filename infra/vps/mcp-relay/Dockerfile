# The relay has no dependencies, so this image is the runtime plus one file.
# Nothing is installed, nothing is fetched at build time, and there is no
# lockfile to go stale.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# package.json carries no dependencies. It is here for "type": "module" alone —
# without it node reparses the file as ESM after failing to read it as CommonJS,
# which works and warns on every boot.
COPY package.json ./
COPY src ./src

# node:22-alpine already ships an unprivileged `node` user. Nothing here writes
# to disk — the relay holds its state in memory and loses nothing on a restart
# beyond connections the tabs immediately re-open.
USER node

EXPOSE 8722

# wget is busybox's, already in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8722/healthz || exit 1

CMD ["node", "src/server.js"]
