# AGENTS.md — Reglas obligatorias del proyecto "La Cañada"

Este documento rige el comportamiento de cualquier agente (humano o IA) que trabaje en este repositorio, en todas las etapas del proyecto. Es de cumplimiento obligatorio.

## Contexto del proyecto

"La Cañada" está en transición desde un prototipo funcional de un único archivo (`index.html`, HTML + CSS + JS embebido, conectado directamente a Supabase) hacia una aplicación profesional full stack:

- **Frontend:** React + TypeScript + Vite, desplegado en Netlify.
- **Backend:** Node.js + TypeScript + Express, desplegado en Render.
- **ORM:** Prisma.
- **Base de datos:** PostgreSQL en Neon.
- **Fotografías:** Neon Object Storage (interfaz compatible con S3, buckets privados), integrado a través del backend (nunca directo desde el frontend).

El detalle completo está en `docs/`. Este archivo no repite ese contenido: define **reglas de trabajo**.

## Reglas obligatorias

1. **Leer antes de tocar código.** Antes de modificar o crear código en cualquier etapa, leer los documentos relevantes en `docs/` (como mínimo `PROJECT_CONTEXT.md`, `BUSINESS_RULES.md` y `ARCHITECTURE.md`). No asumir comportamiento: verificar contra la documentación migrada del prototipo original (`docs/DATABASE.md`, `docs/BUSINESS_RULES.md`, `docs/DATA_INVENTORY.md` — el HTML original ya no está físicamente en el repositorio, ver regla 9) y contra la base de datos real cuando exista.

2. **Etapas pequeñas y verificables.** El trabajo se divide en etapas chicas, cada una con un objetivo único y comprobable (ver `docs/MIGRATION_PLAN.md`). No mezclar objetivos de etapas distintas en un mismo cambio.

3. **No avanzar sin autorización.** Ninguna etapa siguiente del plan de migración se inicia sin que una persona humana la autorice explícitamente. Terminar una etapa y reportar es obligatorio; continuar a la siguiente no lo es.

4. **No introducir datos mock.** Todo dato de persona, tarea, producto, categoría, evento, configuración o similar debe salir de la documentación migrada del prototipo original (`docs/DATA_INVENTORY.md`, `docs/SEED_MANIFEST.md` — datos iniciales reales) o ser provisto explícitamente por el usuario. No inventar nombres, cantidades, fechas ni registros de ejemplo para "rellenar" pantallas o pruebas, salvo que se lo pida el usuario y se etiquete como tal.

5. **No eliminar datos reales.** Los datos reales extraídos del prototipo original (documentados en `docs/DATA_INVENTORY.md`) no se descartan. Si un dato parece inconsistente o duplicado, se documenta la duda — no se borra silenciosamente.

6. **No modificar el diseño sin pedido explícito.** El diseño visual actual (paleta de colores, tipografías Fraunces/Karla, layout mobile-first con navegación inferior y sidebar de escritorio, componentes como cards/chips/modales) se preserva al reconstruir el frontend. Cambios visuales requieren solicitud explícita del usuario.

7. **El frontend nunca habla directo con la base de datos.** Toda lectura y escritura de datos pasa por el backend (Express + Prisma). Está prohibido repetir el patrón actual de `index.html` (fetch directo a Supabase con URL y API key embebidas en el cliente).

8. **Cero secretos en el código.** PIN, contraseñas, API keys, tokens o credenciales de cualquier tipo no se hardcodean ni se commitean. Van en variables de entorno (`.env`, no versionado) y se gestionan según `docs/ARCHITECTURE.md` / `docs/SECURITY.md`.

9. **`index.html`/`legacy/index.original.html` fueron retirados del repositorio (Etapa 2.3) — no se restauran.** El prototipo original contenía una URL y una API key reales de Supabase hardcodeadas en texto plano; una vez confirmado que todo su contenido funcional, visual y de datos ya estaba migrado a `docs/`, a `backend/prisma/schema.prisma` y al seed, se eliminó del árbol de trabajo **y de todo el historial de Git local** (no solo del último commit). Ver `docs/MIGRATION_PLAN.md`, "Etapa 2.3", para el detalle completo. Ninguna etapa futura debe asumir que el archivo físico existe: la fuente de verdad del diseño y comportamiento original es la documentación (`docs/PROJECT_CONTEXT.md`, `docs/BUSINESS_RULES.md`, `docs/DATABASE.md`, `docs/DATA_INVENTORY.md`), no el HTML. Esta regla no habilita retirar ningún otro archivo sin el mismo pedido explícito y el mismo nivel de verificación previa.

10. **Validar antes de cerrar una etapa.** Antes de dar por cerrada una etapa: correr las validaciones que correspondan (lint, typecheck, build, tests, revisión manual), confirmar que no se rompió nada de lo ya construido, y confirmar que el alcance ejecutado coincide con el alcance autorizado.

11. **Reportar siempre al cerrar una etapa.** Todo cierre de etapa incluye: archivos creados/modificados, decisiones tomadas (y por qué), validaciones ejecutadas y su resultado, y pendientes u dudas que quedan abiertas para la siguiente etapa.

12. **Dudas se preguntan, no se asumen.** Ante una regla de negocio ambigua, un dato inconsistente, o una decisión de arquitectura no cubierta por `docs/`, preguntar al usuario en vez de asumir. `docs/BUSINESS_RULES.md` y `docs/DATA_INVENTORY.md` marcan explícitamente las dudas detectadas hasta ahora.

13. **Rendimiento es parte del cierre (desde la Etapa 5P).** Navegación interna solo con `Link`/`NavLink`/`useNavigate` (nunca `<a href>` interno ni `window.location`); datos del frontend solo vía TanStack Query con claves de `api/queryKeys.ts` (alcance por usuario, sin storage). Todo módulo nuevo informa al cerrar su etapa: requests agregadas por pantalla, política de caché (`staleTime`), invalidaciones tras mutaciones, comportamiento de loading/revalidación, paginación, riesgo N+1, índices usados, impacto en bundle, impacto en Render/Neon y un test de navegación que pruebe que no se reinicia la sesión. Detalle en `docs/ARCHITECTURE.md` §22.

14. **Paridad funcional con el prototipo.** La aplicación nueva conserva las funciones y los permisos del `index.html` original: lo que el prototipo permitía a todos sigue permitido a todos; lo que restringía a admin sigue restringido. No se agregan, eliminan ni restringen funciones por "mínimo privilegio" o recomendaciones nuevas sin autorización expresa; las mejoras de seguridad son internas y no cambian la experiencia autorizada. Si la conducta original no se puede determinar con `docs/`, se informa la ambigüedad y se pide el HTML original como referencia temporal (sin volver a versionarlo). **Única excepción autorizada**: Desempeño — `ADMIN` ve a todos y el detalle de cada uno; `EMPLOYEE` solo el propio, impuesto por el backend. Ver `docs/BUSINESS_RULES.md`, "Regla de paridad funcional".

## Estado actual

**Actualización Etapa 5C.2 (sin commit, lista para revisión):** Stock funcional completo — subvistas SPA 🏠 Casa / 🌿 Jardín / 🛒 Compras / 📊 Reportes / ⚙️ Catálogo (ADMIN), `stockLevel` solo del backend, destinos opcionales en todos los movimientos y Catálogo (sin borrado), persona/fecha según paridad, modal unificado ingreso/consumo, ajuste ADMIN, alta ADMIN desde inventario, `Idempotency-Key` en todo movimiento, Compras compartible/agrupable y reportes server-side con CSV. Ver `docs/MIGRATION_PLAN.md`, "Etapa 5C.2", y `docs/ARCHITECTURE.md` §23. No avanzar a otro módulo sin autorización.

**Actualización Etapa 5P (sin commit):** navegación SPA real (Tareas ↔ Desempeño recargaba el documento), capa de datos con TanStack Query (caché por usuario, deduplicación, revalidación sin borrar datos, invalidación selectiva), logout que espera al refresh en vuelo, restauración de sesión single-flight también en `/auth/me`, carrera del refresh concurrente corregida (`P2028` → perdedor 401 o `503` reintentable, nunca 500) y `requireAuth` con una sola sentencia SQL (validado contra `demo`). Ver `docs/MIGRATION_PLAN.md`, "Etapa 5P". Sin migraciones; 5C.2 sigue pendiente.

**Actualización Etapas 5C.1A + 5C.1B (commit local `a5cff77`) + 5C.1C (migración aplicada a `demo`):** backend de Stock extendido offline sobre el contrato de 5A/5B: modelo `IdempotencyRecord` + migración incremental `20260924210000_stock_idempotency_balance_check` (tabla de idempotencia + `CHECK current_quantity >= 0`) **generada, revisada y aplicada **solo a `demo`** en 5C.1C**; CRUD de destinos sin borrado físico (solo `ADMIN`: crear, renombrar, inactivar — auditorías `stock.destination.*`); filtro `stockLevel` server-side en `GET /stock/items` (SQL parametrizado en Postgres, columna-vs-columna) y `stockLevel` calculado en el DTO (el frontend conserva `barPercent`); header opcional `Idempotency-Key` en `POST /stock/items/:id/movements` (transacción única, replay exacto, `409` en cuerpo distinto, sin caché ni purga). Tests unitarios y los 7 documentos de la etapa actualizados. Auditoría correctiva completada el 2026-09-25 (fake con `P2002` real de `adapter-pg`, UUID canónicos en la huella, migración verificada offline contra `prisma migrate diff`) — sigue sin commit.

Ver `docs/MIGRATION_PLAN.md` para la etapa vigente (entrada "Etapa 5C.1A + 5C.1B"). El proyecto completó las Etapas 0–5B y el alcance offline de 5C.1A/5C.1B; **la 5C.1C ya se ejecutó** (2026-09-25): commit local `a5cff77` sin push, migración aplicada **solo a `demo`** e integración real en verde; la corrección posterior (lecturas secuenciales dentro de la transacción idempotente) y la integración nueva quedaron commiteadas y publicadas. El próximo trabajo es la Etapa 5P, cuyo primer bloqueo técnico es un fallo intermitente del `refresh` concurrente de Auth (ver `docs/MIGRATION_PLAN.md`, "Etapa 5C.1C"); 5C.2 sigue pendiente de autorización. El `EMPLOYEE` Coke está `ACTIVE` por activación intencional del usuario. `docs/UI_CONTEXT.md` sigue siendo la fuente de verdad visual. `production` continúa sin tocarse; **el primer administrador de `demo` ya fue creado por el usuario personalmente** con el bootstrap interactivo — no se vuelve a ejecutar; los 4 empleados reales siguen `PENDING_ACTIVATION`, sin PIN, y no se activan ni se les asigna PIN sin autorización explícita puntual. Las pruebas de 5B/5C.1 usan respuestas sintéticas y no modifican filas reales. No hay frontend nuevo (5C.2 queda pendiente); no hay dashboard ni otros módulos nuevos (reales o mock). Para módulos nuevos: conservar los emojis del prototipo junto con texto accesible.
