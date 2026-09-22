# PROJECT_CONTEXT.md — Contexto del proyecto "La Cañada"

> Fuente: auditoría estática y completa de `index.html` (4206 líneas, HTML + CSS + JS embebidos, sin build ni dependencias de paquete). No se ejecutó el archivo en navegador; todo lo aquí descrito surge de lectura de código.

## 1. Propósito

"La Cañada" es un sistema de gestión operativa para una propiedad/casa de campo (el título en el HTML es "Sistema de gestión", con branding "🌿 La Cañada"). Centraliza:

- Tareas domésticas y de parque/jardín, con frecuencia y asignación por persona.
- Inventario de insumos de "Casa" y "Jardín" (stock, mínimos, categorías, consumos).
- Gallinero: conteo de gallinas y registro diario de recolección de huevos.
- Mascotas/animales de campo: ficha, historial clínico (vacunas, peso, desparasitación, chequeos).
- Novedades operativas (bitácora de avisos entre el equipo).
- Eventos y cumpleaños (familia, empleados, hijos de empleados, mascotas).
- Clima local (Villa Elisa, Entre Ríos) con recomendaciones de jardín.
- Fotos (recuerdos y evidencia de tareas).
- Datos administrativos del equipo de trabajo (ficha personal, contacto de emergencia, hijos).

## 2. Tipos de usuarios

El sistema define **dos roles**, seleccionados en una pantalla de PIN al iniciar (no hay registro de cuentas, ni email/usuario):

| Rol | Cómo se ingresa | Alcance observado en el código |
|---|---|---|
| **Administrador** (`admin`) | PIN de 4 dígitos único y compartido (variable `ADMIN_PIN`, ver `docs/SECURITY.md`) | Acceso completo: crear/editar/eliminar tareas, personas, ítems de stock, eventos, categorías, destinos, tipos de mascota; ver reportes de cumplimiento y consumo; configurar PIN de cada persona. |
| **Equipo de trabajo** (`user`) | Selecciona su nombre de una lista de personas activas y luego ingresa su propio PIN de 4 dígitos (se define solo la primera vez que lo usa) | Puede: tildar tareas, registrar consumos/ingresos de stock, registrar novedades, registrar recolección de huevos, registrar datos clínicos de mascotas, cargar/editar su propio perfil ("Mi perfil") e hijos, subir y **eliminar** fotos. No ve botones de edición/borrado de tareas, eventos, stock, personas, categorías. |

Nota: el rol no está ligado a una fila de "usuario" en base de datos con permisos — es una variable de sesión (`currentRole`) evaluada en el propio HTML. Ver `docs/SECURITY.md` para el análisis de riesgo de esto.

## 3. Módulos existentes

Identificados por los `<div class="pg" id="pg-...">` del HTML (14 pantallas):

1. **Inicio** (`pg-inicio`) — dashboard: KPIs del día, tareas urgentes, avance del equipo, stock bajo, próximos eventos, últimas novedades.
2. **Tareas** (`pg-tareas`) — lista de tareas con filtro por persona/frecuencia, historial semanal, y pestaña de **Desempeño** (ranking, estrella de la semana, cumplimiento, tareas incumplidas).
3. **Stock** (`pg-stock`) — sub-pestañas Casa / Jardín / Compras / Reportes; alta, edición, ajuste y consumo de ítems; gestión de categorías y destinos (admin); reportes de consumo por destino/persona/ítem con exportación CSV.
4. **Novedades** (`pg-novedades`) — bitácora de avisos (alta únicamente, sin edición ni borrado).
5. **Eventos** (`pg-eventos`) — calendario de eventos (visitas, cumpleaños, mantenimiento, otros), con altas automáticas de cumpleaños.
6. **Clima** (`pg-clima`) — clima actual y pronóstico a 5 días vía Open-Meteo, con recomendaciones de jardín generadas por reglas.
7. **Fotos** (`pg-fotos`) — galería con filtro tarea/recuerdo, subida como base64, eliminación abierta a cualquier usuario logueado.
8. **Mascotas** (`pg-mascotas`) — listado con filtro por tipo.
9. **Detalle de mascota** (`pg-mascota-detalle`) — ficha, KPIs, alta de registros clínicos, historial filtrable.
10. **Gallinero** (`pg-gallinero`) — conteo de gallinas activas, registro de recolección, estadísticas por período, historial.
11. **Más** (`pg-mas`) — menú de accesos a Novedades, Eventos, Clima, Fotos, Configuración (admin) y Mi perfil (empleado).
12. **Configuración** (`pg-config`, solo admin) — gestión de personas, acceso a datos del equipo, calendario mensual de tareas, cambio de PIN de admin.
13. **Datos del equipo** (`pg-empleados-datos`, solo admin) — listado de fichas de empleados con filtro completos/incompletos.
14. **Mi perfil** (`pg-mi-perfil`, empleado) — autogestión de datos personales, contacto de emergencia e hijos.

## 4. Flujo general

1. Al cargar, se muestra una pantalla de carga (`app-loading`) mientras `loadAll()` trae datos de Supabase (personas, tareas, ejecuciones, stock, novedades, eventos, fotos, y luego PINs, gallinero, mascotas, datos de empleados, consumos, categorías).
2. Si `personas` viene vacío de la base, se ejecuta `seedData()`, que crea en Supabase las 4 personas, 10 tareas y 14 ítems de stock definidos como literales en el HTML (ver `docs/DATA_INVENTORY.md` para el detalle y las excepciones — **no todos** los datos iniciales del HTML se siembran automáticamente).
3. Se muestra la pantalla de PIN (`pin-screen`): elegir "Administrador" o "Equipo de trabajo" (y dentro de este, la persona).
4. Tras un PIN válido, `enterApp()` guarda `lc_role`/`lc_uid` en `sessionStorage` y aplica la UI según rol (`applyRoleUI()`).
5. La navegación entre pantallas es 100% client-side (`ir(pg)` oculta/muestra `div.pg` y vuelve a renderizar la pantalla activa desde el estado en memoria — no hay router de URL, no hay recarga de página).
6. Cada acción de escritura (tildar tarea, guardar ítem, registrar consumo, etc.) hace un `fetch` directo a la REST API de Supabase (`SB_URL + '/rest/v1/<tabla>'`) con la API key anónima embebida, actualiza el estado en memoria de forma optimista, y vuelve a renderizar.

## 5. Comportamiento móvil y escritorio

- **Mobile-first**: `viewport` fija `initial-scale=1, user-scalable=no`; metaetiquetas de PWA (`apple-mobile-web-app-capable`, `apple-mobile-web-app-title`). La sección "Instalar como app" en Configuración documenta el alta a pantalla de inicio en iPhone/Android — **no hay manifest.json ni service worker**, por lo que no es una PWA instalable real, solo un acceso directo de navegador.
- Navegación inferior fija (`.bnav`) con 6 ítems visibles (Inicio, Tareas, Stock, Gallinero, Mascotas, Más) por debajo de 768px de ancho.
- Botón flotante (`.fab`, "＋") visible solo en mobile, activo únicamente en Tareas y Stock, y solo para admin.
- A partir de `min-width:768px` (breakpoint único, `@media(min-width:768px)`): la navegación pasa a sidebar izquierdo fijo, aparecen botones de acción "de escritorio" (`.dbtn`, ocultos en mobile) para agregar tareas/ítems, el grid de KPIs pasa a 4 columnas, y ciertos paneles (dashboard, stock, fotos, pronóstico) pasan a grillas de 2 o más columnas.
- **Hallazgo de código a verificar**: la regla CSS de `.ni-hidden` dentro del media query de escritorio está mal cerrada (`.ni-icon{font-size:17px .ni-hidden{display:flex!important}}`, ver `index.html` líneas 237-238) — es sintácticamente sospechosa (bloque anidado no válido en CSS plano). No se verificó en navegador; se deja como duda para la etapa de reconstrucción del frontend (ver `docs/ARCHITECTURE.md`, sección de problemas).

## 6. Dependencias externas

| Dependencia | Uso | Dónde |
|---|---|---|
| Google Fonts (`fonts.googleapis.com`) | Tipografías Fraunces (serif, títulos) y Karla (sans, cuerpo) | `<link>` en `<head>` |
| **Supabase** (proyecto `REDACTED_SUPABASE_PROJECT_REF`) | Base de datos y API REST únicas del prototipo; toda lectura/escritura pasa por ahí desde el navegador | Variables `SB_URL`/`SB_KEY`, funciones `sbFetch`/`sbGet`/`sbPost`/`sbPatch`/`sbDel`/`sbUpsert` |
| **Open-Meteo** (`api.open-meteo.com`) | Clima actual y pronóstico 5 días para lat/lon fijas de Villa Elisa, Entre Ríos (-32.15, -58.40) | `fetchClima()` |
| Ninguna librería de UI/estado (sin React, sin jQuery, sin bundler) | Todo el DOM se genera con concatenación de strings + `innerHTML` | Todo el `<script>` |

No hay `package.json`, `node_modules`, build step, linter ni test runner en el proyecto actual: es un único archivo estático.

## 7. Estado actual del prototipo

- Un solo archivo `index.html` de ~220 KB / 4206 líneas: `<style>` + marcado + `<script>` en el mismo documento.
- Sin control de versiones inicial en el proyecto (se detectó `git` no inicializado en este directorio al comenzar la auditoría).
- Persistencia real en Supabase Postgres (no es un mock ni localStorage-only); la sesión de usuario (rol + persona) sí vive solo en `sessionStorage` del navegador.
- Hay **funciones duplicadas**: 13 funciones (`togTarea`, `delTarea`, `gTarea`, `gItem`, `deltaS`, `togPers`, `gPersona`, `delFoto`, `delEv`, `gEvento`, `gFoto`, `addNov`, `gAjuste`) están definidas dos veces en el archivo. En JavaScript, la segunda definición sobrescribe a la primera, por lo que las primeras versiones (que solo tocaban arrays en memoria) quedan como **código muerto**; las versiones que realmente se ejecutan son las de la sección "REWIRE APP FUNCTIONS TO USE DB" (a partir de la línea ~2006), que sí llaman a Supabase. Esto es relevante para no confundir "cómo se ve que funciona leyendo arriba del archivo" con "cómo funciona en verdad".
- Autenticación y autorización son enteramente del lado del cliente (ver `docs/SECURITY.md`).
- No hay integración con Google Drive todavía; las fotos se guardan como `data:` URL (base64) directamente en la tabla `fotos` de Supabase.

## 8. Arquitectura futura prevista

La reconstrucción prevista (no iniciada) es:

- **Frontend:** React + TypeScript + Vite → desplegado en **Netlify**.
- **Backend:** Node.js + TypeScript + Express → desplegado en **Render**.
- **ORM:** Prisma.
- **Base de datos:** PostgreSQL en **Neon**.
- **Fotografías:** Neon Object Storage (interfaz compatible con S3, buckets privados separados por rama/entorno), integrado *a través del backend* (el frontend nunca sube directo al almacenamiento ni a la base de datos). **Actualización**: reemplaza a Google Drive, evaluado inicialmente y descartado antes de conectar Neon — ver `docs/ARCHITECTURE.md`, "Object Storage".

El diseño visual actual (paleta de colores en `:root`, tipografías, layout de cards/chips/navegación) se conserva; el objetivo de la reconstrucción es de arquitectura y seguridad, no estético. Ver `docs/ARCHITECTURE.md` y `docs/MIGRATION_PLAN.md` para el detalle etapa por etapa.
