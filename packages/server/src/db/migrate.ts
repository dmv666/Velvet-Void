import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client.js';

/** Ejecuta las migraciones con el rol DUEÑO del esquema (MIGRATION_DATABASE_URL). */
export async function runMigrations(url: string): Promise<void> {
  const { db, sql } = createDb(url, { max: 1 });
  try {
    // En el bundle de producción la ruta relativa cambia: MIGRATIONS_DIR la fija explícitamente.
    const migrationsFolder = process.env.MIGRATIONS_DIR ?? new URL('../../drizzle', import.meta.url).pathname;
    await migrate(db, { migrationsFolder });
  } finally {
    await sql.end();
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL no definida');
  await runMigrations(url);
  console.log('migraciones aplicadas');
}
