import postgres from 'postgres';
import { runMigrations } from '../src/db/migrate.js';

/**
 * BD de test desde cero en cada ejecución. Las tablas append-only no admiten TRUNCATE (¡bien!),
 * así que en vez de vaciarlas se recrea el esquema completo con el rol dueño.
 */
export default async function setup() {
  const ownerUrl = process.env.TEST_MIGRATION_DATABASE_URL ?? 'postgres://velvet_owner:owner_dev_only@127.0.0.1:5432/velvet_void_test';
  const sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql.unsafe(`
    DROP SCHEMA IF EXISTS drizzle CASCADE;
    DROP SCHEMA IF EXISTS public CASCADE;
    CREATE SCHEMA public;
    REVOKE ALL ON SCHEMA public FROM PUBLIC;
    GRANT USAGE ON SCHEMA public TO velvet_app;
  `);
  await sql.end();
  await runMigrations(ownerUrl);
}
