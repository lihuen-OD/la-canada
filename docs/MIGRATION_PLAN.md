# MIGRATION_PLAN.md — Plan de migración por etapas

> Este documento **planifica** etapas; no las ejecuta. Cada etapa requiere autorización humana explícita antes de comenzar (ver `AGENTS.md`, regla 3). El orden es secuencial pero no rígido: si en una etapa surge información que cambia el plan, se ajusta este documento antes de continuar, no se improvisa en silencio.

## Etapa 0 — Documentación (esta etapa)

- **Objetivo**: auditar `index.html` sin modificarlo y producir la documentación base (`AGENTS.md` + `docs/*.md`).
- **Estado**: completada por este documento y sus acompañantes.
- **Validación de cierre**: ver el resumen ejecutivo entregado al usuario al finalizar esta auditoría.

## Etapa 1 — Preservar el prototipo

- **Objetivo**: asegurar que `index.html` quede resguardado como referencia inmutable antes de tocar nada más.
- **Alcance sugerido**:
  - Inicializar control de versiones si aún no existe (se detectó que el proyecto no tiene `git` inicializado).
  - Primer commit conteniendo únicamente `index.html` + la documentación de la Etapa 0, sin ningún otro cambio.
  - Definir la convención de que `index.html` no se edita salvo pedido explícito del usuario (ya establecido en `AGENTS.md`).
- **No incluye**: mover el archivo, renombrarlo, ni tocar su contenido.

## Etapa 2 — Crear la estructura profesional

- **Objetivo**: andamiaje de carpetas y configuración base para frontend y backend, sin lógica de negocio todavía.
- **Alcance sugerido**:
  - `frontend/` — proyecto Vite + React + TypeScript vacío/base.
  - `backend/` — proyecto Node + TypeScript + Express vacío/base, con estructura de carpetas (rutas, controladores, servicios) a definir.
  - Configuración de linting/formato, `tsconfig`, scripts de desarrollo.
  - `.env.example` en cada proyecto (sin valores reales) documentando las variables previstas en `docs/ARCHITECTURE.md` §10.
- **No incluye**: implementar ninguna pantalla ni endpoint todavía.

## Etapa 3 — Diseñar Prisma

- **Objetivo**: convertir el borrador de `docs/DATABASE.md` en un `schema.prisma` real, resolviendo junto con el usuario las dudas marcadas ahí (FK real vs. texto libre para categorías/tipos, modelo de `periodo` en ejecuciones, columna `tipo` estructurada en movimientos de stock, soft-delete uniforme, si se agrega auditoría transversal, si se agrega `tareas.activa`).
- **Alcance sugerido**:
  - Resolver cada duda de `docs/DATABASE.md` con el usuario antes de escribir el schema final.
  - Escribir `schema.prisma` con todos los modelos de las 18 entidades identificadas.
  - Generar la migración inicial de Prisma contra una base Neon (de desarrollo, no producción) recién creada para este proyecto.
- **No incluye**: ejecutar migraciones contra ninguna base ya en uso; no se reutiliza ni se toca el proyecto Supabase actual.

## Etapa 4 — Crear el seed con datos reales

- **Objetivo**: poblar la base nueva con toda la información real identificada en `docs/DATA_INVENTORY.md`.
- **Alcance sugerido**:
  - Seed de personas, tareas, stock (casa + jardín) — igual que hace hoy `seedData()` en el prototipo.
  - Seed de lo que el prototipo **no** siembra hoy pero sí declara como dato real: categorías de stock, tipos de mascota, destino "Ajuste de inventario", novedades iniciales, cumpleaños familiares (Vicky, Felicitas sin duda; Benjamín una vez resuelta la inconsistencia de fecha con el usuario).
  - Confirmar con el usuario, antes de sembrar: la fecha correcta de cumpleaños de Benjamín (19/02 vs. 16/09), si los eventos "Revisión bomba de agua" y "Visita familia O'Dwyer" siguen vigentes, y la cantidad real actual de gallinas activas (no hay valor real declarado en el código).
- **No incluye**: inventar datos que no estén en `index.html` ni confirmados por el usuario.

## Etapa 5 — Implementar autenticación

- **Objetivo**: reemplazar el PIN comparado en el cliente por autenticación real del lado del backend.
- **Alcance sugerido**:
  - Definir con el usuario si se mantiene el esquema de PIN (ahora verificado server-side, con hashing y límite de intentos) o se migra a un esquema distinto.
  - Sesión gestionada por el backend (cookie httpOnly o JWT de corta duración — decisión a tomar en esta etapa, ver `docs/ARCHITECTURE.md` §5-6).
  - Autorización real por rol (`ADMIN`/`EMPLOYEE`) verificada en cada endpoint, no solo ocultada en la UI.
  - Decidir, con el usuario, cómo se resuelve la identidad del admin (hoy no se distingue *qué* admin actuó — ver `docs/BUSINESS_RULES.md` §4 y `docs/ARCHITECTURE.md` §8).
- **No incluye**: exponer ningún secreto en el frontend (regla 8 de `AGENTS.md`).

## Etapa 6 — Reconstruir el frontend sin alterar el diseño

- **Objetivo**: recrear en React + TypeScript las 14 pantallas identificadas en `docs/PROJECT_CONTEXT.md` §3, preservando la paleta de colores, tipografías (Fraunces/Karla), layout mobile-first con navegación inferior/sidebar, y componentes visuales (cards, chips, modales tipo bottom-sheet, badges de estado).
- **Alcance sugerido**:
  - Extraer el sistema de diseño (`:root` de `index.html`) a tokens reutilizables (CSS variables o equivalente en el stack elegido).
  - Reconstruir componentes visuales genéricos primero (Card, Chip, Modal, Badge, Avatar, KPI) y luego las pantallas.
  - El frontend consume **solo** la API del backend (nunca Supabase directo) — corrige el hallazgo central de `docs/SECURITY.md`.
- **No incluye**: rediseñar la interfaz; cualquier cambio visual respecto al original requiere pedido explícito del usuario (regla 6 de `AGENTS.md`).

## Etapa 7 — Implementar módulos gradualmente

- **Objetivo**: portar la lógica de negocio de `docs/BUSINESS_RULES.md` al backend, módulo por módulo, en lugar de todo de una vez.
- **Orden sugerido** (a confirmar con el usuario, ajustable): Personas → Tareas (incluyendo el fix del bug de `activa`/desempeño) → Stock (incluyendo categorías, destinos, consumos, reportes) → Novedades → Eventos (incluyendo cumpleaños automáticos, ya resueltos los conflictos de fecha) → Gallinero (incluyendo el fix del bug `DIAS_ES` y el problema de fila singleton) → Mascotas (incluyendo registros clínicos y tipos) → Empleados/Mi perfil/Hijos → Fotos (como paso previo a la Etapa 8) → Clima.
- Cada módulo migrado se valida contra las reglas ya documentadas en `docs/BUSINESS_RULES.md`, corrigiendo — no reproduciendo — los bugs verificados ahí (desempeño roto, `DIAS_ES` indefinido, permisos inconsistentes de fotos, etc.), salvo que el usuario pida explícitamente mantener algún comportamiento tal cual está.
- **No incluye**: adelantar módulos fuera de orden sin acuerdo, ni mezclar el fix de un bug con la migración de un módulo no relacionado.

## Etapa 8 — Integrar Google Drive

- **Objetivo**: reemplazar el almacenamiento de fotos como base64 en Postgres por archivos en Google Drive, gestionados desde el backend.
- **Alcance sugerido**:
  - Backend recibe el archivo, lo sube a Drive con credenciales de servicio (nunca en el cliente), y persiste en Postgres solo la referencia.
  - Definir con el usuario la estructura de carpetas en Drive y los permisos de acceso (especialmente considerando que puede haber fotos de menores de edad, ver `docs/SECURITY.md` §7).
  - Migrar las fotos ya existentes en Supabase (si las hay) de base64 a Drive, como parte de esta etapa o de una etapa de migración de datos legada a definir con el usuario.
- **No incluye**: subir archivos directo desde el frontend a Drive.

## Etapa 9 — Probar

- **Objetivo**: validar funcionalmente que el sistema reconstruido reproduce (o mejora deliberadamente, cuando así se acordó) el comportamiento documentado en `docs/BUSINESS_RULES.md`.
- **Alcance sugerido**:
  - Tests automatizados de backend (lógica de negocio: períodos, estados de stock, desempeño, permisos por rol).
  - Pruebas manuales de UI en mobile y escritorio, cubriendo los 14 módulos.
  - Checklist específico contra cada hallazgo de `docs/SECURITY.md` (confirmar que ya no aplica en la nueva arquitectura).
- **No incluye**: pruebas contra el proyecto Supabase actual (no se usa en la nueva arquitectura).

## Etapa 10 — Desplegar

- **Objetivo**: publicar frontend en Netlify, backend en Render, base en Neon.
- **Alcance sugerido**:
  - Variables de entorno de producción configuradas en cada plataforma (nunca commiteadas).
  - Configuración de CORS entre Netlify y Render.
  - Plan de rollback y de baja del proyecto Supabase actual (una vez confirmado que ya no se usa — recordar: "la conexión actual con Supabase será eliminada más adelante", no en esta etapa de documentación).
- **No incluye**: eliminar el proyecto Supabase actual sin confirmación explícita del usuario de que la migración de datos está completa y verificada.

---

## Validaciones obligatorias de esta etapa (Etapa 0)

- [x] Leído `index.html` completo (líneas 1 a 4206), no solo fragmentos.
- [x] Buscadas todas las referencias a Supabase (`SB_URL`, `SB_KEY`, `sbFetch`/`sbGet`/`sbPost`/`sbPatch`/`sbDel`/`sbUpsert`, y llamadas `fetch` crudas contra `rest/v1/`) — 18 tablas identificadas y documentadas en `docs/DATABASE.md`.
- [x] Buscados todos los arrays y objetos precargados (`personas`, `tareas`, `sCasa`, `sJardin`, `novedades`, `eventos`, catálogos de tipos/categorías/cumpleaños familiares) — documentados en `docs/DATA_INVENTORY.md`, incluyendo cuáles se siembran automáticamente hoy y cuáles no.
- [x] Buscadas todas las funciones de lectura y escritura (`sbGet`/`sbPost`/`sbFetch` y sus llamadas) — mapeadas por módulo en `docs/BUSINESS_RULES.md` y `docs/DATABASE.md`.
- [x] Identificadas funciones duplicadas/redefinidas — 13 funciones con doble declaración, documentadas en `docs/PROJECT_CONTEXT.md` §7 y `docs/ARCHITECTURE.md` §2.
- [x] Confirmados todos los módulos y pantallas — 14 pantallas (`div.pg`) listadas en `docs/PROJECT_CONTEXT.md` §3.
- [x] Confirmado que no se modificó `index.html` (ver confirmación explícita en el resumen final entregado al usuario).
- [x] Confirmado que no se creó código funcional nuevo — solo se crearon `AGENTS.md` y los 7 archivos de `docs/`, todos documentación en Markdown.
