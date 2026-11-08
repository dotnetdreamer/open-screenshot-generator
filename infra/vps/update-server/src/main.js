// Starts the update server: reads the environment, loads DATA_DIR, listens.
// The server itself is in server.js, which the tests start on their own.

import { createUpdateServer } from './server.js';

const PORT = Number(process.env.PORT || 8730);
const DATA_DIR = process.env.DATA_DIR || '/data';
// The base of every download URL the updater is handed, so it is the address
// clients reach this server at, not the one it listens on.
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;
// Trimmed, because a .env line saved on Windows ends in a carriage return.
const ADMIN_TOKEN = (process.env.UPDATES_ADMIN_TOKEN || '').trim();
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 1073741824);

let updates;
try {
  updates = createUpdateServer({
    dataDir: DATA_DIR,
    publicUrl: PUBLIC_URL,
    adminToken: ADMIN_TOKEN,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    log: (line) => console.log(line),
  });
} catch (error) {
  console.log(`[updates] cannot start: ${error.message}`);
  process.exit(1);
}

if (!updates.adminEnabled) {
  console.log(
    ADMIN_TOKEN
      ? '[updates] UPDATES_ADMIN_TOKEN is shorter than 32 characters, so the admin API is off'
      : '[updates] UPDATES_ADMIN_TOKEN is not set, so the admin API is off'
  );
}

updates.ready.then(
  () => {
    updates.server.listen(PORT, () => {
      console.log(`[updates] listening on :${PORT}, download URLs start ${PUBLIC_URL}`);
    });
  },
  (error) => {
    const uid = typeof process.getuid === 'function' ? ` (uid ${process.getuid()})` : '';
    console.log(`[updates] cannot use ${DATA_DIR}: ${error.message}. It has to be writable by this process${uid}`);
    process.exit(1);
  }
);

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (stopping) process.exit(0);
    stopping = true;
    // Requests in flight get until just before docker stop gives up at 10
    // seconds. An upload cut off here leaves a file in tmp/, which the next
    // start removes.
    updates.server.close(() => process.exit(0));
    updates.server.closeIdleConnections();
    setTimeout(() => process.exit(0), 8_000).unref();
  });
}
