# ARCHITECTURE.md — Arquitectura actual y objetivo

> Este documento describe arquitectura únicamente. No se implementa nada de lo aquí propuesto en esta etapa.

## 1. Arquitectura actual

```
┌─────────────────────────────────────────────┐
│              Navegador del usuario           │
│  ┌─────────────────────────────────────────┐ │
│  │  index.html (HTML + CSS + JS, un solo   │ │
│  │  archivo, ~4200 líneas, sin build)      │ │
│  │                                          │ │
│  │  - Render 100% client-side (innerHTML)  │ │
│  │  - Estado en variables globales (arrays)│ │
│  │  - Auth: PIN comparado en JS             │ │
│  │  - Sesión: sessionStorage                │ │
│  └──────────────────┬───────────────────────┘ │
└─────────────────────┼─────────────────────────┘
                       │ fetch() directo, con
                       │ SB_URL + SB_KEY hardcodeados
                       ▼
          ┌─────────────────────────┐
          │   Supabase (Postgres +  │
          │   REST API autogenerada)│
          │   Proyecto:              │
          │   REDACTED_SUPABASE_PROJECT_REF   │
          └─────────────────────────┘

          ┌─────────────────────────┐
          │  Open-Meteo API (clima) │
          │  llamada directa, sin   │
          │  key                     │
          └─────────────────────────┘
```

- No existe capa de backend propia. El navegador es cliente directo de la base de datos.
- No existe build ni empaquetado: se sirve el HTML tal cual (no se identificó configuración de hosting en el proyecto — el archivo simplemente existe en el filesystem local al momento de esta auditoría).
- El "estado de la aplicación" vive en variables globales de JS (`personas`, `tareas`, `sCasa`, `sJardin`, etc.), hidratadas al cargar desde Supabase y mutadas de forma optimista en cada acción, con un `fetch` en paralelo hacia Supabase para persistir.
- La UI se re-renderiza llamando funciones `rndXxx()` que regeneran `innerHTML` de contenedores específicos — no hay virtual DOM ni framework reactivo.

## 2. Problemas actuales

Ordenados por impacto, todos verificados por lectura estática del código (no se realizaron pruebas contra servicios externos):

1. **Credenciales de base de datos embebidas en el cliente.** `SB_URL` y `SB_KEY` (anon key JWT de Supabase) están hardcodeadas en el HTML servido al navegador (línea 1701-1702). La key es de tipo `anon`, pensada para ser pública *si* hay Row Level Security bien configurado del lado de Supabase — pero eso no es verificable desde el HTML, y el diseño actual de la app (permisos solo en JS del cliente) sugiere que probablemente no hay RLS granular por rol. Ver `docs/SECURITY.md`.
2. **Autorización 100% client-side.** `isAdmin()` es una simple comparación de una variable JS (`currentRole === 'admin'`). Cualquier persona con acceso a las herramientas de desarrollador del navegador puede otorgarse permisos de administrador sin conocer el PIN, y puede ejecutar directamente cualquier `fetch` contra la API de Supabase con la key embebida, sin pasar por la UI.
3. **PIN como único mecanismo de autenticación**, de 4 dígitos, sin límite de intentos, sin bloqueo temporal, comparado en texto plano contra un valor traído de la tabla `pines`. No hay usuarios con contraseña, ni hashing, ni expiración de sesión más allá del cierre de la pestaña/navegador.
4. **Sin backend, sin validación de servidor.** Toda validación (campos requeridos, formatos, rangos) ocurre en JS del cliente y es trivialmente evitable llamando la API REST de Supabase directamente.
5. **Funciones duplicadas / código muerto.** 13 funciones están definidas dos veces (ver `docs/PROJECT_CONTEXT.md` sección 7); la primera definición de cada una queda inutilizada porque JavaScript usa la última declaración. Esto dificulta el mantenimiento y es una fuente de errores al portar lógica a la nueva arquitectura (riesgo de portar por error la versión "muerta").
6. **Lógica de negocio rota sin errores visibles.** El módulo de Desempeño depende de un campo `t.activa` que nunca se setea (ver `docs/BUSINESS_RULES.md` sección 6) — el cumplimiento por persona siempre da 0% y las rachas nunca se muestran, sin que la UI lo señale como error.
7. **Referencia a variable no declarada.** `rndGallHistorial()` usa `DIAS_ES`, que no existe en el archivo (ver `docs/BUSINESS_RULES.md` sección 9) — riesgo de excepción en tiempo de ejecución al ver el historial del gallinero.
8. **Regla CSS potencialmente mal formada** en el media query de escritorio (línea 237-238: `.ni-icon{font-size:17px  .ni-hidden{display:flex!important}}`), sin cierre de llave correcto antes de la regla anidada — a confirmar visualmente en la reconstrucción, no verificable de forma estática con certeza total.
9. **Variable CSS `--crema` usada pero nunca definida** en `:root` (8 usos, ver búsqueda en el código) — esos fondos no tienen el color esperado.
10. **Inconsistencia de permisos**: eliminar fotos está disponible para cualquier usuario logueado, no solo admin, a diferencia del resto de las operaciones de borrado.
11. **Sin control de concurrencia en stock.** Las actualizaciones de `stock` son lecturas del estado en memoria + `PATCH` con el nuevo valor absoluto; si dos personas ajustan el mismo ítem casi al mismo tiempo, la segunda escritura pisa a la primera sin merge ni bloqueo optimista (no hay columna de versión ni `updated_at` comparado antes de escribir).
12. **XSS por `innerHTML` sin sanitizar.** Prácticamente toda la UI se construye concatenando valores de datos (nombres, descripciones de tareas, texto de novedades, notas, motivos de consumo) directamente en strings de HTML insertados vía `innerHTML`, sin escapar. Ver `docs/SECURITY.md` para el detalle y el riesgo.
13. **Fotos como base64 en la base de datos**, sin límite de tamaño ni compresión — impacto en tamaño de fila/tabla y en el tiempo de carga de la galería a medida que crece.
14. **Semilla de datos incompleta.** `seedData()` solo siembra personas, tareas y stock; deja fuera categorías, tipos de mascota, destinos, novedades y eventos iniciales (ver `docs/DATA_INVENTORY.md` sección 15) — si se reinicia la base sin más, el resto de los catálogos queda vacío sin aviso.
15. **Sin manejo de errores consistente hacia el usuario.** Algunas operaciones muestran `alert()` con el mensaje crudo de error (`e.message`), otras solo hacen `console.error`/`console.warn` en silencio (p. ej. fallas al cargar gallinero, mascotas, empleados, consumos, categorías) — el usuario puede quedarse con una vista incompleta sin saber que algo falló.

## 3. Arquitectura objetivo

```
┌──────────────────────┐      HTTPS       ┌───────────────────────┐
│  Frontend (Netlify)   │ ───────────────▶ │  Backend (Render)      │
│  React + TS + Vite    │ ◀─────────────── │  Node.js + TS + Express│
│  - UI (mismo diseño)  │      JSON API    │  - Auth (sesión/JWT)   │
│  - Sin credenciales   │                  │  - Autorización real   │
│    de base de datos   │                  │    por rol (ADMIN/     │
└──────────────────────┘                  │    EMPLOYEE)           │
                                            │  - Validación de datos │
                                            │  - Auditoría de cambios│
                                            └──────────┬─────────────┘
                                                        │ Prisma
                                                        ▼
                                            ┌───────────────────────┐
                                            │  PostgreSQL (Neon)     │
                                            └───────────────────────┘
                                                        │
                                            ┌───────────────────────┐
                                            │  Google Drive API      │
                                            │  (vía backend, con     │
                                            │  credenciales server-  │
                                            │  side, nunca en el     │
                                            │  cliente)              │
                                            └───────────────────────┘
```

Principios que rigen esta arquitectura objetivo:

- **El frontend nunca tiene credenciales de base de datos ni de Google Drive.** Todo acceso a datos pasa por endpoints del backend.
- **El backend es la única fuente de verdad de autorización.** El rol (`ADMIN` / `EMPLOYEE`) se valida en cada request del lado del servidor, no solo se oculta un botón en el cliente.
- **Prisma como capa de acceso a datos**, con el esquema como fuente de verdad del modelo (ver `docs/DATABASE.md` para la propuesta preliminar).
- **El diseño visual se preserva**: la reconstrucción en React replica la paleta, tipografías y estructura de pantallas de `index.html`, no las rediseña.

## 4. Separación frontend / backend / base de datos

- **Frontend (Netlify)**: solo presentación y consumo de la API del backend vía HTTPS. No contiene ningún secreto. Se comunica con el backend mediante una URL de API configurada por variable de entorno de build (p. ej. `VITE_API_URL`).
- **Backend (Render)**: dueño de toda la lógica de negocio (cálculo de períodos, estados de stock, desempeño, etc. — hoy vive en el cliente y debe migrar al servidor), de la autenticación/autorización, de la integración con Google Drive, y del acceso a Postgres vía Prisma.
- **Base de datos (Neon)**: solo accesible desde el backend (connection string en variable de entorno del backend, nunca expuesta al navegador).

## 5. Estrategia de autenticación (a definir en detalle en su propia etapa)

Puntos que la migración debe resolver — **no se decide en este documento**, se documenta como pendiente:

- Reemplazar el PIN comparado en el cliente por un endpoint de login en el backend que valide el PIN (o el mecanismo que se decida) contra la base y emita una sesión (cookie httpOnly + servidor con estado, o JWT firmado por el servidor).
- Definir si se mantiene el modelo "PIN de 4 dígitos por persona + PIN de admin compartido" o se reemplaza por credenciales por persona con rol propio (recomendado para trazabilidad — hoy, como se documentó en `docs/BUSINESS_RULES.md` sección 4, un login como "Administrador" sin persona asociada no deja registro de qué individuo actuó).
- Definir política de intentos fallidos / bloqueo, ausente en el prototipo actual.

## 6. Sesiones persistentes

- El prototipo usa `sessionStorage` (se pierde al cerrar el navegador). La arquitectura objetivo debe decidir, en su propia etapa, si usa cookies de sesión httpOnly con expiración configurable (recomendado, evita exposición a robo de token vía XSS) o JWT de corta duración con refresh — pendiente de definición explícita, no se resuelve en esta auditoría.

## 7. Roles `ADMIN` y `EMPLOYEE`

- Mapeo directo de los roles actuales (`admin` → `ADMIN`, `user`/"equipo de trabajo" → `EMPLOYEE`).
- A diferencia del prototipo, el backend debe rechazar en el servidor cualquier operación admin-only intentada por un `EMPLOYEE`, independientemente de lo que el cliente envíe u oculte visualmente.
- Ver `docs/BUSINESS_RULES.md` sección 1 para el detalle completo de qué operaciones son hoy admin-only en la UI (deben serlo también en el backend) y la inconsistencia detectada en fotos (a resolver como decisión de producto: ¿se mantiene abierto a todos, o se restringe a admin en la reconstrucción?).

## 8. Auditoría

- El prototipo actual **no tiene una tabla de auditoría genérica**. Lo más cercano es el campo `compPid`/`completado_por` + `nota` en `ejecuciones` (quién completó una tarea de otra persona) y el registro automático de "ajustes" de stock como filas de `consumos` con motivo prefijado (`docs/BUSINESS_RULES.md` sección 8).
- La arquitectura objetivo debe definir, en su propia etapa, si se agrega una tabla de auditoría transversal (quién hizo qué, cuándo, sobre qué entidad) — no existe en el prototipo, por lo que es una decisión nueva, no una migración de algo existente.

## 9. Integración con Google Drive

- No implementada en el prototipo (las fotos son base64 en Postgres/Supabase).
- En la arquitectura objetivo: el backend recibe el archivo del frontend, lo sube a Google Drive usando credenciales de servicio (nunca expuestas al cliente), y guarda en Postgres solo la referencia (ID de archivo de Drive / URL) — patrón a definir en detalle en la etapa correspondiente de `docs/MIGRATION_PLAN.md`.

## 10. Variables de entorno

Implementado y verificado en la Etapa 1 (no es solo un plan): hay un único `.env.example` centralizado en la raíz del monorepo (`docs/PROJECT_CONTEXT.md` y `README.md` tienen el detalle completo por variable). Cada servicio lee las suyas y **ninguno depende de que exista un archivo `.env` físico en producción**:

| Servicio | Variables que usa hoy | Origen en producción |
|---|---|---|
| Backend (Render) | `NODE_ENV`, `PORT`, `FRONTEND_URL` (activas); `DATABASE_URL`, `JWT_*`, `GOOGLE_*` (previstas, opcionales todavía) | Variables de entorno configuradas en el dashboard de Render para ese servicio — inyectadas directamente en `process.env` del proceso Node, sin ningún archivo |
| Frontend (Netlify) | `VITE_API_URL` (única variable pública prevista en esta etapa) | Variable de entorno configurada en el dashboard de Netlify (Site settings → Environment variables) para ese sitio, inyectada en `process.env` durante el paso de build |

**Por qué esto funciona sin un `.env` en producción — comprobado, no solo asumido:**

- `dotenv` (backend, `backend/src/config/index.ts`) y `loadEnv` de Vite (frontend) dan prioridad a las variables ya presentes en `process.env` por sobre cualquier `.env` de archivo — así funcionan por diseño ambas librerías. Como el repositorio nunca commitea un `.env` real (`.gitignore`), en Netlify y Render simplemente no hay archivo que leer: `dotenv.config()` no encuentra el archivo, no lanza error, y no pisa nada — el proceso sigue con lo que la plataforma ya inyectó en `process.env`.
- El backend valida con Zod únicamente `NODE_ENV`, `PORT`, `FRONTEND_URL` y las variables previstas — **nunca lee ni declara ninguna variable `VITE_*`**. Verificado con un test dedicado (`backend/src/test/env.test.ts`): si por algún motivo una variable `VITE_*` llegara a estar presente en el entorno del proceso backend, el schema la descarta silenciosamente (Zod no incluye claves no declaradas en el resultado).
- El frontend, por diseño de Vite, solo expone al bundle del cliente las variables con prefijo `VITE_` (`envPrefix` por defecto) — cualquier variable del backend (`DATABASE_URL`, `JWT_ACCESS_SECRET`, etc.) nunca llega a `import.meta.env` ni al código empaquetado, aunque estuviera presente en el entorno de build. `VITE_API_URL` es la única variable con ese prefijo en `.env.example`.
- Verificado empíricamente sobre el build real (`frontend/dist`): ninguna cadena de las variables previstas para el backend (secretos, URLs internas) aparece en el bundle compilado.

**Configuración esperada al desplegar** (no ejecutada en esta etapa, es la referencia para cuando se despliegue):

- **Netlify**: "Base directory" = `frontend`, build command = `npm run build` (o el equivalente desde la raíz apuntando al workspace), "Publish directory" = `frontend/dist`. Variable a configurar: `VITE_API_URL` apuntando a la URL pública del backend en Render (con el prefijo `/api/v1`).
- **Render**: "Root Directory" = `backend`, build command = `npm run build` (o `npm install && npm run build` según el runner), start command = `npm run start`. Variables a configurar: `NODE_ENV=production`, `PORT` (Render suele inyectar el suyo propio y esperar que la app lo respete — `config.port` ya lee `process.env.PORT`), `FRONTEND_URL` apuntando a la URL pública del sitio en Netlify, y las de Neon/JWT/Google Drive cuando correspondan en sus etapas.
- Ambas plataformas clonan el repositorio completo (el monorepo entero), no solo el subdirectorio configurado como base/root — por eso `envDir: '../'` (frontend) y `resolve(process.cwd(), '../.env')` (backend) siguen apuntando a una ruta válida dentro del checkout en ambos casos, aunque ahí no encuentren ningún `.env` (y no lo necesitan). Esta afirmación se basa en el comportamiento estándar documentado de ambas plataformas para monorepos; no se validó contra una cuenta real de Netlify/Render en esta etapa porque no se realizó ningún despliegue.

## 11. Despliegue

- **Frontend** → Netlify, build de Vite. Ver configuración esperada en la sección 10.
- **Backend** → Render, servicio Node/Express. Ver configuración esperada en la sección 10.
- **Base de datos** → Neon (Postgres administrado).
- No se realizó ningún despliegue real en esta etapa — la configuración de la sección 10 es la referencia para cuando corresponda, no una confirmación de que ya se desplegó.
