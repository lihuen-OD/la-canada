# MIGRATION_PLAN.md — Plan de migración por etapas

> Este documento **planifica** etapas; no las ejecuta más allá de lo ya autorizado. Cada etapa requiere autorización humana explícita antes de comenzar (ver `AGENTS.md`, regla 3). El orden es secuencial pero no rígido: si en una etapa surge información que cambia el plan, se ajusta este documento antes de continuar, no se improvisa en silencio.
>
> **Nota de numeración**: la numeración de etapas de este documento se ajustó para reflejar cómo se ejecutó realmente el trabajo (el usuario autorizó "Preservar el prototipo" y "Crear la estructura profesional" juntas como una única Etapa 1, y "Diseñar Prisma" y "Crear el seed" juntas como una única Etapa 2). Las etapas futuras (antes 5-10) se renumeraron a 3-8 en consecuencia.

## Etapa 0 — Documentación ✅ completada

- **Objetivo**: auditar `index.html` sin modificarlo y producir la documentación base (`AGENTS.md` + `docs/*.md`).
- **Resultado**: `AGENTS.md` y 7 documentos en `docs/` (`PROJECT_CONTEXT.md`, `BUSINESS_RULES.md`, `DATA_INVENTORY.md`, `ARCHITECTURE.md`, `DATABASE.md`, `SECURITY.md`, `MIGRATION_PLAN.md`). `index.html` sin modificar (confirmado por checksum).

## Etapa 1 — Preservar el prototipo + crear la estructura profesional ✅ completada

- **Objetivo**: resguardar `index.html` como referencia inmutable y armar el andamiaje de monorepo (frontend + backend) sin lógica de negocio.
- **Resultado**:
  - `legacy/index.original.html` — copia exacta de `index.html` (mismo checksum), nunca importada ni servida por el backend.
  - Monorepo con npm workspaces: `frontend/` (React + TypeScript + Vite) y `backend/` (Node + TypeScript + Express), con TypeScript estricto, ESLint (config compartida en `eslint.config.js`), Prettier, Vitest, `concurrently`.
  - Backend con Helmet, CORS restringido a `FRONTEND_URL` (403 estructurado para orígenes no autorizados, corregido en un cierre correctivo posterior), rate limiting general, manejo centralizado de errores, endpoint `GET /api/v1/health`.
  - `.env.example` centralizado en la raíz (`docs/ARCHITECTURE.md` §11 tiene el detalle completo por variable y por plataforma de despliegue).
  - Repositorio Git inicializado, con un commit base (`chore: establish professional monorepo foundation`) y un cierre correctivo posterior (fix de CORS + revisión de variables de entorno).
- **No incluyó**: ninguna pantalla ni endpoint de negocio, ninguna conexión a Neon ni a Supabase.

## Etapa 2 — Diseñar Prisma + crear el seed con datos reales ✅ completada

- **Objetivo**: convertir el borrador de `docs/DATABASE.md` en un `schema.prisma` real, y escribir (sin ejecutar) un seed idempotente con los datos reales identificados en `docs/DATA_INVENTORY.md`.
- **Resultado**:
  - `backend/prisma/schema.prisma` — modelo completo (22 modelos, 11 enums) cubriendo identidad/seguridad, tareas, inventario, novedades/eventos, archivos, gallinero, mascotas y configuración. Detalle completo en `docs/DATABASE.md`, sección "Modelo definitivo (Etapa 2)".
  - `backend/prisma.config.ts` — configuración de Prisma 7 (reemplaza `datasource.url` en el schema, ya no soportado en esta versión — ver `docs/ARCHITECTURE.md` §10).
  - `backend/prisma/seed.ts` + `backend/prisma/seed-data/*.ts` + `backend/prisma/seed-lib/` — seed idempotente (patrón "crear si no existe, nunca pisar"), con los datos reales del HTML separados de la lógica de ejecución. Manifiesto exacto en `docs/SEED_MANIFEST.md`.
  - Datos deliberadamente omitidos (documentados, no inventados): cumpleaños de Benjamín (fecha contradictoria), cantidad de gallinas (sin valor comprobado), administrador inicial, y cualquier historial operativo sin evidencia real en el HTML (ejecuciones, consumos no-apertura, animales, fotos, sesiones, auditoría).
- **No incluyó**: ninguna migración contra Neon, ningún `db push`, ninguna ejecución del seed, ninguna conexión a Supabase ni a Neon.

## Etapa 2.3 — Retiro seguro del prototipo heredado ✅ completada

- **Objetivo**: verificar la integridad de `index.html`/`legacy/index.original.html` (checksums, historial Git) y, autorizado explícitamente por el usuario, retirarlos por completo del repositorio — árbol de trabajo **y** historial de Git — porque contenían una URL y una API key reales de Supabase (`SB_URL`/`SB_KEY`) hardcodeadas en texto plano.
- **Disparador**: al conectar el repositorio local a un remoto de GitHub por primera vez, se detectó que ambos archivos seguían conteniendo esa credencial real (documentada desde la Etapa 0 en `docs/SECURITY.md` como el hallazgo de mayor severidad, pero nunca antes retirada del repo). El usuario canceló el push planeado y autorizó explícitamente eliminar ambos archivos antes de cualquier conexión remota.
- **Verificación previa a eliminar** (sin modificar nada todavía):
  - MD5/SHA-256/`cmp`/blob SHA de Git idénticos entre `index.html` y `legacy/index.original.html`, y entre los commits `b9b9f78`/`b3b88f5` — confirmado que nunca hubo una modificación real de ninguno de los dos archivos en ningún commit previo.
  - Confirmado que `frontend/index.html` es un archivo distinto (plantilla de Vite, sin relación ni contenido sensible) y no fue tocado.
  - Confirmado que todo el contenido funcional, visual y de datos del HTML heredado ya estaba migrado íntegramente a `docs/` (`PROJECT_CONTEXT.md`, `BUSINESS_RULES.md`, `DATA_INVENTORY.md`, `DATABASE.md`, `SECURITY.md`), a `backend/prisma/schema.prisma` y al seed (`docs/SEED_MANIFEST.md`) — nada se perdía al retirar el archivo físico.
- **Resultado**:
  - `index.html` y `legacy/index.original.html` eliminados del árbol de trabajo.
  - Ambos archivos eliminados de **todo el historial de Git local** (reescritura con `git filter-branch --index-filter`, purga de refs de respaldo, `reflog expire`, `git gc --prune=now --aggressive`) — verificado con `git fsck`, `git rev-list --objects --all` y un escaneo de contenido de los ~100 blobs alcanzables: ningún objeto de Git conserva esos archivos ni el contenido de la API key.
  - El identificador real del proyecto de Supabase (que también aparecía, sin la key, en `docs/ARCHITECTURE.md`, `docs/PROJECT_CONTEXT.md`, `docs/SECURITY.md` y en un test de guarda del seed) se redactó de la misma forma en una segunda pasada de reescritura de historial, y luego se prolijo con texto explicativo en la versión final de cada documento.
  - `backend/src/test/seed-source-guards.test.ts` — el guard que comparaba contra el identificador/JWT reales se reemplazó por un patrón genérico (dominio `*.supabase.co`, forma de un JWT) que no almacena ningún valor real como fixture.
  - Como no existía ningún push previo (el remoto todavía no se había conectado), reescribir el historial local no afectó a nadie más — los hashes de ambos commits cambiaron (`b9b9f78`→ nuevo, `b3b88f5`→ nuevo; ver el reporte de cierre de esta etapa para los hashes exactos) y eso se documentó en vez de preservarse.
  - `AGENTS.md` (regla 9), `README.md` y `.prettierignore` actualizados para no depender de la presencia física de los HTML retirados.
  - Todas las validaciones (Prisma format/validate/generate, build, typecheck, lint, test, format:check) vueltas a correr en verde tras la reescritura.
- **No incluyó**: ninguna conexión a Neon, ninguna ejecución del seed, ninguna conexión ni push a GitHub (se pospuso explícitamente hasta después de esta limpieza), ningún avance a la Etapa 3.
- **Pendiente para el usuario (fuera del alcance de este repositorio)**: si el proyecto de Supabase original sigue activo, rotar/revocar la `anon key` real — retirar el archivo del repo no invalida la key del lado de Supabase.

## Etapa 3A — Conectar Neon `demo`, migración inicial y seed real ✅ completada

- **Objetivo**: materializar el modelo ya aprobado (Etapa 2/2.2) en la rama `demo` del proyecto Neon "La Cañada", y cargar los datos iniciales reales del seed — exclusivamente contra `demo`, nunca contra `production`.
- **Verificación de destino antes de escribir**: sin acceso a la API de control de Neon (no hay `neonctl` ni API key configurados), la identidad de rama no es verificable criptográficamente desde una sesión SQL — Neon no expone "nombre de rama" vía SQL estándar. La confirmación se basó en: (a) la credencial vive únicamente en el `.env` local, gitignored, nunca usada en Render (producción usa variables propias configuradas directamente en su dashboard — ver `docs/ARCHITECTURE.md`, "Variables de entorno"); (b) la base estaba completamente vacía (0 tablas de negocio, sin `_prisma_migrations`) antes de migrar, consistente con una rama de desarrollo nunca usada, no con un ambiente productivo en uso; (c) el usuario confirmó explícitamente el alcance ("Rama: demo, Uso: desarrollo local") como precondición de la tarea. Ninguna operación de escritura se ejecutó antes de esta verificación.
- **Incidente detectado y corregido durante la verificación previa**: se encontró una connection string real de Neon (usuario y contraseña en texto plano) pegada por error en `.env.example` (archivo versionado) — nunca llegó a commitearse ni a GitHub (confirmado con `git diff`/`git log`/`git show origin/main`). Se restauró `.env.example` al placeholder vacío y se agregó un test de regresión (`backend/src/test/env-example.test.ts`) que falla si vuelve a pasar. Ver `docs/SECURITY.md`, "Neon — separación pooled/direct", para el detalle.
- **Variables de conexión** (`docs/ARCHITECTURE.md` tiene el detalle completo):
  - `DATABASE_URL` (pooled, host con `-pooler`) — usada por el runtime de la app (`backend/src/lib/prisma.ts`, cliente único reutilizable vía `@prisma/adapter-pg`) y por el seed.
  - `DIRECT_URL` (directa, mismo host sin `-pooler`) — usada exclusivamente por Prisma Migrate (`backend/prisma.config.ts`). Verificado que ambas apuntan al mismo `neondb`/mismo usuario antes de usarlas para nada.
- **Migración inicial** (`backend/prisma/migrations/20260922174631_init/`): generada con `prisma migrate dev --create-only --name init`, revisada completa antes de aplicar — 22 tablas, 11 enums, 23 PK, 23 FK (sin `ON DELETE CASCADE` en ninguna — `RESTRICT`/`SET NULL` según nulabilidad, generado automáticamente por Prisma a partir del schema, no declarado a mano; corrige la suposición de `docs/DATABASE.md`, "Revisión estática final", de que no habría ninguna cláusula `ON DELETE` explícita), 41 índices únicos (incluida `file_assets_bucket_object_key_key`). Se agregaron a mano 5 `CHECK` (únicas filas de la matriz de invariantes clasificadas para SQL: `StockItem.area != BOTH`, `User.status=ACTIVE ⇒ password_hash NOT NULL`, `FileAsset` no `taskId`+`animalId` simultáneos, `StockMovement.quantity > 0`, `FileAsset.sizeBytes >= 0`). Aplicada con `prisma migrate deploy` — solo a `demo`, nunca `db push`.
- **Verificación posterior**: `prisma migrate status` → "up to date" (sin drift); `_prisma_migrations` con 1 fila, `rolled_back_at` nulo; tablas/enums/PK/FK/índices únicos/checks comparados 1:1 contra Postgres real vía consultas a `information_schema`/`pg_constraint`. Los 5 `CHECK` se probaron con inserts inválidos dentro de transacciones con `ROLLBACK` explícito (`backend/src/test/integration/checkConstraints.integration.test.ts`, corrido con `npm run test:integration`, fuera de la suite normal) — confirmado que rechazan la fila inválida y que no queda ningún dato de prueba en la base.
- **Seed real**: ejecutado dos veces contra `demo`. Primera corrida: 61 entidades maestras + 14 `StockMovement` de apertura = 75 filas, exactamente como documenta `docs/SEED_MANIFEST.md` (conteos por tabla y relaciones verificados con consultas agregadas, sin exponer datos personales). Segunda corrida: mismos conteos, cero duplicados, ninguna fila modificada — idempotencia confirmada. Se corrigió en el camino un timeout de la transacción interactiva de Prisma (5000 ms por defecto, insuficiente para la latencia real de red hacia Neon) subiéndolo a 60000 ms — sin cambiar la semántica todo-o-nada del seed.
- **Cliente Prisma único**: `backend/src/lib/prisma.ts` exporta un único `PrismaClient` reutilizable (vía `@prisma/adapter-pg`, `DATABASE_URL`), con `disconnectPrisma()` invocado desde el apagado ordenado del servidor (`server.ts`) — ningún endpoint lo usa todavía (Etapa 5). Sin dependencias nuevas: `@prisma/adapter-pg`/`pg` ya estaban instaladas desde la Etapa 2.
- **Scripts agregados** (`backend/package.json`): `db:check` (comprobación de conexión de solo lectura), `db:migrate:dev`, `db:migrate:deploy`, `db:migrate:status`, `db:seed`, `test:integration` (tests contra Neon real, separados de `npm test` — ver `vitest.config.mts`/`vitest.integration.config.mts`).
- **No incluyó**: ninguna conexión a `production`, ninguna autenticación, ningún endpoint de negocio, ningún cambio funcional en `frontend/`, ningún uso de Object Storage, ningún despliegue, ningún `db push`, ningún reset/truncate de base.

### Revisión correctiva de la Etapa 3A (antes del merge del PR #1)

Tres problemas detectados en la revisión del PR — corregidos sin tocar el modelo Prisma, la migración ya aplicada ni los datos de `demo`; sin volver a ejecutar el seed ni las pruebas de constraints (no era necesario, se confirmaron los mismos conteos por consulta agregada):

- **Sin barrera ejecutable contra `production`**: `db:migrate:dev`, `db:migrate:deploy`, `db:seed` y `test:integration` podían, en teoría, correr contra cualquier URL cargada en `.env` — la protección era solo documental. Se agregó `DATABASE_TARGET` (`demo`/`production`, backend-only) y `backend/src/scripts/guardDbCommand.ts`, que falla antes de invocar Prisma si el destino no es `demo`, si falta la variable requerida, o si su forma no coincide con pooled/direct según corresponda. Wireado en los 4 comandos listados; `db:check`/`db:migrate:status` quedan sin este gate (solo lectura).
- **Contradicción de `DATABASE_URL`**: `config/env.ts` la declaraba opcional mientras `lib/prisma.ts` (importado por `server.ts`) fallaba igual si faltaba. Resuelto a favor de una única fuente de verdad: `DATABASE_URL` ahora es obligatoria en el schema de Zod, con mensaje claro y sin revelar su valor. `DIRECT_URL` sigue opcional (el servidor nunca la necesita). Los tests unitarios usan un valor sintético inyectado por `vitest.config.mts`.
- **Build offline roto**: `prisma.config.ts` resolvía `DIRECT_URL` de forma eager, así que `prisma format`/`validate`/`generate` fallaban sin `.env` aunque no tocan ninguna base. Se corrigió armando `datasource` de forma condicional — se omite por completo si `DIRECT_URL` falta, sin URL de reemplazo hardcodeada. Verificado moviendo el `.env` real a un backup temporal fuera del repo (restaurado después, sin tocar su contenido): instalación, `prisma generate`, `validate`, build, typecheck, lint, tests unitarios y `format:check` funcionan igual sin él.
- **Tests agregados**: `backend/src/test/guard-db-command.test.ts` (la guarda como función pura), `backend/src/test/offline-commands.test.ts` (spawns reales de `prisma format`/`validate`/`generate` sin secretos), `backend/src/test/env.test.ts` actualizado (DATABASE_URL obligatoria, DATABASE_TARGET validado).
- **Revalidación**: suite normal sin variables de Neon ✅; conexión y `migrate status` contra `demo` con el `.env` local (sin aplicar nada) ✅; conteos agregados siguen en 75 ✅; build/typecheck/lint/tests/format/Prisma format-validate-generate ✅; escaneo de secretos sin coincidencias ✅.
- **No incluyó**: ninguna conexión a `production`, ninguna migración nueva, ningún `db push`, ninguna re-ejecución del seed, ninguna autenticación, ningún uso de Object Storage, ningún merge a `main`.

## Etapa 3B.1 — Autenticación backend profesional ✅ completada

- **Objetivo**: reemplazar el PIN comparado en el cliente por autenticación real del lado del backend (login, sesión persistente con refresh rotativo, autorización por rol verificada en servidor, administración de usuarios, bootstrap del primer admin), sobre el modelo `User`/`Session` ya definido en la Etapa 2 — **sin ninguna pantalla ni cambio funcional en el frontend**.
- **Resultado**:
  - **Contraseñas**: Argon2id (`argon2`, parámetros OWASP), política mínimo 12/máximo 128 caracteres sin reglas de composición forzadas, comparación contra hash *dummy* cuando no aplica para no filtrar por tiempo de respuesta.
  - **Access token**: JWT HS256 vía `jose`, claims mínimos (`sub`/`sid`/`role`/`iat`/`exp`), issuer/audience propios, corta duración configurable (`ACCESS_TOKEN_TTL`).
  - **Refresh token**: opaco (256 bits aleatorios, no JWT), solo en cookie `HttpOnly`, solo su hash SHA-256 persistido en `Session`. Rotación en cada uso; reuso de un token ya revocado revoca todas las sesiones activas del usuario (posible robo) — la revocación masiva y su auditoría corren dentro de la misma transacción que el chequeo, sin depender de que el callback de `$transaction` lance una excepción (bug real encontrado por los tests de integración contra Neon, corregido — ver `docs/ARCHITECTURE.md` §14.3).
  - **Migración** `20260923110309_auth_session_security` (índice único en `refresh_token_hash`, índice compuesto `(user_id, revoked_at)`), generada offline (`prisma migrate diff --from-schema/--to-schema --script`), aplicada solo a `demo`. Detalle en `docs/DATABASE.md`, "Etapa 3B.1".
  - **Endpoints**: `/api/v1/auth/{login,refresh,logout,me}`; administración `ADMIN`-only en `/api/v1/admin/users` (listado paginado, activar, resetear contraseña, cambiar estado con protección de auto-lockout).
  - **Bootstrap del primer admin** (`npm run auth:bootstrap-admin`): construido y testeado (unitariamente y contra `demo` con limpieza determinística) — **nunca ejecutado como parte de esta etapa**, no se creó ningún administrador real.
  - **Cookies/CSRF**: configuración centralizada (`backend/src/config/cookies.ts`) para que creación y borrado de la cookie usen exactamente los mismos atributos; `SameSite=None` fuerza `Secure=true` siempre; `Origin` validado en `/refresh`/`/logout`. Pendiente, documentado a propósito: elegir entre proxy de Netlify o dominios separados — decisión para cuando exista pantalla de login.
  - **Auditoría**: login (éxito/fallo), refresh, detección de reuso, logout, activación, cambio de estado, reset de contraseña y bootstrap, todos en `AuditLog` — nunca con contraseñas ni tokens.
  - **Variables de entorno**: `JWT_ACCESS_SECRET` (obligatoria para que la autenticación funcione, mínimo 32 caracteres — generada por el usuario, nunca pedida ni escrita por el agente), `ACCESS_TOKEN_TTL`/`REFRESH_TOKEN_TTL`/`COOKIE_SAME_SITE` (opcionales, con default). `JWT_REFRESH_SECRET` eliminada (el refresh token es opaco, no hay nada que firmar).
  - **Tests**: suite unitaria completa (`backend/src/test/auth/`, sin conexión a Neon) más suite de integración contra `demo` (`backend/src/test/integration/{auth,adminUsers,bootstrapAdmin}.integration.test.ts`, guardada por `DATABASE_TARGET=demo`, siempre secuencial entre archivos, limpieza determinística verificada por conteo antes/después) — ver `docs/ARCHITECTURE.md` §14.11 para el detalle y para el bug real que solo la suite de integración pudo encontrar.
- **No incluyó**: ninguna pantalla de login ni cambio funcional en `frontend/`, ninguna ejecución real de `auth:bootstrap-admin`, ninguna conexión a `production`, ningún uso de Object Storage, ningún despliegue, ninguna rama ni Pull Request nuevos (trabajo directo sobre `main`).

### Corrección posterior de la Etapa 3B.1 (antes de la Etapa 3B.2)

Revisión puntual, sin cambios de schema: (a) rotación concurrente del refresh token — dos `POST /auth/refresh` casi simultáneos con el mismo token podían ambos "ganar" y emitir cada uno un refresh token nuevo; corregido con una toma atómica de la sesión (`updateMany` condicionado por `id`+`revokedAt: null`+vigencia, en vez de un `update` incondicional), apoyada en la semántica de re-chequeo de Postgres bajo READ COMMITTED — sin necesitar `SERIALIZABLE`; (b) `requireAuth` ahora exige `session.userId === token.sub` (un JWT firmado correctamente pero con un `sub` que no coincide con el dueño real de la sesión se rechaza); (c) `JWT_ACCESS_SECRET` pasó a ser obligatoria en `config/env.ts` (única fuente de verdad, mismo patrón que `DATABASE_URL`) en vez de fallar tarde y en un lugar distinto dentro de `auth/config.ts`. Detalle completo en `docs/ARCHITECTURE.md`, sección 14.12.

## Etapa 3B.2 — Corrección del modelo de credenciales: contraseña → PIN ✅ completada

- **Objetivo**: reemplazar el login por usuario+contraseña (Etapa 3B.1) por selección de identidad + PIN numérico de 4 dígitos — decisión funcional del usuario, no un hallazgo de seguridad sobre la etapa anterior —, preservando íntegramente todo lo demás ya construido (JWT, refresh con rotación, sesiones revocables, cookies `HttpOnly`, autorización por rol, `session.userId === token.sub`). **Sin construir todavía la pantalla de login ni el selector visual** — eso queda para una etapa posterior.
- **Resultado**:
  - **PIN**: Argon2id (mismos parámetros que se usaban para contraseñas), política `^\d{4}$` exacta — nunca se transforma a número (preserva ceros iniciales). `backend/src/auth/password.ts` renombrado a `backend/src/auth/pin.ts`.
  - **Protección de fuerza bruta**: contador de intentos fallidos + bloqueo de 15 minutos tras 5 fallos consecutivos, persistidos en Postgres (`User.failedLoginAttempts`/`User.lockedUntil`, no en memoria del proceso) además del rate limit por IP ya existente. Incremento atómico (`{ increment: 1 }`); la transición a "bloqueada" usa una escritura condicionada (mismo patrón que la toma atómica de sesión de refresh) para que, bajo intentos concurrentes que cruzan el umbral a la vez, como máximo uno quede marcado como el que aplicó el bloqueo y audite el evento — bug real de duplicación encontrado y corregido durante esta misma etapa (ver `docs/ARCHITECTURE.md` §14.13).
  - **Selector público de identidad**: `GET /api/v1/auth/login-options` (nuevo, sin autenticación) — devuelve `{ id, displayName, role, colorHex }` de usuarios `ACTIVE` únicamente, nunca `pinHash`/`username`/estado completo/intentos fallidos. Un `ADMIN` sin `Employee` vinculado se muestra con la etiqueta genérica "Administrador".
  - **Login**: `POST /api/v1/auth/login` pasa a recibir `{ userId, pin }` (antes `{ username, password }`) — ya no normaliza ni busca por `username`.
  - **Administración**: `POST /admin/users/:id/activate` recibe `{ pin }`; `POST /admin/users/:id/reset-password` renombrado a `POST /admin/users/:id/reset-pin`, y además de revocar todas las sesiones ahora también resetea intentos fallidos/bloqueo, todo en una única transacción con auditoría separada para el cambio de PIN y para la revocación de sesiones que provocó.
  - **`username`**: se revisaron todas sus referencias antes de decidir; se conserva como identificador técnico interno (clave del seed idempotente, visible solo en `GET /admin/users`) pero deja de exponerse en `login-options`/`/me`/la respuesta de login, y deja de ser lo que se ingresa para autenticarse.
  - **Migración** `pin_authentication`: rename de columna `password_hash` → `pin_hash` (nunca drop+recreate) y de su constraint asociado, más las dos columnas nuevas de fuerza bruta. Generada offline (mismo procedimiento que `auth_session_security`), aplicada solo a `demo`. Detalle en `docs/DATABASE.md`, "Etapa 3B.2".
  - **Bootstrap del primer admin**: adaptado a PIN con confirmación (se pide dos veces, nunca se imprime) — sigue sin ejecutarse.
  - **Tests**: suite unitaria y de integración contra `demo` extendidas/reescritas para PIN, incluida una prueba real de 10 intentos fallidos concurrentes contra `demo` (sin incrementos perdidos, sin auditoría de bloqueo duplicada) — ver `docs/ARCHITECTURE.md` §14.11/§14.13.
- **No incluyó**: ninguna pantalla de login ni selector visual en `frontend/`, ninguna ejecución real de `auth:bootstrap-admin`, ningún PIN asignado a los 4 usuarios reales (siguen `PENDING_ACTIVATION`), ninguna conexión a `production`, ningún uso de Object Storage, ningún despliegue, ninguna rama ni Pull Request nuevos (trabajo directo sobre `main`).

## Etapa 3C — Frontend de autenticación por selección de identidad + PIN ✅ completada

- **Objetivo**: construir el flujo completo de frontend para el login por PIN ya implementado en el backend (Etapas 3B.1/3B.2) — selector de identidad, teclado numérico, sesión restaurada automáticamente al recargar, cierre de sesión — conectado al backend real (`login-options` puede devolver, y de hecho devuelve hoy, una lista vacía: 0 usuarios `ACTIVE` reales todavía). **Sin avanzar con el dashboard ni los 14 módulos de negocio** — eso sigue siendo la Etapa 4.
- **Resultado**:
  - **Access token solo en memoria** (`frontend/src/auth/accessTokenStore.ts`) — nunca `localStorage`/`sessionStorage`/`IndexedDB`/cookie legible desde JS. El refresh token sigue exclusivamente en la cookie `HttpOnly` ya existente, sin cambios de ese lado.
  - **Restauración de sesión single-flight** (`frontend/src/auth/refreshCoordinator.ts`): un único `POST /auth/refresh` real sin importar cuántos disparadores concurrentes haya (doble montaje de efectos de React StrictMode, o varios 401 simultáneos) — evita activar la detección de rotación concurrente del backend (§14.12) contra la propia sesión que se está restaurando. Un logout mientras un refresh sigue en vuelo descarta el resultado tardío (no re-autentica a quien ya cerró sesión).
  - **Renovación automática tras 401**: reintento único por request, nunca para `login-options`/`login`/`refresh`/`logout` (estructuralmente no pueden entrar a esa lógica), nunca un segundo reintento tras el primero.
  - **Selector de identidad** (`GET /auth/login-options`): consume `{ options: [...] }` tal cual, estado vacío real documentado ("Todavía no hay usuarios habilitados para ingresar."), sin fixtures ni personas/PIN inventados, `colorHex` validado con fallback neutro, indicador visual y semántico para `ADMIN`.
  - **Pantalla de PIN**: teclado numérico en pantalla + teclado físico (dígitos, Backspace, Escape, Enter), PIN como `string` (preserva ceros iniciales), nunca visible, nunca persistido más allá del intento, sin distinguir visualmente el motivo del rechazo (mismo mensaje genérico del backend), doble envío prevenido con guarda síncrona.
  - **Rutas protegidas** (`frontend/src/routes/ProtectedRoute.tsx`): usuario anónimo → login; autenticado → área protegida; mientras se restaura la sesión → pantalla de carga estable, sin parpadeo del login. Rol siempre leído del usuario validado por el backend, nunca de un JWT decodificado en el cliente. `RequireRole` preparado para rutas admin-only futuras, sin consumidor real todavía.
  - **Área autenticada temporal** (`frontend/src/features/home/AuthenticatedHome.tsx`): nombre/rol reales + "Cerrar sesión" — explícitamente marcada en el código como punto de entrada temporal, sin dashboard ni datos de negocio (ni reales ni mock).
  - **Proxy local de Vite** (`frontend/vite.config.ts`): `/api -> http://localhost:4000`, sin `rewrite` (el prefijo `/api/v1` llega intacto). `VITE_API_URL` se eliminó — cero variables `VITE_*` en esta etapa. Proxy de Netlify para producción documentado como pendiente (falta la URL real de Render) — ver `docs/ARCHITECTURE.md` §15.7 para la regla exacta que habrá que agregar.
  - **Tests**: 66 tests nuevos (Vitest + Testing Library) — single-flight bajo concurrencia real (incluido un test con `<StrictMode>` real), reintento único tras 401, logout-durante-refresh, estados del selector (carga/vacío/error/cargado), teclado físico y en pantalla, cero `localStorage`/`sessionStorage`. Suite completa del backend (222 + 28) sigue en verde, sin cambios de schema.
- **No incluyó**: ningún dashboard ni módulo de negocio (real o mock), ninguna migración ni cambio de schema, ningún admin/PIN real asignado, ninguna conexión a `production`, ningún despliegue, ninguna rama ni Pull Request (trabajo directo sobre `main`).

## Etapa 3D — Administración de usuarios y puesta en funcionamiento controlada del acceso ✅ completada — bootstrap del admin ejecutado manualmente por el usuario

- **Objetivo**: construir el módulo de frontend para que un `ADMIN` administre a los 4 usuarios reales (activar con PIN, cambiar PIN, cambiar estado) sin necesitar nunca conocer ni recuperar un PIN ajeno, y preparar — sin ejecutar — el proceso para crear el primer administrador real de `demo`.
- **Resultado (código, tests, documentación)**:
  - **Ruta `/admin/users`**, protegida por `ProtectedRoute` + `RequireRole role="ADMIN"` (primer consumidor real de `RequireRole`, preparado sin uso desde la Etapa 3C) — anónimo → login, `EMPLOYEE` → acceso denegado, `ADMIN` → pantalla real. Entrada visible desde `AuthenticatedHome` solo para `ADMIN`.
  - **Listado real** (`GET /admin/users`), tipado con un contrato deliberadamente distinto de `AuthenticatedUser` (`AdminUserListItem`, `frontend/src/api/adminTypes.ts`) — nunca se asumió que las dos formas fueran iguales. Nunca expone `pinHash`, intentos fallidos ni bloqueo.
  - **Activación** (`POST /admin/users/:id/activate`) y **cambio de PIN** (`POST /admin/users/:id/reset-pin`) con un único componente reutilizable (`PinDialog.tsx`): PIN como `string` (preserva ceros iniciales), confirmación obligatoria, doble envío bloqueado, limpieza de campos en cualquier salida (éxito/error/cancelar/desmontaje), advertencia explícita de que cambiar el PIN revoca todas las sesiones activas de esa persona, `input type="password" inputMode="numeric" autoComplete="one-time-code"` (nunca `type="number"`).
  - **Cambio de estado** (`PATCH /admin/users/:id/status`) con confirmación previa (`ConfirmDialog.tsx`), ofreciendo únicamente las transiciones que el backend realmente permite (espejo documentado en `userStatusTransitions.ts`, backend como autoridad final), sin ofrecer nunca dejar al sistema sin ningún `ADMIN` activo.
  - **Mutación sobre la propia cuenta** (cambiar el propio PIN, o el propio estado a uno que revoca sesiones): en vez de refrescar el listado, se llama al `logout()` ya existente de la Etapa 3C — mismo mecanismo (token en memoria limpiado, "época" incrementada para que un refresh tardío no reautentique), sin código nuevo para esto.
  - **Defecto real de backend encontrado y corregido antes de construir la UI que dependía de él** (no un hallazgo de un test que fallara después): `PATCH /status { status: 'ACTIVE' }` sobre un usuario que llegó a `DEACTIVATED` directo desde `PENDING_ACTIVATION` (nunca activado, sin `pinHash`) rompía el `CHECK` real de la base con un 500 crudo — corregido con una validación explícita en `adminUsersController.changeStatus` que rechaza esa reactivación con un mensaje claro. Ver `docs/ARCHITECTURE.md` §14.6b/§16.7.
  - **Tests nuevos**: 45 tests de frontend (protección de ruta, listado, estados de pantalla, `PinDialog`, `ConfirmDialog`, `AdminUserRow`, orquestación completa en `AdminUsersScreen` incluyendo el logout sobre la propia cuenta) + 4 tests de integración de backend nuevos contra `demo` (el defecto corregido, más dos verificaciones explícitas de comportamiento ya garantizado por construcción: un usuario `SUSPENDED` no puede iniciar sesión y desaparece de `login-options`).
  - **Bootstrap del primer administrador**: implementación, tests y validaciones de esta etapa confirmados en verde; **la ejecución real (`npm run auth:bootstrap-admin`) queda pendiente, a cargo exclusivo del usuario, en su propia terminal** — el agente nunca la ejecutó, nunca pidió ni observó el PIN elegido. Ver "Puesta en marcha del primer administrador" más abajo.
- **No incluyó**: ningún cambio de schema/migración, ninguna activación ni PIN asignado a los 4 empleados reales, ninguna conexión a `production`, ningún uso de Object Storage, ningún despliegue, ninguna rama ni Pull Request (trabajo directo sobre `main`), ninguna ejecución real del bootstrap del admin.

### Puesta en marcha del primer administrador (acción manual del usuario, fuera de este repositorio como código)

Con el código de esta etapa ya validado (ver checklist más abajo), crear el primer `ADMIN` real de `demo` es una operación sobre datos, no sobre código — por eso no lleva commit propio. Pasos, tal como los ejecuta el usuario personalmente:

1. Confirmar que `DATABASE_TARGET=demo` en el `.env` local y que no existe todavía ningún `ADMIN` con `status: ACTIVE` (verificable por SQL directo o por `GET /admin/users` una vez que exista algún administrador para autenticarse — antes de eso, por consulta directa a la base).
2. Correr `npm run auth:bootstrap-admin` (`backend/`) en una terminal propia. El script pide `username` y el PIN **oculto, con confirmación** — nunca como argumento de línea de comandos, nunca pegado en el chat de Claude Code ni en ningún archivo.
3. El agente se detiene en este punto y espera la confirmación explícita del usuario de que el paso se completó — nunca ejecuta el script, nunca pide el PIN para "verificarlo", nunca lo registra de ninguna forma.
4. Verificación posterior (el agente, únicamente por consulta a la base o a `GET /admin/users`, sin poder recuperar el PIN en ningún momento): existe exactamente un `ADMIN` `ACTIVE` con `pinHash` no nulo; aparece en `GET /auth/login-options`; los 4 empleados siguen `PENDING_ACTIVATION`; el conteo de filas cambió solo por ese usuario nuevo más las filas de auditoría legítimas del propio bootstrap.

**Estado posterior (registrado en la Etapa 3E):** el usuario ejecutó personalmente el bootstrap interactivo y creó el primer `ADMIN` real de `demo`. No se vuelve a ejecutar. Observado desde el frontend real: `GET /auth/login-options` devuelve exactamente una identidad, con rol `ADMIN` (ningún empleado `ACTIVE`). En la Etapa 3E no se consultó la base directamente; ninguna acción de esa etapa activó empleados ni asignó PIN.

## Etapa 3E — Reconciliación visual del frontend con la identidad original 🟡 implementada y validada técnicamente — pendiente de aprobación visual humana y commit

- **Objetivo**: alinear todas las pantallas frontend ya existentes con la identidad original recuperada en `docs/UI_CONTEXT.md` (nueva fuente de verdad visual), sin cambiar su funcionamiento: restauración de sesión, selector de identidad, ingreso de PIN, estados de carga/vacío/error, Inicio temporal, acceso denegado, administración de usuarios, diálogos de activación/cambio de PIN/cambio de estado, navegación mínima y cierre de sesión.
- **Resultado**:
  - **Tokens CSS** (`frontend/src/styles/tokens.css`): paleta original exacta + tokens semánticos, tipografía, espaciado, radios, sombras, alturas, z-index, movimiento. Único archivo con colores literales (verificado por test). Tres variantes derivadas solo para contraste AA, documentadas en `docs/UI_CONTEXT.md` ("Aclaraciones de contraste").
  - **Fuentes locales**: `@fontsource/fraunces` (600 normal/itálica) y `@fontsource/karla` (400/600/700), solo subset latin — sin peticiones a Google Fonts.
  - **Componentes compartidos** (`frontend/src/components/ui/`): `Button`, `Card`, `Badge`, `Avatar`, `Modal` (movido desde `components/`), `EmptyState`/`ErrorState`/`LoadingState`, `PageHeader`, `Brand`, `Spinner`, iconos SVG propios.
  - **App shell** (`frontend/src/app/AppShell.tsx`): header verde bosque, navegación inferior en móvil / sidebar de 210px en escritorio, solo con destinos implementados (Inicio; Usuarios solo para `ADMIN`) desde una configuración tipada única (`frontend/src/routes/navigation.ts`) que también define el rol exigido por la ruta.
  - **Pantallas alineadas**: todas las listadas en el objetivo. Inicio sigue marcado como temporal (sin KPI ni datos de negocio).
  - **Build de producción garantizado**: `npm run build` siempre genera el build de producción de React aunque el `.env` defina `NODE_ENV=development` (`frontend/scripts/build.mjs` + guarda en `vite.config.ts`, ver `docs/ARCHITECTURE.md` §17.2).
  - **Tests**: 189 tests de frontend (111 previos, conservados o adaptados a la nueva semántica sin debilitar lo que verificaban + 78 nuevos). Backend sin cambios (222 tests).
- **Detalle técnico**: `docs/ARCHITECTURE.md` §17 y `frontend/README.md`, "Sistema visual (Etapa 3E)".
- **No incluyó**: ningún cambio de backend, contratos API, autenticación, refresh, cookies, roles, permisos, Prisma, migraciones, seed ni datos reales; ninguna nueva ejecución del bootstrap; ningún PIN asignado ni usuario activado/suspendido; ninguna conexión a `production`; ningún uso de Object Storage; ningún módulo de negocio (Tareas, Stock, etc.) ni navegación hacia ellos.

## Etapa 4A — Módulo Tareas operativo de punta a punta 🟡 implementado y validado — pendiente de revisión visual humana y commit

- **Objetivo**: primer módulo de negocio real: listar las tareas reales de `demo`, filtrar por responsable y frecuencia, crear/editar/desactivar/reactivar (ADMIN), completar con snapshot de asignación y ejecutor real, revertir sin perder trazabilidad, historial semanal, sin duplicados por período. Sin Desempeño (Etapa 4B).
- **Decisiones aprobadas por el usuario antes de implementar**: (1) migración "una fila por evento" con índice único parcial; (2) un `EMPLOYEE` solo revierte en el período vigente; (3) motivo obligatorio solo para correcciones de `ADMIN`; (4) historial con todas las frecuencias.
- **Resultado**: backend (`/api/v1/tasks`, ver `docs/ARCHITECTURE.md` §18), migración `task_execution_reversal` (ver `docs/DATABASE.md`, "Etapa 4A"), `BUSINESS_TIME_ZONE`, frontend `/tasks` con ✅ en la navegación, filtros, listado, diálogos de alta/edición/completado/reversión/desactivación e historial 📅.
- **No incluyó**: Desempeño (ranking, rachas, % acumulado), ninguna modificación de las 10 tareas reales ni de los 4 empleados reales, ninguna ejecución real registrada, ningún seed, ninguna conexión a `production`, ningún uso de Object Storage, ningún commit ni push (a cargo del usuario tras la aprobación).

## Etapa 4B — Desempeño de tareas 🟡 implementado y validado — pendiente de revisión visual humana y commit

- Historial `TaskPlanningInterval` con backfill desde fechas reales y restricciones SQL.
- API de cumplimiento ponderado, trabajo realizado, coberturas, ayuda, racha, tendencia y urgentes/únicas separadas.
- `/tasks/performance` como pestaña secundaria, sin mutaciones ni destino principal nuevo.
- No incluye Stock, Dashboard, premios, sanciones, pagos, notificaciones ni exportaciones.

## Etapa 4 — Reconstruir el frontend sin alterar el diseño

- **Objetivo**: recrear en React + TypeScript las 14 pantallas identificadas en `docs/PROJECT_CONTEXT.md` §3, preservando la paleta de colores, tipografías (Fraunces/Karla), layout mobile-first con navegación inferior/sidebar, y componentes visuales (cards, chips, modales tipo bottom-sheet, badges de estado). **Actualización Etapa 3C**: el flujo de autenticación (selector de identidad + PIN, sesión, rutas protegidas) ya está construido — esta etapa es exclusivamente el dashboard y los módulos de negocio, no vuelve a tocar el login.
- **Alcance sugerido**:
  - ~~Extraer el sistema de diseño a tokens reutilizables~~ — **hecho en la Etapa 3E** (`frontend/src/styles/tokens.css`, a partir de `docs/UI_CONTEXT.md`). Los módulos nuevos consumen esos tokens y componentes; no crean paletas propias.
  - Componentes visuales genéricos: `Card`, `Modal`, `Badge`, `Avatar`, estados y app shell ya existen (Etapa 3E). Quedan por construir cuando un módulo real los necesite: chips/filtros, KPI (con datos reales) y FAB contextual. `/` sigue siendo el Inicio temporal hasta que exista el módulo Inicio real.
  - El frontend consume **solo** la API del backend (nunca Prisma/Postgres directo) — corrige el hallazgo central de `docs/SECURITY.md`.
- **No incluye**: rediseñar la interfaz; cualquier cambio visual respecto al original requiere pedido explícito del usuario (regla 6 de `AGENTS.md`).

## Etapa 5 — Implementar módulos gradualmente

- **Objetivo**: portar la lógica de negocio de `docs/BUSINESS_RULES.md` al backend, módulo por módulo, en lugar de todo de una vez, usando los modelos ya definidos en la Etapa 2.
- **Orden sugerido** (a confirmar con el usuario, ajustable): Empleados/Usuarios → Tareas (con `Task.active` y `TaskExecution` ya modelados) → Inventario (con `StockMovementType` ya reemplazando el hack de prefijos de texto) → Novedades → Eventos y cumpleaños recurrentes (ya resuelta la ambigüedad de origen del campo `nota`) → Gallinero (singleton por convención, ya documentado) → Mascotas (con `AnimalType` ya normalizado) → Datos de empleados/hijos → Fotos (como paso previo a la Etapa 6) → Clima (usando `PropertyLocation`).
- Cada módulo migrado se valida contra las reglas ya documentadas en `docs/BUSINESS_RULES.md`, corrigiendo — no reproduciendo — los bugs verificados ahí (desempeño roto, `DIAS_ES` indefinido, permisos inconsistentes de fotos ya resueltos a favor de admin-only, etc.), salvo que el usuario pida explícitamente mantener algún comportamiento tal cual está.
- **No incluye**: adelantar módulos fuera de orden sin acuerdo, ni mezclar el fix de un bug con la migración de un módulo no relacionado.

### Etapa 5A — Backend base de Stock ✅ implementada, auditada y commiteada

- **Alcance**: endpoints autenticados bajo `/api/v1/stock` para consultar categorías, productos, destinos activos e historial; `ADMIN` crea/edita/desactiva catálogo; todos los autenticados registran ingresos/consumos y solo `ADMIN` registra ajustes explícitos al alta o a la baja.
- **Integridad**: decimales como texto → Prisma `Decimal`; saldo, `StockMovement` y `AuditLog` en una transacción; decremento condicional e incremento atómico; rollback y concurrencia cubiertos tanto por fake transaccional como por integración contra `demo` con fixtures sintéticas y limpieza comprobable.
- **Decisiones**: producto nuevo en cero; apertura exclusiva del seed; fecha futura prohibida, retroactividad solo `ADMIN`; destino opcional mientras no haya catálogo real/CRUD, pero validado si se recibe; historial inmutable y sin borrado físico.
- **Modelo**: no requiere migración; reutiliza el schema y el `CHECK` existentes. No se ejecutó `db push`, reset ni seed.
- **Fuera de alcance**: frontend de Stock, reportes, lista de compras y CRUD de destinos; ninguna modificación de datos reales ni conexión a `production`.

### Etapa 5B — Frontend operativo de Stock ✅ implementada y auditada, sin commit

- **Ruta y navegación**: `/stock` está disponible para todo usuario autenticado y ocupa su lugar documentado entre Tareas y Usuarios. Conserva el emoji 📦 como decorativo junto con texto accesible y reutiliza el app shell, tokens, tipografías y componentes de `docs/UI_CONTEXT.md`.
- **Inventario**: listado real por Casa/Jardín, agrupado por categoría, con búsqueda debounced, categoría, estado administrativo y paginación acumulativa; todos los filtros viajan al backend. Las respuestas viejas se invalidan al cambiar filtros o desmontar y las páginas se deduplican por id.
- **Movimientos e historial**: ingresos y consumos para `ADMIN`/`EMPLOYEE`; ajustes solo visibles para `ADMIN`, con motivo y confirmación adicional. El rol autenticado —no el tipo de movimiento— decide la fecha: `ADMIN` puede elegir hoy o una fecha pasada y `EMPLOYEE` omite `effectiveDate`. El historial es paginado, filtrable e inmutable; las mutaciones esperan al backend y luego recargan, sin actualizaciones optimistas.
- **Catálogo**: sección exclusiva de `ADMIN` para crear/editar/desactivar/reactivar categorías y productos mediante los endpoints de 5A. Los productos nacen con saldo cero; el saldo, el área y el estado no se incluyen en el PATCH general, y la cantidad solo cambia mediante movimientos.
- **Integridad cliente**: cantidades decimales viajan como strings estrictos; `OPENING_BALANCE`, `employeeId`, `stockItemId` y campos no permitidos no se ofrecen ni se envían. Los errores `STOCK_*` relevantes se traducen a mensajes humanos diferenciados. Stock reutiliza el refresh central single-flight y su reintento único tras 401; no guarda tokens ni implementa refresh propio.
- **Verificación**: tests sintéticos cubren contratos API, permisos por rol, fechas, conflictos 409, formularios/mass assignment, filtros y respuestas fuera de orden, paginación/deduplicación, doble envío, historial, navegación y ausencia de storage/mocks de runtime. No se modificaron datos reales ni se conectó a Neon/`production`.
- **Fuera de alcance**: Compras, Reportes, CRUD de destinos, cambios de backend, migraciones y cualquier módulo posterior.

### Etapa 5C.1A + 5C.1B — Idempotencia, destinos y nivel server-side 🟡 implementadas offline y auditadas, sin commit

- **Alcance ejecutado (5C.1A)**: modelo `IdempotencyRecord` en `schema.prisma` (`actor + endpoint + key` únicos, `requestHash`, respuesta almacenada, índice por `createdAt`, FK `RESTRICT` a `User`); migración incremental `20260924210000_stock_idempotency_balance_check` generada **offline** (`prisma migrate diff` entre dos archivos de schema) con la tabla/índices/FK + `CHECK (current_quantity >= 0)` sobre `stock_items` agregado a mano — **sin aplicar a ninguna base**.
- **Alcance ejecutado (5C.1B)**: `GET /stock/destinations?status=active|all` (`all` es de `ADMIN`), `POST /stock/destinations` y `PATCH /stock/destinations/:id` (solo `ADMIN`; sin `DELETE` — la baja es inactivación, siempre permitida incluso con movimientos históricos; `type` inmutable; auditorías `stock.destination.created`/`updated`/`status_changed`, dos filas si cambian nombre y estado). Filtro `stockLevel=ok|low|critical` en `GET /stock/items` resuelto en Postgres con SQL parametrizado (comparación columna-vs-columna que Prisma no expresa) y `stockLevel` calculado en el DTO; paginación y conteo server-side después del filtro. Header opcional `Idempotency-Key` (`^[A-Za-z0-9_-]{8,64}$`) en `POST /stock/items/:id/movements`: transacción única de reserva+saldo+movimiento+auditoría+respuesta, replay exacto del status/body almacenados, `409 IDEMPOTENCY_KEY_CONFLICT` para cuerpo distinto, `400 IDEMPOTENCY_KEY_INVALID`, `409 IDEMPOTENCY_RECORD_PENDING` defensivo, sin caché y sin reutilizar `StockMovement.reference`.
- **Decisiones aprobadas por el usuario (Q1–Q5)**: destinos solo se inactivan, nunca se borran; la clave es opcional en 5C.1 (5C.2 la hará obligatoria en el frontend); el backend calcula `stockLevel` y el frontend conserva `barPercent` (sin `barPercent` en el DTO); renombrar destino está permitido y auditado; sin purga de idempotencia (índice por `createdAt` + deuda documentada); Compras queda como vista derivada de `stockLevel` (sin tabla ni endpoint); alertas no persistidas; seed intacto (0 destinos); sin frontend.
- **Modelo/tests/docs**: 24 modelos Prisma (schema `prisma validate` + `generate` en verde); tests unitarios nuevos de schemas, semántica de nivel (`stockLevel.ts`), filtro server-side, CRUD de destinos, idempotencia (replay, conflicto, rollback, concurrencia, registro pendiente, formato de clave) y estáticos de rutas; documentación actualizada en `AGENTS.md`, `README.md`, `DATABASE.md`, `BUSINESS_RULES.md`, `ARCHITECTURE.md`, `MIGRATION_PLAN.md` y `SECURITY.md`.
- **Validaciones**: `prisma format/validate/generate`, `typecheck`, `lint`, `build`, suite completa de tests unitarios y `git diff --check` en verde; `format:check` limpio para todo el código fuente versionado (los warnings restantes son los archivos generados de `src/generated/**`, gitignorados, preexistentes). Sin conexión a Neon, sin `db push`, reset, seed, deploy, commit ni push.
- **Auditoría correctiva (2026-09-25, sin commit)**: se conservaron las correcciones parciales previas (identidad exacta del `P2002`, fecha resuelta en la huella, `P2028` → `409` pendiente, tests de controller y de migración estática) y se completaron: (1) el fake de tests emitía el `P2002` con `meta.target`, que Prisma 7 + `adapter-pg` no produce — ahora emite la forma real (`meta.driverAdapterError.cause.constraint.index`), con variantes legacy y sin identidad cubiertas por tests; (2) los UUID de producto/destino se canonicalizan en minúsculas en endpoint lógico y huella (antes otra capitalización abría una segunda reserva); (3) la migración estática quedó verificada con una whitelist exacta de 5 sentencias, y contra `prisma migrate diff --from-schema <HEAD> --to-schema <actual>` (offline): coincide exactamente salvo el `CHECK` manual. Resultados: backend 527 tests / 33 archivos, frontend 307 / 35, `npm test` raíz en verde; `format:check` raíz limpio; el `format:check` del workspace backend solo marca los 32 archivos de `src/generated/**` (el mismo cliente generado desde el schema de `HEAD` ya tenía 31). Sin Neon, sin migración aplicada, sin commit.
- **Pendiente (requiere autorización)**: **5C.1C** — verificar precondición del CHECK (`current_quantity >= 0` sin filas negativas), `prisma migrate deploy` contra `demo` (nunca `production`), verificación post-aplicación, corrida de integración y commit. **5C.2** — frontend de destinos/`stockLevel`/`Idempotency-Key` obligatorio.

### Etapa 5C.1C — Migración aplicada a `demo` e integración real 🟢 cerrada

- **Checkpoint**: la implementación offline de 5C.1A/5C.1B quedó en el commit local `a5cff77` (`feat: add stock destinations and idempotent movements`), sin push.
- **Target**: `DATABASE_TARGET=demo` y guardas `pooled`/`direct` en verde; `DATABASE_URL` y `DIRECT_URL` apuntan al mismo endpoint de Neon (comparación hecha en proceso, sin imprimir valores); las credenciales de `production` no existen localmente (§13.5 de `ARCHITECTURE.md`); huella de datos coincidente con `demo` (5 migraciones previas, 14 productos + 14 aperturas del seed, 1 `ADMIN` activo).
- **Precondición del CHECK** (transacción `READ ONLY`): 0 de 14 `stock_items` con `current_quantity < 0`; mínimo `1.00`.
- **Aplicación**: `migrate status` previo = exactamente 1 pendiente, sin fallidas; `npm run db:migrate:deploy` aplicó `20260924210000_stock_idempotency_balance_check`; después `finished_at` presente, `rolled_back_at` nulo, 0 fallidas, "Database schema is up to date!". Objetos verificados en el catálogo: tabla, índice único `(actor_user_id, endpoint, key)`, índice `created_at`, FK `ON DELETE RESTRICT`, `CHECK (current_quantity >= 0)`.
- **Integración real nueva** (`backend/src/test/integration/stock5c1.integration.test.ts`, 16 tests por HTTP real, fixtures `test-5c1-<RUN>`): replay `201` idéntico, conflicto `409`, actor/producto separados, clave inválida `400`, sin clave = 5A, UUID en mayúsculas + decimal equivalente = replay, fecha resuelta en la identidad, concurrencia real (6 solicitudes simultáneas × `INCOME`/`CONSUMPTION` → `[201×6]`, 1 movimiento, 1 auditoría, 1 registro completo), rollback real en Postgres (movimiento, auditoría, finalización), `stockLevel` con SQL real, destinos (permisos, auditorías, duplicado, inexistente, tipo inmutable, sin `DELETE`, rollback) y CHECK de saldo con `ROLLBACK` explícito.
- **Defecto encontrado y corregido (sin commit)**: el camino idempotente hacía `Promise.all` de dos lecturas sobre el mismo `tx`; Postgres real emitió `DeprecationWarning` de `pg` (consultas concurrentes sobre un cliente — eliminado en `pg@9`). Ahora son secuenciales; el fake rechaza consultas solapadas dentro de una transacción (la mutación inversa hace fallar 13 tests).
- **Observaciones**: conteos globales de `sessions`/`audit_logs` cambiaron durante la primera corrida completa por uso real del `ADMIN` desde el navegador (login/logout/refresh), incluido un `auth.login.failed` sobre un usuario sintético visible temporalmente en `login-options` — fila real, no se borró. Tareas (fuera de alcance) mostró un timeout intermitente de 20 s por latencia; aislado pasa 22/22. El `EMPLOYEE` **Coke** figura `ACTIVE`: activación intencional hecha por el usuario, estado operativo válido.
- **Limpieza**: 0 filas sintéticas (usuarios, empleados, categorías, productos, destinos, movimientos, auditorías, registros de idempotencia, sesiones); productos/categorías/aperturas/usuarios/empleados reales idénticos.
- **Corrida final aislada (sin uso de la app)**: 74 tests, 73 aprobados; todos los `afterAll` en verde, conteos antes/después idénticos y 0 fixtures remanentes. Toda la suite de Stock en verde, incluida la concurrencia real. El único fallo fue ajeno a Stock (ver bloqueo siguiente); el usuario autorizó el cierre con ese fallo documentado.
- **Primer bloqueo técnico de la futura Etapa 5P**: fallo intermitente en `auth.integration` — con dos `refresh` simultáneos del mismo token, la rotación sigue siendo atómica (gana exactamente uno), pero el perdedor a veces recibe un `PrismaClientKnownRequestError` sin traducir (500) en lugar de `InvalidSessionError`. No se reproduce aislado (10/10). Auth no se modificó en 5C.1.
- **Cierre**: la corrección posterior (lecturas secuenciales, regresión del fake, integración 5C.1 y docs) va en el commit `fix: serialize idempotent stock transaction reads`, publicado junto con `a5cff77` en `origin/main`.
- **Sin** `production`, `db push`, `migrate dev`, reset ni seed. 5C.2 no iniciada.

## Etapa 6 — Integrar Neon Object Storage (fotografías y archivos)

- **Objetivo**: conectar `FileAsset` (ya modelado en la Etapa 2, adaptado a Neon Object Storage en la Etapa 2.2) con el Object Storage real de Neon, gestionado desde el backend.
- **Alcance sugerido**:
  - Backend recibe el archivo, valida tipo MIME real/tamaño/permisos, genera un `objectKey` (UUID, ver estrategia en `docs/ARCHITECTURE.md` §9.2), lo sube al bucket privado correspondiente al entorno (`demo`/`production`) con credenciales de servicio (nunca en el cliente), y persiste en Postgres solo la referencia (`FileAsset.bucket` + `objectKey`, etc.).
  - Decidir la estrategia de lectura (URL temporal firmada vs. proxy vía backend — ver `docs/ARCHITECTURE.md` §9.5).
  - Implementar la compensación de fallos parciales (registro sin subida confirmada, o subida sin registro) y la detección de objetos huérfanos.
  - Implementar el flujo de eliminación lógica → física controlada, exclusivo de `ADMIN`.
  - Considerar que puede haber fotos de menores de edad (ver `docs/SECURITY.md` §7) al definir permisos de acceso.
- **No incluye**: subir archivos directo desde el frontend al Object Storage.

## Etapa 7 — Probar

- **Objetivo**: validar funcionalmente que el sistema reconstruido reproduce (o mejora deliberadamente, cuando así se acordó) el comportamiento documentado en `docs/BUSINESS_RULES.md`.
- **Alcance sugerido**:
  - Tests automatizados de backend (lógica de negocio: períodos, estados de stock, desempeño, permisos por rol) — sobre la base de los tests ya existentes de infraestructura (health, CORS, entorno, inventario del seed).
  - Ejecutar el seed real contra una base de desarrollo por primera vez, y verificar que es efectivamente idempotente corriéndolo dos veces.
  - Pruebas manuales de UI en mobile y escritorio, cubriendo los 14 módulos.
  - Checklist específico contra cada hallazgo de `docs/SECURITY.md` (confirmar que ya no aplica en la nueva arquitectura).
- **No incluye**: pruebas contra el proyecto Supabase actual (no se usa en la nueva arquitectura).

## Etapa 8 — Desplegar

- **Objetivo**: publicar frontend en Netlify, backend en Render, base en Neon.
- **Alcance sugerido**:
  - Primera migración real (`prisma migrate deploy`) contra Neon, y primera ejecución real del seed.
  - Variables de entorno de producción configuradas en cada plataforma (nunca commiteadas) — configuración esperada ya documentada en `docs/ARCHITECTURE.md` §11.
  - Plan de rollback y de baja del proyecto Supabase actual (una vez confirmado que ya no se usa — recordar: "la conexión actual con Supabase será eliminada más adelante").
- **No incluye**: eliminar el proyecto Supabase actual sin confirmación explícita del usuario de que la migración de datos está completa y verificada.

---

## Validaciones obligatorias de la Etapa 0

- [x] Leído `index.html` completo (líneas 1 a 4206), no solo fragmentos.
- [x] Buscadas todas las referencias a Supabase (`SB_URL`, `SB_KEY`, `sbFetch`/`sbGet`/`sbPost`/`sbPatch`/`sbDel`/`sbUpsert`, y llamadas `fetch` crudas contra `rest/v1/`) — 18 tablas identificadas y documentadas en `docs/DATABASE.md`.
- [x] Buscados todos los arrays y objetos precargados (`personas`, `tareas`, `sCasa`, `sJardin`, `novedades`, `eventos`, catálogos de tipos/categorías/cumpleaños familiares) — documentados en `docs/DATA_INVENTORY.md`, incluyendo cuáles se siembran automáticamente hoy y cuáles no.
- [x] Buscadas todas las funciones de lectura y escritura (`sbGet`/`sbPost`/`sbFetch` y sus llamadas) — mapeadas por módulo en `docs/BUSINESS_RULES.md` y `docs/DATABASE.md`.
- [x] Identificadas funciones duplicadas/redefinidas — 13 funciones con doble declaración, documentadas en `docs/PROJECT_CONTEXT.md` §7 y `docs/ARCHITECTURE.md` §2.
- [x] Confirmados todos los módulos y pantallas — 14 pantallas (`div.pg`) listadas en `docs/PROJECT_CONTEXT.md` §3.
- [x] Confirmado que no se modificó `index.html` (ver confirmación explícita en el resumen final entregado al usuario).
- [x] Confirmado que no se creó código funcional nuevo — solo se crearon `AGENTS.md` y los 7 archivos de `docs/`, todos documentación en Markdown.

## Validaciones obligatorias de la Etapa 2

- [x] Schema Prisma formateado y validado estáticamente (`prisma format`, `prisma validate`), sin conexión a base.
- [x] Cliente Prisma generado sin conexión a base (`prisma generate`).
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run format:check` — todos en verde sobre el monorepo completo.
- [x] Tests específicos del inventario del seed corridos y en verde, sin PostgreSQL (`backend/src/test/seed-data.test.ts`, `seed-source-guards.test.ts`).
- [x] Búsqueda de credenciales/PIN/secretos y de `deleteMany` en el seed — sin coincidencias reales (los falsos positivos iniciales, por menciones en comentarios explicativos, se corrigieron en los propios tests).
- [x] Confirmado que no hubo conexión a Supabase ni a Neon, y que el seed no se ejecutó.
- [x] Checksum de `index.html` verificado sin cambios.

### Revisión correctiva de la Etapa 2 (antes de conectar Neon)

Antes de dar por cerrada la Etapa 2 se hizo una segunda pasada correctiva, sin avanzar a la Etapa 3, que corrigió:

- [x] Conteo del seed corregido y diferenciado: 61 entidades maestras + 14 movimientos de apertura = 75 filas potenciales (antes se informaba "61" de forma ambigua).
- [x] `TaskExecution.assignedEmployeeId` — snapshot obligatorio del empleado asignado en el momento de crear la ejecución, separado de `completedByEmployeeId`, para que reasignar una tarea no reinterprete el historial.
- [x] `PropertyLocation` y `ChickenCoop` — singleton reforzado con `code String @unique`, en vez de depender solo de convención.
- [x] `FileAsset.newsReportId` eliminado (auditado contra el HTML: sin evidencia funcional de fotos vinculadas a novedades); `taskId`/`animalId` confirmados y documentados.
- [x] `StockMovement.reference` — clave natural única para que el movimiento de apertura de cada producto sea idempotente por restricción real de base, no solo por texto descriptivo.
- [x] Matriz de invariantes que Prisma no puede expresar, con nivel de enforcement (Prisma / SQL futuro / servicio), agregada a `docs/DATABASE.md`.
- [x] Todas las validaciones (`prisma format/validate/generate`, build, typecheck, lint, test, format:check) vueltas a correr en verde, sin conexión a ninguna base.
- [x] Sin commit — Etapa 2 y esta revisión correctiva quedan juntas, sin commitear, para revisión conjunta.

### Etapa 2.2 — Reemplazo de Google Drive por Neon Object Storage (antes de conectar Neon)

Segunda revisión arquitectónica, autorizada explícitamente por el usuario antes de conectar Neon y antes del commit de las Etapas 2/2.1. Decisión definitiva:

> Neon Object Storage privado reemplaza a Google Drive como almacenamiento de fotografías y archivos, usando su interfaz compatible con S3, con buckets privados separados por rama/entorno (`demo`/`production`) dentro del mismo proyecto de Neon que aloja Postgres.

Cambios de esta revisión:

- [x] `FileAsset` — `externalId` reemplazado por `bucket` + `objectKey` (identificación técnica principal); restricción única compuesta `@@unique([bucket, objectKey])` (antes `@@unique([provider, externalId])`); campo nuevo `etag` (opcional).
- [x] `FileProvider` — `GOOGLE_DRIVE` reemplazado por `NEON_OBJECT_STORAGE` (único valor, justificado en `docs/DATABASE.md`).
- [x] `FileStatus` ampliado de 2 a 5 valores (`PENDING_UPLOAD`, `AVAILABLE`, `UPLOAD_FAILED`, `PENDING_DELETION`, `DELETED`) para representar el ciclo de vida completo de una subida futura — sin implementar ningún workflow todavía. Default pasa de `ACTIVE` a `PENDING_UPLOAD`.
- [x] `docs/ARCHITECTURE.md` §9 reescrita: proveedor y modelo de datos, estrategia de object keys (documentada, no implementada), buckets y ambientes (`demo`/`production`, credenciales separadas, Netlify nunca recibe credenciales de almacenamiento), flujos de escritura/lectura futuros, principios de la integración (backend único con credenciales, bucket siempre privado, eliminación lógica antes que física exclusiva de `ADMIN`, detección de huérfanos, validación de MIME real, límites de tamaño).
- [x] `docs/DATABASE.md` — enum `FileProvider` actualizado en la tabla de enums; nueva sección "Object Storage reemplaza Google Drive"; matriz de invariantes ampliada con 6 filas nuevas (12-17: unicidad `bucket`+`objectKey`, `sizeBytes` no negativo, `objectKey` válida para archivos disponibles, archivos eliminados sin nuevas URLs firmadas, credenciales exclusivas del backend, buckets `demo`/`production` sin mezclar) y una cuarta columna de clasificación ("Configuración operativa").
- [x] `docs/SECURITY.md` §7 actualizada con la decisión de Object Storage.
- [x] `.env.example`, `backend/src/config/env.ts`, `README.md`, `AGENTS.md`, `docs/PROJECT_CONTEXT.md` — variables `GOOGLE_DRIVE_FOLDER_ID`/`GOOGLE_SERVICE_ACCOUNT_EMAIL`/`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` reemplazadas por `OBJECT_STORAGE_ENDPOINT`/`OBJECT_STORAGE_REGION`/`OBJECT_STORAGE_BUCKET`/`OBJECT_STORAGE_ACCESS_KEY_ID`/`OBJECT_STORAGE_SECRET_ACCESS_KEY` (todas opcionales todavía, ninguna con prefijo `VITE_`, sin valores reales).
- [x] Tests actualizados/agregados (`backend/src/test/schema-static.test.ts`, `env.test.ts`, nuevo `env-example.test.ts`) — cubren: `FileProvider` sin `GOOGLE_DRIVE`, `FileAsset` con `bucket`/`objectKey` y sin `externalId`, restricción única compuesta, ausencia de URL firmada/pública y de credenciales en el schema, `.env.example` sin variables de Google y con las variables conceptuales de Object Storage, ninguna con prefijo `VITE_`.
- [x] Búsqueda exhaustiva de referencias a Google Drive en el proyecto — sin instrucciones activas restantes (se conserva mención histórica en `docs/ARCHITECTURE.md` §9 y `docs/DATABASE.md` solo por trazabilidad).
- [x] El seed (`backend/prisma/seed.ts`) no crea ningún `FileAsset` — sin cambios, conteo de 61 entidades maestras + 14 movimientos de apertura = 75 filas potenciales sin alterar.
- [x] Sin conexión a Neon, sin migración, sin `db push`, sin ejecución del seed, sin creación de buckets, sin subida real de archivos, sin implementación de SDK S3 ni de endpoints — todo lo relativo a esta etapa es solo modelo de datos y documentación.
- [x] Commit único de las Etapas 2, 2.1 y 2.2 realizado tras validar todo en verde (ver reporte de cierre entregado al usuario).

## Validaciones obligatorias de la Etapa 3B.1

- [x] `prisma format` / `prisma validate` / `prisma generate` — sin conexión, en verde.
- [x] Migración `20260923110309_auth_session_security` generada con `--create-only` (vía diff offline, ver `docs/ARCHITECTURE.md` §14.10), inspeccionada a mano antes de aplicar.
- [x] Migración aplicada solo a `demo` (`prisma migrate deploy`); `prisma migrate status` sin drift.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check` — en verde sobre el monorepo completo.
- [x] Suite unitaria del backend (`npm test`, incluye toda `backend/src/test/auth/`) — 205 tests en verde, sin conexión a Neon.
- [x] Suite de integración autorizada contra `demo` (`npm run test:integration`, guardada por `DATABASE_TARGET=demo`) — en verde; encontró y permitió corregir un bug real (rollback de la detección de reuso de refresh token dentro de `$transaction`, ver `docs/ARCHITECTURE.md` §14.3).
- [x] Verificado por SQL directo tras los tests de integración: 4 usuarios reales del seed intactos, 0 sesiones remanentes, 0 usuarios con prefijo de prueba — ninguna de las 75 filas originales tocada.
- [x] Escaneo de secretos sobre el diff completo (patrones de connection string con credenciales, claves de API, JWT reales, llaves privadas) — sin coincidencias.
- [x] Confirmado que `.env` sigue sin trackear (`git ls-files | grep -x ".env"` vacío) y que `.env.example` solo tiene placeholders vacíos con comentarios.
- [x] `npm run auth:bootstrap-admin` **no se ejecutó** en ningún momento de esta etapa — solo su núcleo puro se testeó, con limpieza determinística cuando llegó a crear un admin real de prueba contra `demo`.
- [x] Documentación actualizada: `README.md`, `docs/ARCHITECTURE.md` (§5, §6, §8, §11, y nueva §14), `docs/SECURITY.md`, `docs/DATABASE.md`, este documento, y `AGENTS.md` ("Estado actual").
- **No incluyó**: ninguna pantalla de login, ningún cambio funcional en `frontend/`, ninguna conexión a `production`, ningún uso de Object Storage, ningún despliegue, ninguna rama ni Pull Request (commit único directo sobre `main`).

## Validaciones obligatorias de la Etapa 3B.2

- [x] `prisma format` / `prisma validate` / `prisma generate` — en verde.
- [x] Migración `pin_authentication` generada offline (rename de columna/constraint a mano, ver `docs/ARCHITECTURE.md` §14.13), inspeccionada antes de aplicar.
- [x] Migración aplicada solo a `demo` (`prisma migrate deploy`); `prisma migrate status` sin drift.
- [x] `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check` — en verde sobre el monorepo completo.
- [x] Suite unitaria del backend (`npm test`) — 222 tests en verde, sin conexión a Neon.
- [x] Suite de integración autorizada contra `demo` (`npm run test:integration`) — 28 tests en verde, corrida dos veces para descartar flakiness; encontró y permitió corregir un bug real de duplicación del audit log de bloqueo bajo intentos concurrentes (ver `docs/ARCHITECTURE.md` §14.13).
- [x] Verificado por SQL directo tras los tests: 4 usuarios reales del seed siguen `PENDING_ACTIVATION` con `pin_hash: NULL` (mismo valor que tenían como `password_hash`), 0 sesiones remanentes, 0 usuarios con prefijo de prueba.
- [x] Escaneo de secretos y de PIN hardcodeados (`1234` y patrones equivalentes) sobre el diff completo — sin coincidencias.
- [x] Confirmado que `.env` sigue sin trackear y que `.env.example` no cambió (esta etapa no agregó variables de entorno nuevas).
- [x] `npm run auth:bootstrap-admin` **no se ejecutó** en ningún momento de esta etapa — solo su núcleo puro se testeó (unitariamente y contra `demo` con limpieza determinística).
- [x] Documentación actualizada: `README.md`, `docs/ARCHITECTURE.md` (§5, §8, y nueva §14.1/§14.1a/§14.6a/§14.13), `docs/SECURITY.md`, `docs/DATABASE.md`, `docs/BUSINESS_RULES.md`, `docs/SEED_MANIFEST.md`, este documento, y `AGENTS.md` ("Estado actual").
- **No incluyó**: ninguna pantalla de login ni selector visual en `frontend/`, ningún PIN asignado a los 4 usuarios reales, ninguna conexión a `production`, ningún uso de Object Storage, ningún despliegue, ninguna rama ni Pull Request (commit único directo sobre `main`).

## Validaciones obligatorias de la Etapa 3C

- [x] `npm run build` (frontend + backend), `npm run typecheck`, `npm run lint`, `npm run format:check` — en verde sobre el monorepo completo.
- [x] Suite de tests del frontend (`npm test --workspace=frontend`, Vitest) — 66 tests en verde, sin cambios en la suite del backend.
- [x] Suite completa del backend (`npm test`, 222 tests) y suite de integración autorizada contra `demo` (`npm run test:integration`, 28 tests) — en verde, sin ningún cambio de schema en esta etapa.
- [x] Verificación manual real (backend local + Vite real, no solo tests): health check ✅, proxy `/api` reenviando `/api/v1/auth/login-options` con headers CORS/credenciales correctos ✅, estado vacío real de `login-options` (`{"options":[]}`, 0 usuarios `ACTIVE` todavía) ✅, `POST /auth/refresh` sin cookie → 401 genérico ✅, validación de body de login (`VALIDATION_ERROR` con menos de 4 dígitos) ✅. **No se pudo verificar visualmente en un navegador real** (sin herramienta de navegador/captura de pantalla disponible en este entorno) — diseño responsive y ausencia de errores de consola en un navegador real quedan sin confirmar más allá de lo que ya cubren los 66 tests automatizados (jsdom).
- [x] Bundle de producción (`frontend/dist`) inspeccionado: sin `localStorage`/`sessionStorage`, sin `1234` ni ningún PIN hardcodeado, sin `VITE_API_URL`/URLs de backend, sin `dangerouslySetInnerHTML` en código propio (las coincidencias encontradas son del código interno de React empaquetado).
- [x] `git diff --check` sin advertencias de espacios en blanco; `git status` revisado antes del commit — ningún artefacto (`dist/`, cobertura, logs) trackeado.
- [x] Confirmado por SQL directo tras los tests de integración: 4 usuarios reales siguen `PENDING_ACTIVATION` sin PIN, 0 sesiones remanentes, 0 usuarios con prefijo de prueba — ninguna de las 75 filas tocada.
- [x] `npm run auth:bootstrap-admin` no se ejecutó; no se creó ningún administrador real; no se asignó ningún PIN real.
- [x] Documentación actualizada: `AGENTS.md` ("Estado actual"), `README.md`, `docs/ARCHITECTURE.md` (§4, §11, nueva §15), `docs/SECURITY.md`, este documento, y nuevo `frontend/README.md`.
- **No incluyó**: ningún dashboard ni módulo de negocio, ninguna migración, ningún despliegue real, ninguna rama ni Pull Request (commit único directo sobre `main`).

## Validaciones obligatorias de la Etapa 3D

- [x] `npm run build` (frontend + backend), `npm run typecheck`, `npm run lint`, `npm run format:check` — en verde sobre el monorepo completo (los únicos archivos con formato pendiente son los del cliente de Prisma generado en `backend/src/generated/`, preexistentes a esta etapa, no tocados por ella).
- [x] Suite de tests del frontend (`npm test --workspace=frontend`, Vitest) — 111 tests en verde (66 de la Etapa 3C + 45 nuevos de esta etapa).
- [x] Suite completa del backend (`npm test`, 222 tests) — en verde, sin cambios de schema en esta etapa.
- [x] Suite de integración autorizada contra `demo` (`npm run test:integration`) — 32 tests en verde (28 previos + 4 nuevos de esta etapa: el defecto de reactivación sin PIN corregido en §14.6b, más las verificaciones explícitas de que un usuario `SUSPENDED` no puede iniciar sesión y desaparece de `login-options`); limpieza determinística verificada, conteos globales de usuarios/sesiones/auditoría vueltos exactamente a su línea de base.
- [x] Verificación manual real con backend + Vite corriendo de verdad (no solo tests): health check ✅; `GET /admin/users` sin token → `401 { "error": { "message": "Autenticación requerida.", "code": "AUTH_REQUIRED" } }` (nunca una traza cruda) ✅; `GET /auth/login-options` sigue devolviendo `{"options":[]}` (0 usuarios activos, ningún administrador todavía) ✅; `GET /admin/users` a través del proxy de Vite (`/admin/users` como ruta de SPA) responde `200` ✅. **No se pudo verificar visualmente en un navegador real** (mismo motivo que en la Etapa 3C: sin herramienta de navegador/captura de pantalla en este entorno) — el flujo completo de login como admin real y la vista de los 4 empleados pendientes en pantalla quedan pendientes de la verificación manual posterior al bootstrap (ver "Puesta en marcha del primer administrador" más arriba), que el usuario deberá completar personalmente.
- [x] Bundle de producción (`frontend/dist`) inspeccionado: sin `pinHash`, sin `1234` ni ningún PIN hardcodeado, sin `localStorage`/`sessionStorage`, sin `dangerouslySetInnerHTML` en código propio.
- [x] Búsqueda de PIN hardcodeado (patrón `pin: '####'`) y de `localStorage`/`sessionStorage` en todo `frontend/src` (fuera de tests) — sin coincidencias.
- [x] `git diff --check` sin advertencias de espacios en blanco; `git status` revisado — ningún artefacto (`dist/`, cobertura, logs) trackeado; `frontend/dist`/`backend/dist` generados localmente para esta verificación quedan ignorados por `.gitignore`, no trackeados.
- [x] Escaneo de secretos (connection strings, API keys, JWT reales) sobre el diff completo — sin coincidencias.
- [x] Confirmado por la propia suite de integración (recién corrida): 4 usuarios reales siguen `PENDING_ACTIVATION` sin PIN, 0 usuarios/sesiones/auditorías de prueba remanentes.
- [x] `npm run auth:bootstrap-admin` **no se ejecutó** en ningún momento de esta etapa — solo se confirmó que su implementación previa (Etapas 3B.1/3B.2) sigue intacta.
- [x] Documentación actualizada: `AGENTS.md` ("Estado actual"), `README.md`, `frontend/README.md`, `docs/ARCHITECTURE.md` (nueva §14.6b y nueva §16), `docs/SECURITY.md`, `docs/BUSINESS_RULES.md` (§1), este documento.
- **No incluyó**: ningún cambio de schema ni migración, ninguna activación ni PIN asignado a los 4 empleados reales, ninguna conexión a `production`, ningún uso de Object Storage, ningún despliegue, ninguna rama ni Pull Request (commit único directo sobre `main`), ninguna ejecución real del bootstrap del administrador.

## Validaciones obligatorias de la Etapa 3E

- [x] Verificación inicial: rama `main` sincronizada con `origin/main`, working tree limpio, `docs/UI_CONTEXT.md` ya commiteado (`1e99cd5`) antes de empezar. Resultado base registrado antes de tocar código: 111 tests de frontend en verde, typecheck/lint/format:check limpios.
- [x] `npm install` (solo se agregaron `@fontsource/fraunces` y `@fontsource/karla` al workspace `frontend`).
- [x] `npm run build` (frontend + backend), `npm run typecheck`, `npm run lint`, `npm run format:check` — en verde sobre el monorepo completo.
- [x] `README.md` raíz actualizado al estado real (administrador de `demo` ya creado por el usuario, `login-options` no vacío, empleados pendientes salvo activación manual) — sin username, PIN, hashes ni datos sensibles.
- [x] Tests de frontend: 189 en verde. Tests de backend: 222 en verde, sin cambios de código de backend.
- [x] Bundle de producción (con `NODE_ENV=production`): JS 280.36 → 290.69 kB (gzip 88.27 → 91.27 kB); CSS 8.35 → 27.58 kB (gzip 5.62 kB); 5 caras tipográficas como assets locales (~81 kB en woff2, descargadas solo si se usan). **Hallazgo preexistente, corregido en esta etapa**: `npm run build` con un `.env` que define `NODE_ENV=development` generaba el build de desarrollo de React (~518 kB). Ahora `npm run build` pasa por `frontend/scripts/build.mjs` (fija `NODE_ENV=production` antes de cargar Vite) y una guarda en `vite.config.ts` hace fallar cualquier `vite build` que no sea de producción — verificado con el `.env` real (sin leerlo ni modificarlo): 290.70 kB, cero marcadores de desarrollo de React; test de regresión `frontend/src/test/productionBuild.test.ts` (comprobado que falla sin la corrección). Ver `docs/ARCHITECTURE.md` §17.2.
- [x] Escaneo sobre `frontend/src`, el diff y el bundle de producción: sin `localStorage`/`sessionStorage` (solo menciones en comentarios), sin PIN hardcodeado ni `1234`, sin `dangerouslySetInnerHTML`/`innerHTML` en código propio (las coincidencias del bundle son internas de React), sin URL/clave de Supabase ni de Neon, sin tokens ni secretos, sin datos mock en runtime (los fixtures sintéticos están solo en tests), sin peticiones a Google Fonts.
- [x] `git diff --check` sin advertencias; ningún `dist/`, cobertura, captura, log ni archivo temporal trackeado (las capturas de la revisión visual quedaron fuera del repo).
- [x] Revisión visual automatizada (Chrome headless vía DevTools Protocol, backend y Vite reales) en 360×800, 390×844, 768×1024, 1366×768, 1920×1080 y 844×390: sin scroll horizontal, sin objetivos táctiles < 44px, fuentes locales cargadas. Login y PIN contra el backend real (sin enviar ningún PIN); Inicio/Usuarios/diálogos/acceso denegado con respuestas sintéticas interceptadas en ese navegador (sin tocar backend ni base). Corrigió tres detalles: marca partida en el header a 360px, acciones apretadas del listado a 768px, etiqueta "Administrador" redundante para la cuenta admin sin persona vinculada.
- [ ] Aprobación visual humana (login, selección de Administrador, teclado PIN, Inicio, Usuarios, diálogo de PIN, diálogo de confirmación, vista móvil).
- [ ] Commit único (`style: align frontend with La Cañada visual identity`) y push a `origin/main`, solo después de la aprobación.
- **No incluyó**: ninguna escritura en la base (ni seed, ni migraciones, ni `db push`, ni bootstrap, ni cambios de PIN/estado), ninguna conexión a `production`, ningún uso de Object Storage, ningún módulo de negocio.

## Validaciones obligatorias de la Etapa 4A

- [x] Verificación inicial: `main` sincronizada con `origin/main`, working tree limpio, `DATABASE_TARGET=demo`, 3 migraciones al día, 10 tareas reales (4 diarias, 3 semanales, 2 mensuales, 1 urgente) sin duplicados, 0 ejecuciones.
- [x] `prisma format`/`validate`/`generate`; migración generada offline e inspeccionada; `migrate deploy` solo en `demo`; `migrate status` al día; `migrate diff` contra la base real vacío (sin drift).
- [x] `npm run build`, `typecheck`, `lint`, `format:check` — en verde.
- [x] Tests: frontend 226, backend unitarios 264, integración contra `demo` 54 (22 nuevos de tareas, incluida la carrera de 8 finalizaciones simultáneas) — la de integración corrida dos veces.
- [x] Tras los tests: 10 tareas reales idénticas (id, descripción, responsable, frecuencia, estado, `updatedAt`), 0 ejecuciones, conteos de usuarios/sesiones/empleados/auditorías de vuelta a su línea base (las únicas auditorías nuevas en `demo` son un login/logout del administrador real hecho por el usuario).
- [x] Escaneo de secretos, URLs de Neon/Supabase, PIN/`1234`, storage, `dangerouslySetInnerHTML`, SQL crudo, UUIDs hardcodeados, datos mock en runtime y errores de Prisma expuestos — sin hallazgos nuevos.
- [x] Revisión visual automatizada (Chrome headless, respuestas sintéticas interceptadas, sin escritura en la base) de `/tasks` y sus diálogos en 360/390/768/1366/1920 px: sin scroll horizontal de página, sin objetivos táctiles < 44px.
- [ ] Revisión visual humana y commit (`feat: implement task management module`) a cargo del usuario.
