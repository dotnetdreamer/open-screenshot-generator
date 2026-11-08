# The update server has no dependencies, so this image is the runtime plus its
# source. Nothing is installed or fetched at build time.
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# package.json lists no dependencies. It is here for "type": "module".
COPY package.json ./
COPY src ./src

# Releases, channel pointers and uploads in progress live in /data, which
# compose bind mounts from ./updates-data. Making it here, owned by node, is
# for a run without that mount; with it, the host folder has to belong to
# uid 1000.
RUN mkdir -p /data && chown node:node /data

# node:22-alpine ships an unprivileged `node` user, uid 1000.
USER node

EXPOSE 8730

# wget is busybox's, already in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8730/healthz || exit 1

CMD ["node", "src/main.js"]
