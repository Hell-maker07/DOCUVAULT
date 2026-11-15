import { createApp } from './app.js';
import { config } from './config/env.js';
import { closePool } from './config/db.js';

const server = createApp().listen(config.PORT, () => {
  console.log(`DocuVault API listening on :${config.PORT} (${config.NODE_ENV})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
