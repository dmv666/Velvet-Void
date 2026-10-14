import { createDb } from './db/client.js';
import { buildApp } from './app.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, sql } = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    await app.close();
    await sql.end({ timeout: 5 });
    process.exit(0);
  });
}

await app.listen({ port: env.PORT, host: env.HOST });
