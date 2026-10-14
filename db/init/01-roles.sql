-- Dos roles con privilegios distintos (principio de mínimo privilegio):
--   velvet_owner: dueño del esquema, ejecuta migraciones.
--   velvet_app:   rol con el que corre el servidor. No puede alterar el esquema,
--                 y en las tablas append-only solo tiene INSERT/SELECT (ver migraciones).
-- Las contraseñas de desarrollo son públicas a propósito; en producción vienen de secretos.
CREATE ROLE velvet_owner LOGIN PASSWORD 'owner_dev_only';
CREATE ROLE velvet_app   LOGIN PASSWORD 'app_dev_only';
CREATE DATABASE velvet_void_test OWNER velvet_owner;
ALTER DATABASE velvet_void OWNER TO velvet_owner;
\connect velvet_void
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO velvet_owner;
GRANT USAGE ON SCHEMA public TO velvet_app;
\connect velvet_void_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO velvet_owner;
GRANT USAGE ON SCHEMA public TO velvet_app;
