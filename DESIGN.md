# Velvet Void — Documento de diseño

> Slot educativo con créditos 100 % ficticios. Sin dinero real, sin pagos, sin apuestas reales.
> Objetivo doble: portafolio jugable y material de aprendizaje sobre cómo funciona un casino por dentro y cómo se blinda.

---

## 1. Mecánica única: **Grietas de luz**

**Cuadrícula:** 5 rodillos × 3 filas, 10 líneas fijas. Apuesta total = `lineBet × 10`.

**Símbolos**

| Tipo | Símbolos | Notas |
|---|---|---|
| Bajos | Rosa marchita, Llave, Copa, Anillo | Frecuentes, pagan poco |
| Altos | Reloj de arena, Máscara, Ojo de Vesper | Raros, pagan mucho |
| Especial | **Grieta** | Solo en rodillos 2–4, máximo 1 por rodillo. Es wild. |

**Regla de la Grieta**

1. Cuando una Grieta queda visible, se abre y emite **1, 2 o 3 haces** (pesos `60 / 30 / 10`).
2. Cada haz sigue un **eje** distinto, elegido sin reemplazo entre `horizontal`, `vertical`, `diagonal ↘` y `diagonal ↗`.
3. El haz atraviesa la Grieta en ambos sentidos hasta el borde de la cuadrícula. **Toda celda que toca se convierte en wild.**
4. Si hay varias Grietas, cada una dispara de forma independiente (en orden de rodillo, de izquierda a derecha, para que el RNG se consuma de forma determinista).
5. Las líneas se evalúan **después** de aplicar los haces: de izquierda a derecha, con al menos 3 coincidencias seguidas y el wild sustituyendo cualquier símbolo.

**Tope de premio:** 2 000× la apuesta total por ronda. El tope acota la cola de la distribución y deja la volatilidad bajo control.

**Por qué esta mecánica**

- Es la identidad hecha regla: luz que escapa de la oscuridad.
- **No tiene estado entre rondas.** Cada ronda es independiente, así que el RTP no depende de cómo juegue nadie y el provably fair cubre la ronda completa.
- **El RTP teórico es exacto.** Se recorren todas las combinaciones de paradas (≈ 32⁵ ≈ 33 M) y, solo cuando aparecen Grietas, todas sus configuraciones de haces con su peso. El simulador Monte Carlo se contrasta contra ese número exacto, no contra otra simulación.
- **v2 opcional:** símbolo **Espejo**, que refleja los haces 90°.

### Matemática (se ajusta en el hito 2)

- Los rodillos son **tiras físicas** de unas 32 posiciones; el peso de un símbolo es su número de apariciones en la tira. Una parada es un entero uniforme en `[0, longitud)`.
- La tabla de pagos va en múltiplos **enteros** de `lineBet`, de modo que todo premio es un entero. **Nunca se usan floats para dinero.** Las cantidades son `bigint` en unidades mínimas de crédito.
- Objetivo: RTP ≈ 96 %, frecuencia de acierto ≈ 25–30 % y volatilidad media.
- Se publican RTP, desviación estándar por ronda, frecuencia de acierto, distribución de premios y contribución de cada símbolo y de las Grietas al RTP.
- `MATH_VERSION` se guarda en cada ronda: si cambia la tabla, las rondas antiguas siguen siendo reproducibles.

---

## 2. Dirección artística

**Concepto:** un salón de terciopelo en el borde de un agujero negro. El lujo está gastado y, por las costuras, se escapa luz.

| Token | Color | Uso |
|---|---|---|
| `--void` | `#07050A` | Fondo, el vacío |
| `--velvet-plum` | `#2A0F2E` | Paneles |
| `--velvet-burgundy` | `#4A0E1E` | Marcos de rodillo |
| `--gold-aged` | `#B8934A` | Tipografía, filos |
| `--gold-dim` | `#6E5A33` | Estados inactivos |
| `--leak` | `#F4E9D0` | Luz de las grietas (solo en destellos) |

- **Tipografía:** Cormorant Garamond para títulos (serif de lujo) e Inter para cifras y HUD (legibilidad).
- **Textura:** ruido sutil de terciopelo, viñeta fuerte y polvo dorado flotando muy despacio.
- **Sin neón:** el brillo viene de una sola fuente, la luz que se filtra, nunca de contornos saturados.
- **Anfitrión: Vesper.** Crupier sin rostro, traje burdeos y guantes de oro; donde debería estar la cara hay un campo de estrellas. Hace gestos, no habla: inclina la cabeza en una casi-ganancia y abre las manos cuando se abre una Grieta.
- **"Juice" de los rodillos:**
  - Anticipación: retroceso antes de girar.
  - Desenfoque de movimiento durante el giro.
  - Parada escalonada con `back.out` (rebote).
  - Suspense: el último rodillo gira más tiempo si los dos anteriores dejan una Grieta o una casi-línea.
  - Haces: barrido con easing, partículas doradas y destello `--leak`.
  - Turbo: tiempos ×0,35 y sin suspense.
- **Audio (Howler):** dron grave en bucle, pizzicato de cuerdas en cada parada, tintineo de cristal en los premios y un "inhale" grave antes de que se abra una Grieta. Volumen independiente para música y efectos, y silencio por defecto en móvil hasta la primera interacción.
- **Accesibilidad:** se respeta `prefers-reduced-motion` (sin sacudidas ni partículas), contraste AA en el HUD y la información del premio también va en texto.

---

## 3. Arquitectura

```
velvet-void/
├─ packages/
│  ├─ shared/      Zod schemas + tipos de la API (contrato único cliente↔servidor)
│  ├─ game-math/   Puro y determinista: tiras, evaluación, Grietas, RNG-desde-semillas,
│  │               cálculo exacto de RTP, simulador. Cero I/O.
│  ├─ server/      Fastify + Drizzle + Postgres
│  └─ client/      Vite + PixiJS v8 + GSAP + Howler, HUD en React
├─ e2e/            Playwright
├─ load/           k6 (concurrencia, replay)
└─ docker-compose.yml   (solo Postgres)
```

**Principio central: el cliente nunca decide.**

```
Cliente                         Servidor                                Postgres
  │ POST /spin {betId, bet} ──▶ valida (Zod) → rate limit
  │                             BEGIN
  │                             SELECT … FOR UPDATE (cuenta jugador)
  │                             ¿betId ya existe? → devuelve la ronda guardada
  │                             saldo ≥ bet?
  │                             nonce++ ; outcome = game-math(seeds, nonce)
  │                             INSERT round (append-only)
  │                             INSERT ledger (bet, win) doble entrada
  │                             COMMIT
  │ ◀── {outcome, balance} ─────
  │ anima hasta `outcome` (no puede terminar en otra cosa)
```

- **`game-math` se comparte** entre el servidor (decide), el cliente (verificador provably fair en el navegador) y el simulador. Es el mismo código, así que no hay deriva entre implementaciones.
- **El cliente solo recibe datos ya resueltos:** paradas, posición de cada Grieta, sus haces, la lista de celdas wild, las líneas ganadoras y el premio. El renderer reproduce esa lista; no calcula nada.
- **Despliegue:**
  - Cliente estático en un CDN, servidor en Fly.io.
  - Ambos van **en el mismo sitio registrable** (`play.dominio` / `api.dominio`) o tras el mismo origen con un proxy `/api`. Así la cookie puede ser `SameSite=Lax/Strict`; si fueran sitios distintos haría falta `SameSite=None`, que los navegadores bloquean cada vez más (ITP, fin de las cookies de terceros).

### Provably fair

```
serverSeed   = 32 bytes CSPRNG (crypto.randomBytes)
commitment   = SHA-256(serverSeed)            ← se publica ANTES de jugar
clientSeed   = elegido por el jugador (editable; por defecto aleatorio en su navegador)
nonce        = 0, 1, 2… por ronda dentro del par de semillas

stream(i)    = HMAC-SHA256(key=serverSeed, msg=`${clientSeed}:${nonce}:${i}`)
```

- **Generación de números:** el flujo de bytes se lee como `uint32` y los enteros en `[0, n)` se obtienen **por rechazo**, nunca con `%`, para evitar el sesgo de módulo. La lección queda documentada con su test.
- **Orden fijo de consumo:** primero las 5 paradas y después, por cada Grieta (de izquierda a derecha), el número de haces y sus ejes.
- **Rotar semillas:** el servidor revela `serverSeed` y genera un par nuevo, con su hash publicado. El verificador de la UI recalcula cualquier ronda pasada con el mismo `game-math`.
- **`serverSeed` cifrada en reposo** (AES-256-GCM con clave en una variable de entorno). Si alguien lee la base de datos, no puede predecir tiradas futuras.

---

## 4. Modelo de datos

Las cantidades son `bigint` en unidades mínimas; 1 crédito = 100 unidades.

```
users            id uuid PK · username citext UNIQUE · password_hash (argon2id) · created_at
sessions         id = SHA-256(token) PK · user_id FK · expires_at · created_at · last_seen_at
                 (la cookie lleva el token; la BD solo guarda su hash)

accounts         id uuid PK · user_id FK NULL · kind ('player'|'house'|'grants') UNIQUE(user_id, kind)
                 ← fila que se bloquea con SELECT … FOR UPDATE

ledger_tx        id uuid PK · kind ('signup_grant'|'bet'|'payout'|'daily_bonus') · round_id NULL · created_at
ledger_entries   id bigserial PK · tx_id FK · account_id FK · amount bigint (±) · balance_after bigint · created_at
                 invariante: Σ amount por tx_id = 0 (doble entrada; trigger DEFERRABLE lo comprueba al COMMIT)
                 saldo actual = balance_after de la última entrada de la cuenta (índice (account_id, id DESC))
                 la cadena es auditable: balance_after[n] = balance_after[n-1] + amount[n]

seed_pairs       id uuid PK · user_id FK · server_seed_enc · server_seed_hash · client_seed
                 · next_nonce · status ('active'|'revealed') · created_at · revealed_at
                 (mutable a propósito: nonce y revelado. Índice único parcial: 1 activo por usuario)

rounds           id uuid PK · user_id FK · bet_id uuid · seed_pair_id FK · nonce · client_seed
                 · bet bigint · payout bigint · outcome jsonb · math_version · created_at
                 UNIQUE(user_id, bet_id)        ← idempotencia / anti doble gasto
                 UNIQUE(seed_pair_id, nonce)    ← nunca dos rondas con el mismo nonce
```

- **Append-only real** (`rounds`, `ledger_tx`, `ledger_entries`): el rol de la aplicación solo tiene `INSERT` y `SELECT`; `REVOKE UPDATE, DELETE, TRUNCATE`. Además, un trigger `BEFORE UPDATE OR DELETE` lanza un error, de modo que la regla se cumple aunque alguien conecte con otro rol. Son dos capas.
- **¿Por qué `balance_after` y no `SUM()`?** Leer el saldo cuesta O(1) y sigue derivado del ledger. Cada entrada es inmutable y la cadena se puede verificar de punta a punta con un test de reconciliación.
- **¿Por qué no Redis?** Postgres ya resuelve el lock (`FOR UPDATE`) y la idempotencia (`UNIQUE`) dentro de la misma transacción que mueve el dinero. Un lock externo añadiría una segunda fuente de verdad y ventanas de inconsistencia.

---

## 5. API (todas las entradas validadas con Zod)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/auth/register` · `/auth/login` · `/auth/logout` | Sesión con cookie httpOnly, Secure y SameSite |
| GET | `/me` | Usuario y saldo |
| GET | `/fair` | Hash de la semilla activa, clientSeed y próximo nonce |
| PUT | `/fair/client-seed` | Cambia la clientSeed (no la serverSeed) |
| POST | `/fair/rotate` | Revela la serverSeed actual y crea un par nuevo |
| POST | `/spin` | `{ betId: uuid, bet: niveles permitidos }` → `{ round, balance }` |
| GET | `/rounds`, `/rounds/:id` | Historial y reconstrucción |
| GET | `/math` | Tabla de pagos, tiras y `MATH_VERSION` (transparencia) |
| POST | `/bonus/daily` | Opcional (hito de pulido) |

**Defensas transversales**

- **CSRF:** `SameSite`, comprobación de `Origin` y cabecera obligatoria `X-Requested-With`.
- **CORS:** lista blanca de un solo origen.
- **Cabeceras:** Helmet con CSP estricta (sin `unsafe-inline` ni `unsafe-eval`).
- **Rate limit en memoria** por IP y por cuenta. Su limitación (no escala a varias instancias) queda documentada en `SECURITY.md`.

---

## 6. Plan de hitos

| # | Hito | Verificación |
|---|---|---|
| 1 | Monorepo, TS estricto, Postgres en Docker, migraciones | `pnpm -r typecheck`; la migración aplica limpia |
| 2 | game-math: RNG desde semillas, tiras, evaluación, Grietas, **RTP exacto** | Vitest: vectores fijos, ausencia de sesgo, casos de Grieta |
| 3 | Simulador (millones de rondas, worker threads) | La simulación cae dentro del IC del 99 % del RTP exacto |
| 4 | API: auth, ledger, `/spin` idempotente con lock | Vitest + Postgres real: doble entrada, replay, carreras |
| 5 | Cliente Pixi + HUD React: **prototipo jugable** | Playwright: registrarse → tirar → el saldo cuadra |
| 6 | Provably fair + verificador en la UI | Un test reproduce rondas reales desde las semillas reveladas |
| 7 | Pruebas de ataque (k6 + scripts) y `SECURITY.md` | Informe con cada ataque y su resultado |
| 8 | Pulido: juice, audio, Vesper, turbo, bonus diario, despliegue | Lighthouse, `pnpm audit`, despliegue de prueba |

Hitos 1–5 ≈ días 1–2 (prototipo jugable). Hitos 6–8 hasta el 22 de octubre.
