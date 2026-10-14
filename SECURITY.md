# Seguridad en Velvet Void

> Proyecto educativo con créditos ficticios. Aun así, está construido como si el dinero fuera real: el objetivo es aprender
> **qué amenaza cubre cada defensa** y comprobarlo atacando el propio juego.

## Modelo de amenazas

| Atacante | Qué controla | Qué quiere |
|---|---|---|
| Jugador tramposo | Su navegador por completo: DevTools, peticiones a mano, scripts, muchas pestañas | Ganar más de lo que le toca, apostar sin saldo, cobrar dos veces |
| Sitio malicioso | Páginas que la víctima visita con la sesión abierta | Apostar o rotar semillas en nombre de la víctima (CSRF) |
| Atacante de red/fuerza bruta | Muchas peticiones, muchas IPs | Adivinar contraseñas, saturar el servidor |
| El propio casino (o un empleado) | El servidor y la base de datos | Elegir resultados a posteriori, alterar el historial |
| Intruso con la credencial de la BD | El rol `velvet_app` | Reescribir saldos o rondas |

El **principio central**: el cliente nunca decide. Solo envía *qué* quiere apostar (`betId`, `bet`). El servidor decide el resultado, el saldo y el premio, y el canvas se limita a animar hasta lo que ya está decidido.

---

## Defensas, una por una

### 1. RNG criptográfico (amenaza: predecir o sesgar resultados)
- Las semillas del servidor y los tokens de sesión salen de `crypto.randomBytes` (el CSPRNG del sistema operativo).
- Los resultados salen de `HMAC-SHA256(serverSeed, clientSeed:nonce:i)`, una función pseudoaleatoria con clave: sin la semilla, la salida es indistinguible del azar.
- Los enteros en `[0, n)` se obtienen **por rechazo**, no con `%`. Con `%`, los primeros `2³² mod n` valores saldrían más a menudo (sesgo de módulo).
- `Math.random` está prohibido en `game-math` y `server`: hay un test (`no-math-random.test.ts`) que analiza el código fuente. En el cliente solo se usa para decoración (grano del fondo y partículas).
- **Prueba:** test χ² sobre `int(30)`, vectores contra el HMAC de Node y una simulación de 10 millones de rondas que coincide con el RTP exacto (z = 0,27).

### 2. Provably fair (amenaza: que el casino elija el resultado después de ver la apuesta)
1. Antes de jugar, el servidor publica `SHA-256(serverSeed)`.
2. El jugador elige su `clientSeed`, así que el servidor no controla todas las entradas.
3. Cada ronda usa un `nonce` creciente.
4. Al rotar, el servidor revela `serverSeed` y el jugador recalcula cualquier ronda **en su navegador**, con el mismo paquete `game-math`.

Capas extra:
- **La base de datos comprueba el compromiso:** un trigger impide marcar como revelada una semilla cuyo SHA-256 no coincida con el hash publicado.
- **Semillas cifradas en reposo** (AES-256-GCM con el `user_id` como dato asociado). Un volcado de la BD no permite predecir tiradas futuras, y copiar el cifrado de un usuario a otro hace fallar la autenticación al descifrar.
- **El nonce solo avanza de uno en uno** (trigger), y hay una restricción `UNIQUE(seed_pair_id, nonce)`.

**Límite honesto:** el casino conoce `serverSeed` mientras el par está activo. Lo que impide es *cambiar* el resultado de una ronda ya comprometida, no conocerlo.

### 3. Saldo en el servidor, ledger inmutable y doble gasto (amenaza: cobrar dos veces o apostar sin saldo)
- **Ledger de doble entrada.** Cada movimiento es una transacción con dos patas que suman cero: jugador ↔ casa, regalos → jugador. Un trigger `DEFERRABLE` lo comprueba al hacer `COMMIT`.
- **El saldo no es un campo editable.** Es el `balance_after` de la última entrada inmutable. Un trigger exige `balance_after = anterior + amount` y `≥ 0`, así que la cadena de saldos se puede auditar de punta a punta.
- **Una apuesta es una sola transacción:** `SELECT … FOR UPDATE` sobre la cuenta → saldo → nonce → resultado → ronda → ledger → `COMMIT`. Si algo falla, no queda nada a medias.
- **Idempotencia.** Cada apuesta lleva un `betId` generado por el cliente, con `UNIQUE(user_id, bet_id)`. Repetir la petición (doble clic, reintento por red, ataque de repetición) devuelve la misma ronda **sin cobrar otra vez**. El mismo `betId` con otra cantidad da `409`.
- **Por qué no Redis:** el lock y la idempotencia viven en la misma transacción que mueve el dinero, así que no hay una segunda fuente de verdad que pueda desincronizarse.
- **Por qué las cuentas de sistema no llevan `balance_after`:** todas las apuestas tocan la cuenta "casa". Si tuviera cadena, cada apuesta del sistema bloquearía la misma fila y el juego entero quedaría serializado.

### 4. Validación estricta (amenaza: entradas inesperadas)
- **Esquemas Zod `strictObject`:** un campo de más es un error, no algo que se ignore en silencio. Así nadie puede colar `payout`, `outcome` o `__proto__`.
- **Apuestas:** solo una lista cerrada de enteros (`BET_LEVELS`). Se rechazan decimales, strings, negativos, `NaN` y valores enormes.
- **Dinero:** `bigint` en la BD y en el servidor, y strings en JSON. No hay floats en ningún punto.
- **Límites del cuerpo:** 4 KB como máximo (`413`). Los errores internos nunca devuelven SQL ni stack al cliente.
- **Sin SQL a mano:** Drizzle parametriza todas las consultas.

### 5. Rate limiting y concurrencia (amenaza: fuerza bruta, abuso y carreras)
- **Token bucket en memoria:**
  - por IP: ráfaga de 60, 20/s;
  - autenticación por IP: ráfaga de 10, 1 cada 6 s;
  - login también **por nombre de usuario** (frena el ataque a una cuenta desde muchas IPs);
  - tiradas por cuenta: ráfaga de 10, 5/s.
- **Un número máximo de claves** para que un atacante con millones de IPs no agote la memoria.
- **Una sola tirada en vuelo por jugador** (guard en memoria → `429` inmediato). La garantía real es el lock de Postgres: el guard solo evita colas de transacciones esperando.
- **`lock_timeout = 5s`**, para que una transacción nunca espere indefinidamente.

> ⚠️ **Limitación conocida: el rate limit vive en la memoria del proceso.**
> - Con *N* instancias, el límite efectivo es *N* veces mayor.
> - Un reinicio lo pone a cero. Lo comprobamos al preparar las pruebas de ataque: tras reiniciar el servidor, el cubo de autenticación volvió a estar lleno.
> - Para escalar horizontalmente hay que moverlo a un almacén compartido (Redis o una tabla en Postgres).
>
> El **doble gasto no depende de esto**: está garantizado por Postgres en cualquier número de instancias.

### 6. Registro inmutable (amenaza: reescribir la historia)
- `rounds`, `ledger_tx` y `ledger_entries` son **append-only** con dos capas:
  1. el rol de la app solo tiene `SELECT, INSERT` (`REVOKE UPDATE, DELETE`);
  2. triggers `BEFORE UPDATE/DELETE/TRUNCATE` lanzan un error **incluso para el dueño del esquema**.
- Cada ronda guarda `seed_pair_id`, `nonce`, `client_seed`, `server_seed_hash`, `outcome` y `math_version`: se puede reconstruir cualquier jugada años después.
- **Mínimo privilegio:** el servidor se conecta como `velvet_app`, que no puede alterar el esquema. Las migraciones usan `velvet_owner`.

### 7. Sesiones y autenticación (amenaza: robo de sesión y de contraseñas)
- **Contraseñas con argon2id** (19 MiB, t=2, p=1: el mínimo recomendado por OWASP).
- **Tiempo constante:** si el usuario no existe se verifica un hash ficticio, así que el tiempo de respuesta no revela qué nombres existen.
- **Token de sesión:**
  - 32 bytes del CSPRNG;
  - **la BD solo guarda su SHA-256**, así que un volcado no da sesiones válidas;
  - cookie `httpOnly` (JavaScript no puede leerla, y un XSS no la roba) y `SameSite=Strict`;
  - en producción, `Secure` con el prefijo `__Host-`: el navegador exige HTTPS, `Path=/` y que no lleve `Domain`, así que un subdominio no puede fijarla.
- El logout borra la sesión **en el servidor**.

### 8. Transporte y navegador (amenaza: XSS, CSRF, clickjacking)
- **CSRF, dos capas:**
  1. cabecera propia obligatoria `x-velvet-void: 1`: un formulario ajeno no puede enviarla, y un `fetch` cross-origin la convierte en una preflight que CORS rechaza;
  2. si llega `Origin`, debe ser el nuestro.
- **CORS:** lista blanca de un solo origen. Nunca se refleja el `Origin` recibido.
- **Helmet en la API:** `default-src 'none'`, `frame-ancestors 'none'`, `nosniff` y HSTS en producción.
- **CSP del cliente:**
  - `script-src 'self'` y `style-src 'self'`, **sin `unsafe-inline` ni `unsafe-eval`**;
  - Pixi se carga con `pixi.js/unsafe-eval`, que, pese al nombre, instala implementaciones que **no** necesitan `eval`;
  - fuentes autoalojadas con `@fontsource` (sin CDN de terceros);
  - audio sintetizado como `blob:`;
  - el E2E falla si la consola muestra cualquier violación de CSP.
- **Desplegar cliente y API en el mismo sitio** (`play.dominio` / `api.dominio`) para que `SameSite=Strict` funcione sin cookies de terceros.

### 9. Cadena de suministro y secretos (amenaza: dependencias comprometidas o filtraciones)
- **Lockfile fijo** (`pnpm-lock.yaml`) con versiones exactas (`save-exact`).
- **Cuarentena de versiones:** todas las dependencias se eligieron con al menos 2 semanas de antigüedad, para dar tiempo a que se detecte una versión maliciosa recién publicada.
- **Solo compilan scripts de instalación de paquetes en lista blanca** (`onlyBuiltDependencies`).
- **`pnpm audit`: 0 vulnerabilidades.** Se forzó por *override* un `esbuild` antiguo que llegaba con drizzle-kit (GHSA-67mh-4wv8-2f99).
- **Secretos solo en variables de entorno**, validadas al arrancar: si falta `SEED_ENCRYPTION_KEY`, el proceso **no arranca**. Los valores nunca se imprimen.

---

## Pruebas de ataque (resultados reales, 14-oct-2026)

Ejecutadas contra el servidor local con Postgres 16. Para reproducirlas: `pnpm attack:tamper`, `pnpm attack:replay`, `pnpm attack:race` y `pnpm --filter @velvet/server test`.

### Cliente manipulado: `attacks/client-tampering.mjs` (21/21 defensas aguantaron)

| Ataque | Resultado |
|---|---|
| Enviar `payout` y `outcome` propios en `/spin` | `400`: esquema estricto |
| Apuesta negativa, cero, decimal, string, `1e30`, no listada o `NaN` | `400` en los 7 casos |
| `__proto__` en el cuerpo | `400` |
| JSON truncado | `400` sin detalles internos |
| Cuerpo de 50 KB | `413` antes de parsear |
| POST sin cabecera anti-CSRF | `403` |
| POST con `Origin: https://evil.example` | `403` |
| Preflight CORS desde otro origen | sin `Access-Control-Allow-Origin` |
| Cookie de sesión inventada o ausente | `401` |
| Leer la ronda de otro jugador por id (IDOR) | `404` |
| Elegir `serverSeed` o `nonce` al rotar | `400` |
| Inyección SQL en el login | `400` (y las consultas son parametrizadas) |
| 14 contraseñas seguidas contra una cuenta | `401` ×7 → `429` |
| **Saldo del atacante al final** | **intacto (1.000.000 → 1.000.000)** |

### Repetición: `attacks/replay.k6.js`
- **Ataque:** 50 usuarios virtuales envían a la vez 200 veces **la misma apuesta** (mismo `betId`).
- **Resultado:** **1 ronda creada y 1 solo cobro** (1.000.000 → 999.000). El resto de respuestas fueron repeticiones idempotentes o `429`.

### Carrera / doble gasto: `attacks/race.k6.js`
- **Ataque:** 40 usuarios virtuales durante 15 s apostando 500 créditos con `betId` distintos sobre **una sola cuenta**: **66.379 peticiones**.
- **Resultado:** 35 rondas aceptadas. El saldo final es exactamente `inicial − apostado + ganado` (1.765.000), nunca fue negativo, y los nonces van de 0 a 34 sin huecos ni duplicados.

### El lock de Postgres sin las defensas en memoria: `packages/server/test/spin.test.ts`
Los ataques HTTP chocan primero con el rate limit y el guard en memoria. Para demostrar que **la garantía real es la BD**, los tests llaman al servicio directamente:
- 30 apuestas simultáneas → nonces 0..29 y saldo exacto;
- 30 repeticiones simultáneas del mismo `betId` → 1 ronda y 1 cobro.

### Atacando la base de datos directamente: `packages/server/test/db-guards.test.ts`

| Ataque (con la credencial de la app o del dueño) | Resultado |
|---|---|
| `UPDATE rounds SET payout = 999999` (app) | `permission denied` |
| `UPDATE/DELETE/TRUNCATE` sobre el ledger (dueño) | el trigger lo rechaza (`append-only`) |
| Insertar dinero "de la nada" con una sola pata | falla al `COMMIT`: transacción descuadrada |
| Insertar un `balance_after` inventado | `cadena de saldo rota` |
| Dejar el saldo en negativo | `saldo insuficiente` |
| Revelar una semilla que no corresponde al hash | `no corresponde al compromiso` |
| Retroceder o saltar el nonce | `el nonce solo avanza de uno en uno` |
| Dos rondas con el mismo nonce | violación de `rounds_seed_nonce_uq` |

## Lo que queda fuera (y por qué)
- **Rate limit distribuido:** documentado arriba; no hace falta con una sola instancia.
- **2FA y recuperación de cuenta:** no hay datos personales ni dinero real; se priorizó el núcleo del juego.
- **WAF/anti-DDoS:** corresponde a la plataforma (Fly.io o Cloudflare delante del servidor).
- **Auditoría externa del RNG** (como las que hacen los laboratorios GLI/eCOGRA): fuera del alcance de un proyecto educativo.

## Reportar un problema
Abre un *issue* con el prefijo `[security]` o escribe al autor del repositorio. Al ser un proyecto educativo, los hallazgos se publican junto con su corrección.
