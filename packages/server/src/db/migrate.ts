import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

/** Ejecuta las migraciones con el rol DUEÑO del esquema (MIGRATION_DATABASE_URL). */
export async function runMigrations(url: string): Promise<void> {
  const { db, sql } = createDb(url, { max: 1 });
  try {
    await migrate(db, { migrationsFolder: new URL('../../drizzle', import.meta.url).pathname });
  } finally {
    await sql.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL no definida');
  await runMigrations(url);
  console.log('migraciones aplicadas');
}
