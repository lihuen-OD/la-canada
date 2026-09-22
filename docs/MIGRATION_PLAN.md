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

## Etapa 3 — Implementar autenticación

- **Objetivo**: reemplazar el PIN comparado en el cliente por autenticación real del lado del backend, sobre el modelo `User`/`Session` ya definido en la Etapa 2.
- **Alcance sugerido**:
  - Definir con el usuario el mecanismo real de activación de los 4 `User` `PENDING_ACTIVATION` ya sembrados (invitación por link, contraseña temporal, u otro).
  - Sesión gestionada por el backend (cookie httpOnly o JWT de corta duración con refresh vía `Session.refreshTokenHash` — decisión a tomar en esta etapa, ver `docs/ARCHITECTURE.md` §5-6).
  - Autorización real por rol (`ADMIN`/`EMPLOYEE`) verificada en cada endpoint, no solo ocultada en la UI.
  - Proceso seguro para crear el administrador inicial (variable de entorno o comando administrativo — nunca datos inventados en el seed, ya excluido a propósito en la Etapa 2).
- **No incluye**: exponer ningún secreto en el frontend (regla 8 de `AGENTS.md`).

## Etapa 4 — Reconstruir el frontend sin alterar el diseño

- **Objetivo**: recrear en React + TypeScript las 14 pantallas identificadas en `docs/PROJECT_CONTEXT.md` §3, preservando la paleta de colores, tipografías (Fraunces/Karla), layout mobile-first con navegación inferior/sidebar, y componentes visuales (cards, chips, modales tipo bottom-sheet, badges de estado).
- **Alcance sugerido**:
  - Extraer el sistema de diseño (`:root` de `index.html`) a tokens reutilizables (CSS variables o equivalente en el stack elegido).
  - Reconstruir componentes visuales genéricos primero (Card, Chip, Modal, Badge, Avatar, KPI) y luego las pantallas, reemplazando la pantalla técnica temporal de la Etapa 1.
  - El frontend consume **solo** la API del backend (nunca Prisma/Postgres directo) — corrige el hallazgo central de `docs/SECURITY.md`.
- **No incluye**: rediseñar la interfaz; cualquier cambio visual respecto al original requiere pedido explícito del usuario (regla 6 de `AGENTS.md`).

## Etapa 5 — Implementar módulos gradualmente

- **Objetivo**: portar la lógica de negocio de `docs/BUSINESS_RULES.md` al backend, módulo por módulo, en lugar de todo de una vez, usando los modelos ya definidos en la Etapa 2.
- **Orden sugerido** (a confirmar con el usuario, ajustable): Empleados/Usuarios → Tareas (con `Task.active` y `TaskExecution` ya modelados) → Inventario (con `StockMovementType` ya reemplazando el hack de prefijos de texto) → Novedades → Eventos y cumpleaños recurrentes (ya resuelta la ambigüedad de origen del campo `nota`) → Gallinero (singleton por convención, ya documentado) → Mascotas (con `AnimalType` ya normalizado) → Datos de empleados/hijos → Fotos (como paso previo a la Etapa 6) → Clima (usando `PropertyLocation`).
- Cada módulo migrado se valida contra las reglas ya documentadas en `docs/BUSINESS_RULES.md`, corrigiendo — no reproduciendo — los bugs verificados ahí (desempeño roto, `DIAS_ES` indefinido, permisos inconsistentes de fotos ya resueltos a favor de admin-only, etc.), salvo que el usuario pida explícitamente mantener algún comportamiento tal cual está.
- **No incluye**: adelantar módulos fuera de orden sin acuerdo, ni mezclar el fix de un bug con la migración de un módulo no relacionado.

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
