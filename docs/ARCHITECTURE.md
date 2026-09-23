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
          │   Proyecto original     │
          │   (identificador y key   │
          │   retirados del repo —  │
          │   ver docs/SECURITY.md) │
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
                                            │  Neon Object Storage   │
                                            │  (bucket privado,      │
                                            │  interfaz S3, vía      │
                                            │  backend, credenciales │
                                            │  server-side, nunca en │
                                            │  el cliente)            │
                                            └───────────────────────┘
```

Principios que rigen esta arquitectura objetivo:

- **El frontend nunca tiene credenciales de base de datos ni de Object Storage.** Todo acceso a datos pasa por endpoints del backend.
- **El backend es la única fuente de verdad de autorización.** El rol (`ADMIN` / `EMPLOYEE`) se valida en cada request del lado del servidor, no solo se oculta un botón en el cliente.
- **Prisma como capa de acceso a datos**, con el esquema como fuente de verdad del modelo (ver `docs/DATABASE.md` para la propuesta preliminar).
- **El diseño visual se preserva**: la reconstrucción en React replica la paleta, tipografías y estructura de pantallas de `index.html`, no las rediseña.

## 4. Separación frontend / backend / base de datos

- **Frontend (Netlify)**: solo presentación y consumo de la API del backend vía HTTPS. No contiene ningún secreto. Se comunica con el backend mediante una URL de API configurada por variable de entorno de build (p. ej. `VITE_API_URL`).
- **Backend (Render)**: dueño de toda la lógica de negocio (cálculo de períodos, estados de stock, desempeño, etc. — hoy vive en el cliente y debe migrar al servidor), de la autenticación/autorización, de la integración con Neon Object Storage, y del acceso a Postgres vía Prisma.
- **Base de datos (Neon)**: solo accesible desde el backend (connection string en variable de entorno del backend, nunca expuesta al navegador).

## 5. Estrategia de autenticación (a definir en detalle en su propia etapa)

Puntos que la migración debe resolver — **no se decide en este documento**, se documenta como pendiente:

- Reemplazar el PIN comparado en el cliente por un endpoint de login en el backend que valide el PIN (o el mecanismo que se decida) contra la base y emita una sesión (cookie httpOnly + servidor con estado, o JWT firmado por el servidor).
- Definir si se mantiene el modelo "PIN de 4 dígitos por persona + PIN de admin compartido" o se reemplaza por credenciales por persona con rol propio (recomendado para trazabilidad — hoy, como se documentó en `docs/BUSINESS_RULES.md` sección 4, un login como "Administrador" sin persona asociada no deja registro de qué individuo actuó).
- Definir política de intentos fallidos / bloqueo, ausente en el prototipo actual.

**Actualización Etapa 2**: el modelo de datos que soporta esto ya existe (`User.passwordHash`, `User.status`, `Session`). Se confirmó (decisión del usuario) que `User` y `Employee` son entidades separadas con relación explícita — ver `docs/DATABASE.md`, "Separación User/Employee". Los 4 empleados reales ya tienen su `User` correspondiente sembrado en `status: PENDING_ACTIVATION`, sin contraseña ni PIN — no pueden autenticarse hasta que un `ADMIN` los active vía `POST /api/v1/admin/users/:id/activate`.

**Actualización Etapa 3B.1**: implementado — login por contraseña (Argon2id), autorización por rol validada en el servidor contra la base (nunca solo contra el claim del JWT), y activación/gestión de usuarios como se describe arriba. Detalle completo en la sección 14.

## 6. Sesiones persistentes

- El prototipo usa `sessionStorage` (se pierde al cerrar el navegador). La arquitectura objetivo debe decidir, en su propia etapa, si usa cookies de sesión httpOnly con expiración configurable (recomendado, evita exposición a robo de token vía XSS) o JWT de corta duración con refresh — pendiente de definición explícita, no se resuelve en esta auditoría.
- **Actualización Etapa 2**: el modelo `Session` ya existe en el schema (`refreshTokenHash` — nunca el token en texto plano —, `expiresAt`, `revokedAt` nullable para revocación sin borrado físico, `ipAddress`, `userAgent`). Sin filas sembradas ni lógica de emisión/validación todavía.
- **Actualización Etapa 3B.1**: decisión tomada — JWT de corta duración (access token) + refresh token opaco persistido como `Session`, con rotación en cada uso. Detalle completo en la sección 14.

## 7. Roles `ADMIN` y `EMPLOYEE`

- Mapeo directo de los roles actuales (`admin` → `ADMIN`, `user`/"equipo de trabajo" → `EMPLOYEE`).
- A diferencia del prototipo, el backend debe rechazar en el servidor cualquier operación admin-only intentada por un `EMPLOYEE`, independientemente de lo que el cliente envíe u oculte visualmente.
- Ver `docs/BUSINESS_RULES.md` sección 1 para el detalle completo de qué operaciones son hoy admin-only en la UI (deben serlo también en el backend) y la inconsistencia detectada en fotos (a resolver como decisión de producto: ¿se mantiene abierto a todos, o se restringe a admin en la reconstrucción?).
- **Actualización Etapa 2**: confirmado — la eliminación de fotografías (`FileAsset`) será exclusiva de `ADMIN` en las etapas de implementación de endpoints (Etapa 5 en adelante), no abierta a todo `EMPLOYEE` como en el prototipo.

## 8. Auditoría

- El prototipo actual **no tiene una tabla de auditoría genérica**. Lo más cercano es el campo `compPid`/`completado_por` + `nota` en `ejecuciones` (quién completó una tarea de otra persona) y el registro automático de "ajustes" de stock como filas de `consumos` con motivo prefijado (`docs/BUSINESS_RULES.md` sección 8).
- La arquitectura objetivo debe definir, en su propia etapa, si se agrega una tabla de auditoría transversal (quién hizo qué, cuándo, sobre qué entidad) — no existe en el prototipo, por lo que es una decisión nueva, no una migración de algo existente.
- **Actualización Etapa 2**: se agregó `AuditLog` (actor, `action` como texto libre —no enum, ver justificación en `docs/DATABASE.md`—, `entityType`/`entityId`, `previousState`/`newState` en JSON, IP, user-agent, timestamp). Sin filas sembradas ni lógica de escritura todavía — eso corresponde a cuando se implementen los servicios que modifican datos (Etapa 5).
- **Actualización Etapa 3B.1**: primera lógica de escritura real sobre `AuditLog` — todas las acciones de autenticación (login exitoso/fallido, refresh, detección de reuso de refresh token, logout, activación, cambio de estado, reset de contraseña, bootstrap del admin) quedan auditadas. `previousState`/`newState` nunca incluyen contraseñas ni tokens. Detalle en la sección 14.

## 9. Object Storage — fotografías y archivos

> **Decisión definitiva (revisión previa a conectar Neon)**: Neon Object Storage privado reemplaza a Google Drive como almacenamiento de fotografías y archivos. Google Drive fue la integración prevista originalmente (ver historial más abajo) y se descartó antes de implementar ninguna subida real, porque el mismo proyecto de Neon que aloja Postgres también ofrece Object Storage con interfaz compatible con S3 — evita depender de un proveedor externo adicional y de una segunda cuenta de credenciales de servicio.

- No implementado en el prototipo (las fotos son base64 en Postgres/Supabase).
- **Historial**: la arquitectura objetivo original (Etapa 0-2) prevía Google Drive vía backend con credenciales de servicio. Se evaluó y se descartó en esta revisión — ninguna instrucción activa de este documento propone Google Drive; se deja esta mención solo por trazabilidad.

### 9.1 Proveedor y modelo de datos

- `FileAsset.provider` es un enum (`FileProvider`) con un único valor hoy: `NEON_OBJECT_STORAGE`. Se prefiere este nombre explícito a uno genérico (`S3`) porque el proyecto usa exactamente un proveedor S3-compatible concreto (el de Neon) — un valor genérico sugeriría un soporte multi-proveedor que no existe.
- La identificación técnica principal de un archivo es **`bucket + objectKey`** (no un ID externo de Drive) — `FileAsset` tiene una restricción única compuesta `@@unique([bucket, objectKey])` que impide registrar dos veces el mismo objeto dentro del mismo bucket.
- Metadatos que sí se persisten: `originalFilename`, `mimeType`, `sizeBytes`, `checksum` (opcional), `etag` (opcional, devuelto por el proveedor al confirmar la subida), `category`, `status` (ver `FileStatus` más abajo), vínculos opcionales (`taskId`/`animalId`, mutuamente excluyentes), `uploadedByEmployeeId`, `taggedEmployeeId`, `deletedAt`.
- **Lo que nunca se persiste en `FileAsset`**: URL pública, URL temporal firmada, credenciales del proveedor, contenido base64, binarios, ni rutas locales. Las URLs de acceso se generan en el backend bajo demanda, en la etapa del módulo de fotografías — nunca como verdad permanente en la base.
- Detalle completo de cada campo, comentado en el propio schema — ver `backend/prisma/schema.prisma` y `docs/DATABASE.md`.

### 9.2 Estrategia de object keys (documentada, no implementada)

Ejemplos conceptuales de forma de clave, a definir en detalle en la etapa del módulo de fotografías:

```text
tasks/{taskId}/{uuid}.webp
animals/{animalId}/{uuid}.webp
memories/{year}/{uuid}.webp
thumbnails/{assetId}/{size}.webp
```

Reglas que la generación futura de `objectKey` debe respetar:

- Nunca depender del nombre original del archivo.
- Nunca incluir datos personales innecesarios en la clave.
- Nunca usar un nombre provisto por el usuario como ruta directa (riesgo de path traversal).
- Usar un UUID generado por el backend para evitar colisiones.
- Mantener una extensión coherente con el contenido ya procesado (no con la extensión que declare el cliente).
- No reutilizar una `objectKey` que ya fue eliminada.

### 9.3 Buckets y ambientes

El proyecto de Neon aloja Postgres y Object Storage en el mismo proyecto, con dos ramas:

| Entorno | Rama de Neon | Bucket | Acceso | Quién lo usa |
|---|---|---|---|---|
| Desarrollo | `demo` | `la-canada-uploads` | Privado | Backend local (únicamente) |
| Producción | `production` | `la-canada-uploads` | Privado | Render (únicamente) |

- Aunque el nombre del bucket sea igual en ambos entornos, son **buckets separados** con credenciales específicas de cada rama — nunca se asume que un archivo o una credencial de un entorno sirve en el otro.
- El backend local utiliza únicamente `demo`. Render utiliza únicamente `production`. No hay una tercera variante mixta.
- **Netlify (frontend) nunca recibe credenciales de almacenamiento**, en ninguno de los dos entornos.
- Functions, AI Gateway y Neon Auth quedan desactivados en el proyecto de Neon — no forman parte de esta arquitectura.

### 9.4 Flujo de escritura (a implementar en la etapa del módulo de fotografías)

```text
Frontend
   ↓ archivo
Backend Node.js
   ↓ valida tipo, tamaño y permisos
Procesamiento de imagen
   ↓ optimiza y genera metadatos
Neon Object Storage privado
   ↓ bucket + objectKey
PostgreSQL / FileAsset
```

### 9.5 Flujo de lectura (a implementar en la etapa del módulo de fotografías)

```text
Frontend
   ↓ solicita acceso
Backend valida permisos
   ↓ genera URL temporal firmada o transmite el archivo
Object Storage privado
```

La estrategia exacta entre URL firmada y proxy se decide recién en la etapa del módulo de fotografías — no antes.

### 9.6 Principios de la integración futura

- El backend es el único componente con credenciales de Object Storage; el bucket es siempre privado.
- El frontend no sube directamente al almacenamiento hasta que exista un diseño explícito de URLs presignadas y autorización — no antes.
- El registro en PostgreSQL (`FileAsset`) y la subida al Object Storage deben coordinarse: un fallo parcial (subida sin registro, o registro sin subida confirmada) debe compensarse — de ahí que `FileStatus` incluya estados intermedios (`PENDING_UPLOAD`, `UPLOAD_FAILED`), no solo "activo/eliminado".
- Deben poder detectarse objetos huérfanos (subidos sin `FileAsset` correspondiente, o `FileAsset` sin objeto real).
- La eliminación es lógica primero (`status: PENDING_DELETION`/`DELETED`, `deletedAt`) y física después, mediante un flujo controlado — nunca borrado físico inmediato desde la solicitud del usuario.
- Solo `ADMIN` puede eliminar fotografías (ver sección 7 de este documento).
- Se valida el tipo MIME real del contenido, no solo la extensión o el `accept` del input.
- Se aplican límites de tamaño de archivo.
- Las imágenes se optimizan (compresión/resize) en una etapa futura, no en el primer corte del módulo.
- Nunca se guardan imágenes (binario ni base64) en PostgreSQL.
- **Actualización Etapa 2 / 2.2**: el modelo `FileAsset` ya existe con esta forma (proveedor Neon Object Storage, `bucket`/`objectKey`, nombre original, MIME, tamaño, checksum y ETag opcionales, quién subió, categoría, estado con eliminación lógica de 5 valores). Sin filas sembradas — el prototipo no declara fotos reales — y sin ninguna conexión real a Neon (ni a su Object Storage) todavía.

## 10. Prisma 7 — cambios de configuración respecto a versiones anteriores

Prisma 7 (instalado: `prisma`/`@prisma/client` 7.10.0) cambió dos cosas que afectan directamente cómo está armado `backend/`:

- **`datasource { url = env("DATABASE_URL") }` ya no es válido en `schema.prisma`.** La conexión para comandos de Schema Engine (`migrate`, `db push`, `db seed`) se declara en un archivo nuevo, `backend/prisma.config.ts` (`defineConfig({ schema, migrations: { seed } })`). A propósito **no** se declaró `datasource.url` ahí todavía: `env('DATABASE_URL')` se resuelve de forma *eager* al cargar el archivo, y como `DATABASE_URL` no está seteada en esta etapa, eso rompería incluso comandos que no necesitan base (`validate`, `generate`, `format`). Se agrega cuando corresponda conectar Neon.
- **El generador de cliente por defecto cambió** de `prisma-client-js` a `prisma-client`, que ya no escribe en `node_modules/@prisma/client` sino que genera **código TypeScript fuente** en una carpeta del proyecto (acá, `backend/src/generated/prisma/`, vía `output` en el `generator` block). Ese código se compila con el `tsc` del propio proyecto — por eso `backend/tsconfig.json` incluye esa carpeta, y `backend/tsconfig.build.json` la deja afuera del build de producción solo en el sentido de que ya queda incluida como parte de `src/`. La carpeta generada está en `.gitignore` (se regenera con `prisma generate`, corrido automáticamente por el script `postinstall` de `backend/package.json` después de `npm install`).
- **`PrismaClient` ya no lee la URL de conexión del schema en tiempo de ejecución** — necesita un *driver adapter* explícito. Se eligió `@prisma/adapter-pg` (Postgres genérico, vía `pg`) en vez de `@prisma/adapter-neon` (específico de Neon): es la opción neutral para "PostgreSQL" como decisión ya confirmada, sin comprometerse todavía a las optimizaciones serverless específicas de Neon — se puede reemplazar en la etapa de conexión real si conviene.

## 11. Variables de entorno

Implementado y verificado en la Etapa 1 (no es solo un plan): hay un único `.env.example` centralizado en la raíz del monorepo (`docs/PROJECT_CONTEXT.md` y `README.md` tienen el detalle completo por variable). Cada servicio lee las suyas y **ninguno depende de que exista un archivo `.env` físico en producción**:

| Servicio | Variables que usa hoy | Origen en producción |
|---|---|---|
| Backend (Render) | `NODE_ENV`, `PORT`, `FRONTEND_URL`, `DATABASE_URL`, `JWT_ACCESS_SECRET` (todas obligatorias, misma fuente de verdad en `config/env.ts` — sin cualquiera de ellas el backend no arranca, ver sección 13.7 y 14.2); `DIRECT_URL`, `DATABASE_TARGET` (opcionales, solo scripts locales); `ACCESS_TOKEN_TTL`/`REFRESH_TOKEN_TTL`/`COOKIE_SAME_SITE` (opcionales, con default); `OBJECT_STORAGE_*` (previstas para una etapa futura) | Variables de entorno configuradas en el dashboard de Render para ese servicio — inyectadas directamente en `process.env` del proceso Node, sin ningún archivo |
| Frontend (Netlify) | `VITE_API_URL` (única variable pública prevista en esta etapa) | Variable de entorno configurada en el dashboard de Netlify (Site settings → Environment variables) para ese sitio, inyectada en `process.env` durante el paso de build |

**Por qué esto funciona sin un `.env` en producción — comprobado, no solo asumido:**

- `dotenv` (backend, `backend/src/config/index.ts`) y `loadEnv` de Vite (frontend) dan prioridad a las variables ya presentes en `process.env` por sobre cualquier `.env` de archivo — así funcionan por diseño ambas librerías. Como el repositorio nunca commitea un `.env` real (`.gitignore`), en Netlify y Render simplemente no hay archivo que leer: `dotenv.config()` no encuentra el archivo, no lanza error, y no pisa nada — el proceso sigue con lo que la plataforma ya inyectó en `process.env`.
- El backend valida con Zod únicamente `NODE_ENV`, `PORT`, `FRONTEND_URL` y las variables previstas — **nunca lee ni declara ninguna variable `VITE_*`**. Verificado con un test dedicado (`backend/src/test/env.test.ts`): si por algún motivo una variable `VITE_*` llegara a estar presente en el entorno del proceso backend, el schema la descarta silenciosamente (Zod no incluye claves no declaradas en el resultado).
- El frontend, por diseño de Vite, solo expone al bundle del cliente las variables con prefijo `VITE_` (`envPrefix` por defecto) — cualquier variable del backend (`DATABASE_URL`, `JWT_ACCESS_SECRET`, etc.) nunca llega a `import.meta.env` ni al código empaquetado, aunque estuviera presente en el entorno de build. `VITE_API_URL` es la única variable con ese prefijo en `.env.example`.
- Verificado empíricamente sobre el build real (`frontend/dist`): ninguna cadena de las variables previstas para el backend (secretos, URLs internas) aparece en el bundle compilado.

**Configuración esperada al desplegar** (no ejecutada en esta etapa, es la referencia para cuando se despliegue):

- **Netlify**: "Base directory" = `frontend`, build command = `npm run build` (o el equivalente desde la raíz apuntando al workspace), "Publish directory" = `frontend/dist`. Variable a configurar: `VITE_API_URL` apuntando a la URL pública del backend en Render (con el prefijo `/api/v1`).
- **Render**: "Root Directory" = `backend`, build command = `npm run build` (o `npm install && npm run build` según el runner), start command = `npm run start`. Variables a configurar: `NODE_ENV=production`, `PORT` (Render suele inyectar el suyo propio y esperar que la app lo respete — `config.port` ya lee `process.env.PORT`), `FRONTEND_URL` apuntando a la URL pública del sitio en Netlify, y las de Neon/JWT/`OBJECT_STORAGE_*` (rama `production` del proyecto de Neon — ver sección 9.3) cuando correspondan en sus etapas.
- Ambas plataformas clonan el repositorio completo (el monorepo entero), no solo el subdirectorio configurado como base/root — por eso `envDir: '../'` (frontend) y `resolve(process.cwd(), '../.env')` (backend) siguen apuntando a una ruta válida dentro del checkout en ambos casos, aunque ahí no encuentren ningún `.env` (y no lo necesitan). Esta afirmación se basa en el comportamiento estándar documentado de ambas plataformas para monorepos; no se validó contra una cuenta real de Netlify/Render en esta etapa porque no se realizó ningún despliegue.

## 12. Despliegue

- **Frontend** → Netlify, build de Vite. Ver configuración esperada en la sección 10.
- **Backend** → Render, servicio Node/Express. Ver configuración esperada en la sección 10.
- **Base de datos y Object Storage** → Neon (Postgres administrado + Object Storage privado, mismo proyecto, ramas `demo`/`production` — ver sección 9.3). Functions, AI Gateway y Neon Auth quedan desactivados.
- No se realizó ningún despliegue real en esta etapa — la configuración de la sección 10 es la referencia para cuando corresponda, no una confirmación de que ya se desplegó.

## 13. Neon — conexión, migraciones y seed (Etapa 3A)

Primera conexión real del proyecto a Neon — exclusivamente contra la rama `demo`, exclusivamente para desarrollo local. `production` no se toca en esta etapa (ni en ninguna etapa hasta que se autorice explícitamente el despliegue — ver sección 12).

### 13.1 Dos conexiones, dos propósitos — nunca intercambiables

| Variable | Tipo de conexión | Quién la usa | Nunca la usa |
|---|---|---|---|
| `DATABASE_URL` | Pooled (host con `-pooler`) | Runtime de la app (`backend/src/lib/prisma.ts`, cliente único) y el seed (`backend/prisma/seed.ts`) | Prisma Migrate |
| `DIRECT_URL` | Directa (mismo host, sin `-pooler`) | Prisma Migrate exclusivamente (`backend/prisma.config.ts`, `datasource.url`) | El runtime de la app |

Las migraciones no deben correr a través del pooler de Neon (PgBouncer en modo transacción no soporta bien ciertas operaciones de DDL/advisory locks que el Schema Engine necesita) — de ahí la separación. `backend/prisma.config.ts` carga el `.env` de la raíz explícitamente (la CLI de Prisma 7 ya no lo hace de forma automática para un `.env` fuera del directorio de `backend/`), y arma `datasource.url` de forma **condicional**: solo lo agrega si `DIRECT_URL` está presente, sin inventar ninguna URL de reemplazo — ver 13.7 para el detalle de por qué (esto corrige una regresión de la Etapa 3A que rompía `format`/`validate`/`generate` sin `.env`).

### 13.2 Cliente Prisma único (`backend/src/lib/prisma.ts`)

- `createPrismaClient(databaseUrl)` — fábrica pura, testeada con valores sintéticos (`backend/src/test/prisma-client-factory.test.ts`), que lanza un error claro (sin revelar ningún valor) si `DATABASE_URL` falta.
- `export const prisma` — instancia única a nivel de módulo, vía `@prisma/adapter-pg`. Ningún servicio debe crear su propio `PrismaClient` — verificado con un test estático que falla si aparece más de un `new PrismaClient(` fuera de `src/generated` (`backend/src/test/prisma-client-static.test.ts`).
- `disconnectPrisma()` — invocado desde el apagado ordenado del servidor (`server.ts`, junto con `server.close()`). Ningún endpoint usa el cliente todavía (eso es de la Etapa 5); el cierre ya queda contemplado para cuando lo hagan.
- Sin dependencias nuevas: `@prisma/adapter-pg` y `pg` ya estaban instaladas desde la Etapa 2.

### 13.3 Comprobación de conexión (`npm run db:check`)

Script de solo lectura (`backend/src/scripts/checkDbConnection.ts`) que corre `SELECT 1` contra `DATABASE_URL` y reporta éxito/fallo — no modifica la base, no imprime la connection string ni datos de fila. Pensado para correr manualmente antes de cualquier migración o seed.

### 13.4 Proceso de migración controlado

1. `prisma format` / `prisma validate` / `prisma generate` (sin conexión).
2. `prisma migrate dev --create-only --name <nombre>` (usa `DIRECT_URL`) — genera el SQL sin aplicarlo.
3. Inspección manual completa del SQL generado, comparada contra la matriz de invariantes de `docs/DATABASE.md` — solo se agregan a mano los `CHECK` ya clasificados ahí para enforcement SQL (nunca una simulación incompleta de una regla que cruza tablas).
4. `prisma validate` de nuevo.
5. `prisma migrate deploy` (usa `DIRECT_URL`) — aplica solo migraciones ya creadas y revisadas, sin prompts interactivos, sin `db push`.
6. Verificación posterior: `prisma migrate status` (drift), `_prisma_migrations` sin filas fallidas/revertidas, comparación 1:1 de tablas/enums/PK/FK/índices/checks contra `information_schema`/`pg_constraint`, y prueba de cada `CHECK` con un insert inválido dentro de una transacción con `ROLLBACK` explícito.

Este proceso es idéntico para `demo` y (en su momento, con autorización separada) para `production` — la única diferencia es qué par `DATABASE_URL`/`DIRECT_URL` está configurado en el entorno donde se ejecuta.

### 13.5 Cómo se evita ejecutar accidentalmente contra `production`

- Las credenciales de `demo` viven únicamente en el `.env` local (gitignored, nunca commiteado).
- Las credenciales de `production` nunca deben existir en un archivo local ni en este repositorio — se configuran directamente como variables de entorno en el dashboard de Render, igual que ya se documentó para el resto de las variables (sección 11).
- Ningún script de este proyecto acepta un flag para "elegir" el ambiente: el destino lo determina exclusivamente qué `.env`/variables de entorno están cargadas en el proceso que ejecuta el comando — nunca un argumento de línea de comandos que pueda equivocarse.
- Antes de cualquier migración o seed contra un entorno nuevo, correr primero `npm run db:check` (solo lectura) e inspeccionar manualmente que la base esté vacía de tablas de negocio si se espera que lo esté.
- Neon no expone el nombre de la rama vía SQL estándar — la identificación del entorno depende enteramente de qué credencial se cargó, nunca de una consulta a la base. Ver `docs/MIGRATION_PLAN.md`, "Etapa 3A", para el razonamiento completo usado la primera vez.

### 13.6 Resultado de esta etapa

- Migración `20260922174631_init` aplicada a `demo`: 22 tablas, 11 enums, 23 FK, 41 índices únicos, 5 `CHECK` agregados a mano.
- Seed ejecutado dos veces contra `demo`: 61 entidades maestras + 14 movimientos de apertura = 75 filas, idéntico en ambas corridas (idempotencia confirmada) — detalle completo en `docs/SEED_MANIFEST.md` y `docs/MIGRATION_PLAN.md`.
- Ninguna credencial, real o de ejemplo, quedó documentada con su valor — todas las referencias en esta sección son conceptuales.

### 13.7 Revisión correctiva (antes del merge del PR #1) — `DATABASE_TARGET`, `DATABASE_URL` obligatoria, build offline

Tres problemas detectados en la revisión del PR, corregidos sin tocar el modelo Prisma, la migración ya aplicada ni los datos de `demo`:

**a) Sin barrera ejecutable contra `production`.** La sección 13.5 documentaba la intención ("nunca se toca `production`"), pero ningún código la hacía valer — un `.env` mal configurado podía, en teoría, dejar correr `db:migrate:dev`/`db:migrate:deploy`/`db:seed`/`test:integration` contra cualquier URL cargada. Se agregó `DATABASE_TARGET` (`demo` | `production`, backend-only, nunca `VITE_`) y una guarda (`backend/src/scripts/guardDbCommand.ts`) que corre **antes** de invocar Prisma o abrir cualquier transacción: exige `DATABASE_TARGET=demo`, que la variable requerida esté presente, y que su forma coincida con lo esperado (pooled/direct) — sin revelar nunca su valor. Wireada en los 4 comandos con capacidad de escritura (`db:migrate:dev`, `db:migrate:deploy`, `db:seed`, `test:integration`); `db:check`/`db:migrate:status` quedan sin este gate por ser de solo lectura. No previene una evasión deliberada (editar el código o correr `prisma` a mano) — sí evita que los scripts oficiales actúen por error.

**b) Contradicción de `DATABASE_URL`.** `config/env.ts` la declaraba opcional mientras `lib/prisma.ts` (importado por `server.ts`) fallaba igual si faltaba — dos fuentes de verdad distintas. Se resolvió a favor de una sola: `DATABASE_URL` es ahora **obligatoria** en el schema de Zod (`config/env.ts`), con mensaje claro y sin revelar ningún valor; el backend real falla ahí, temprano, no más adentro en `lib/prisma.ts` (que conserva su propio chequeo como defensa en profundidad, ya no contradictorio). `DIRECT_URL` sigue opcional a propósito: el servidor nunca la necesita para arrancar, solo Prisma Migrate. Los tests unitarios usan un valor sintético (`postgresql://test:test@localhost:5432/test_db`) inyectado por `vitest.config.mts` — nunca se conectan de verdad.

## 14. Autenticación (Etapa 3B.1)

Implementado íntegramente en el backend — sin pantalla de login ni ningún cambio funcional en el frontend. Ver también `docs/SECURITY.md` (amenazas consideradas) y `docs/DATABASE.md` (cambios al modelo `Session`).

### 14.1 Contraseñas

Argon2id (`argon2`, parámetros recomendados por OWASP: `memoryCost=19456` (19 MiB), `timeCost=2`, `parallelism=1`). Política: mínimo 12 caracteres, máximo 128, sin reglas de composición (se prioriza longitud/passphrase sobre "mayúscula+número+símbolo"). El login nunca distingue en su respuesta entre usuario inexistente, contraseña incorrecta o cuenta no `ACTIVE` — siempre el mismo error genérico —, y compara igual contra un hash *dummy* cacheado cuando el usuario no existe o no tiene `passwordHash` todavía, para no filtrar por tiempo de respuesta qué rama del código se ejecutó.

### 14.2 Access token

JWT firmado con HS256 vía `jose` (issuer `la-canada-api`, audience `la-canada-frontend`, ambos verificados en cada validación junto con la firma y la expiración — nunca se acepta `alg: none`). Claims mínimos: `sub` (userId), `sid` (sessionId), `role`, `iat`, `exp` — ningún dato personal. Duración corta, configurable (`ACCESS_TOKEN_TTL`, default 720 s / 12 min).

### 14.3 Refresh token

Opaco (no JWT): 256 bits aleatorios (`crypto.randomBytes(32)`, base64url). Se envía únicamente por cookie `HttpOnly` (`lc_refresh_token`), nunca en el body de la respuesta ni accesible desde JS. En base solo se guarda su hash SHA-256 (`Session.refreshTokenHash`, `@unique`) — nunca el valor original. Rota en cada uso: la sesión vieja se marca `revokedAt`, se crea una fila nueva. Si se reintenta usar un refresh token ya revocado (reuso — indicio de robo), se revocan **todas** las sesiones activas de ese usuario, no solo la reusada — el modelo no rastrea "familias" de tokens, así que cortar todo acceso vigente de la cuenta es la respuesta segura sin agregar campos especulativos nuevos.

Detalle de implementación relevante: la revocación masiva + el audit log de la detección de reuso corren dentro de la misma transacción de Prisma que hace la lectura, y esa transacción **nunca lanza una excepción en su callback** — devuelve un resultado discriminado y recién afuera se decide si hay que rechazar la solicitud. (Lanzar dentro del callback de `$transaction` hace que Prisma revierta todo lo escrito en esa transacción, incluida la revocación de seguridad que se quería persistir — se detectó con un test de integración contra Neon real, no con los tests unitarios, que usan un Prisma en memoria sin semántica real de rollback.)

La revocación de la sesión vieja durante la rotación usa un `updateMany` condicionado (`id` + `revokedAt: null` + vigencia), no un `update` incondicional — protege contra dos solicitudes de refresh concurrentes sobre el mismo token, que de otro modo podrían ambas creer que "ganaron" y emitir cada una un refresh token nuevo. Detalle completo del problema y de la corrección en 14.12.

### 14.4 Sesiones (`Session`)

Se usa el modelo real, sin campos especulativos: `userId`, `refreshTokenHash` (único, indexado), `ipAddress`, `userAgent`, `expiresAt`, `revokedAt` (nullable), `createdAt`. Logout nunca borra filas, solo marca `revokedAt`. Migración `20260923110309_auth_session_security` (índice único en `refresh_token_hash`, índice compuesto `(user_id, revoked_at)` para las consultas de sesiones activas/expiradas) — aplicada solo a `demo`, ver 14.10.

### 14.5 Autorización

`requireAuth` (backend/src/middleware/requireAuth.ts): valida el access token (firma/algoritmo/issuer/audience/expiración vía Zod), y en cada request confirma en base que la sesión existe, no está revocada ni expirada, que **pertenece realmente al usuario del token** (`session.userId === payload.sub` — ver 14.12), y que el usuario existe y está `ACTIVE` — el rol efectivo para autorizar siempre se lee de la base en ese momento, nunca del claim `role` del JWT (que puede quedar desactualizado si un admin cambia el rol/estado de alguien a mitad de la vida del access token). `requireRole(...roles)` se apoya en el resultado de `requireAuth`.

### 14.6 Endpoints

`/api/v1/auth`: `POST /login`, `POST /refresh` (lee el refresh token solo de la cookie, valida `Origin` contra `FRONTEND_URL`), `POST /logout` (ídem, idempotente, nunca revela si el token existía), `GET /me` (requiere access token, nunca devuelve `passwordHash` ni sesiones).

`/api/v1/admin/users` (`ADMIN` únicamente, vía `requireAuth` + `requireRole('ADMIN')`): `GET /` (paginado, filtrable por status/rol), `POST /:id/activate` (solo desde `PENDING_ACTIVATION`), `POST /:id/reset-password` (revoca todas las sesiones activas del usuario), `PATCH /:id/status` (transiciones explícitas — nunca `PENDING_ACTIVATION → ACTIVE` por esta vía, reservado a `/activate` —, con protección de auto-lockout: un admin no puede suspenderse/desactivarse a sí mismo si eso dejara al sistema sin ningún `ADMIN` activo).

### 14.7 Primer administrador

`npm run auth:bootstrap-admin` (`backend/src/scripts/bootstrapAdmin.ts`): núcleo puro `bootstrapAdmin(prisma, input)` + `main()` interactivo (usuario/contraseña por prompt, contraseña oculta vía `@inquirer/prompts` — nunca como argumento de línea de comandos, nunca hardcodeada). Se niega si ya existe un `ADMIN` con status `ACTIVE` (idempotente, seguro ante una segunda corrida), respeta la guarda `DATABASE_TARGET=demo`, y audita la creación sin registrar nunca la contraseña ni su hash en la salida de consola. **No se ejecutó en ningún momento de esta etapa** — solo se construyó y se testeó (unitariamente con un Prisma en memoria, y de forma controlada contra `demo` con limpieza determinística en `backend/src/test/integration/bootstrapAdmin.integration.test.ts`, nunca invocando su `main()`).

### 14.8 Cookies y CSRF

Frontend en Netlify, backend en Render — dominios distintos en esta etapa. CORS restringido a `FRONTEND_URL` con `credentials: true` (nunca `origin: '*'` combinado con credenciales). La cookie del refresh token se configura en un único lugar (`backend/src/config/cookies.ts`) para que su creación y su borrado usen exactamente los mismos atributos (nombre, `path`, `sameSite`, `secure`, `httpOnly`) — `res.clearCookie` los compara y, si no coinciden, la cookie no se borra realmente. `login`/`refresh`/`logout` exigen `Content-Type: application/json`; `refresh`/`logout` además validan el header `Origin` contra `FRONTEND_URL` antes de actuar.

`COOKIE_SAME_SITE` (`lax`\|`strict`\|`none`) es configurable; si se deja vacía, se deriva `none` en producción (dominios cruzados reales) y `lax` en desarrollo local (mismo origen efectivo). La regla dura, verificada con un test dedicado (`deriveSecureFlag`): `SameSite=None` siempre fuerza `Secure=true`, sin excepción — nunca se desactiva esa protección "para que funcione".

**Pendiente, documentado a propósito**: no se decidió todavía si la arquitectura final usa un proxy de Netlify (`_redirects`/Netlify Functions) para que frontend y backend compartan efectivamente el mismo origen público (evitando cookies cross-site del todo), o si se mantienen dominios separados con `SameSite=None; Secure`. Esa decisión queda para cuando se implemente la pantalla de login (fuera del alcance de esta etapa).

### 14.9 Rate limiting, respuestas y auditoría

Límite específico para `/auth/login` y `/auth/refresh` (`createAuthRateLimiter`, más estricto que el límite general de `/api`). Todas las respuestas de `/api/v1/auth`/`/api/v1/admin` llevan `Cache-Control: no-store`. Morgan nunca registra cookies ni el header `Authorization`. Auditoría (`AuditLog`) para: login exitoso/fallido, refresh, detección de reuso, logout, activación, cambio de estado, reset de contraseña, bootstrap del admin — nunca con contraseñas o tokens en `previousState`/`newState`. Un fallo al auditar el camino normal de login/refresh/logout nunca rompe la autenticación (auditoría *best-effort*, fuera de la transacción); en las operaciones administrativas y en la detección de reuso, en cambio, la auditoría es parte del efecto atómico (dentro de la misma transacción que el cambio de estado).

### 14.10 Migración y verificación

`20260923110309_auth_session_security` generada offline (`prisma migrate diff --from-schema <schema.prisma antes del cambio> --to-schema <schema.prisma actual> --script`, comparación pura entre dos archivos, sin base de shadow ni conexión — el flujo interactivo estándar de `migrate dev --create-only` no es viable en este entorno no interactivo cuando hay una advertencia que normalmente pide confirmación), inspeccionada a mano, y aplicada únicamente a `demo` con `prisma migrate deploy` (guardado). Verificado contra Postgres real: los dos índices nuevos existen exactamente como se esperaba, `_prisma_migrations` muestra ambas migraciones aplicadas sin rollback, las 75 filas del seed original y la tabla `sessions` (vacía antes de esta etapa) quedaron intactas.

### 14.11 Tests

Suite unitaria (`backend/src/test/auth/`, corre con `npm test`, nunca contra Neon): política de contraseñas, hash/verificación, tokens (firma/verificación, expiración, secreto/issuer/audience incorrectos, `alg=none`), transiciones de estado, cookies, `authService` (login/refresh/rotación/detección de reuso/logout), `requireAuth`/`requireRole`, `bootstrapAdmin`. Suite de integración (`backend/src/test/integration/`, `npm run test:integration`, guardada por `DATABASE_TARGET=demo`, siempre secuencial — `fileParallelism: false`, porque varios archivos miden conteos globales de filas como línea de base): login/refresh/rotación/detección de reuso/logout reales, activación/reset/cambio de estado/listado reales, e idempotencia real de `bootstrapAdmin` — todo con limpieza determinística, nunca deja usuarios/sesiones/auditorías de prueba, nunca toca las filas del seed real. Fue precisamente esta suite la que encontró el bug descrito en 14.3 (rollback de la detección de reuso) — los tests unitarios, con un Prisma en memoria sin transacciones reales, no podían detectarlo.

### 14.12 Corrección posterior: rotación concurrente, vinculación sesión↔usuario, `JWT_ACCESS_SECRET`

Revisión puntual, sin cambios de schema ni nueva migración, sobre tres puntos encontrados en la implementación de la Etapa 3B.1:

**a) Rotación concurrente del refresh token.** La rotación revocaba la sesión vieja con un `update` incondicional (`WHERE id = X`), no condicionado por su estado. Dos solicitudes de `POST /auth/refresh` con el mismo refresh token, casi simultáneas, podían ambas leer la sesión como "activa" antes de que cualquiera escribiera, y ambas terminar creando una sesión nueva — dos refresh tokens válidos a partir de uno solo. Corregido reemplazando ese `update` por un `updateMany` condicionado (`WHERE id = X AND revokedAt IS NULL AND expiresAt > now()`), y avanzando a crear la sesión nueva solo si `count === 1`. Bajo el nivel de aislamiento por defecto de Postgres (READ COMMITTED) esto ya alcanza como exclusión mutua real: un `UPDATE` toma un lock de fila; una segunda transacción que intente actualizar la misma fila queda bloqueada hasta que la primera confirme, y al desbloquearse Postgres vuelve a evaluar el `WHERE` contra la fila ya committeada — si `revoked_at` ya no es nulo, esa segunda escritura simplemente no afecta ninguna fila. No hace falta `SERIALIZABLE` ni un `SELECT ... FOR UPDATE` explícito. Cuando `count !== 1` (la solicitud perdió la carrera, o directamente llegó tarde y ya la encuentra revocada), se trata igual que un reuso: se revocan conservadoramente todas las sesiones activas del usuario (incluida la que la solicitud ganadora acababa de crear), se audita (`auth.refresh.concurrent_rotation_detected`), y se responde con el mismo error genérico de sesión inválida — nunca se emite un segundo refresh token. Verificado con un test de integración real contra `demo` que lanza dos `refresh()` simultáneos sobre el mismo token (`backend/src/test/integration/auth.integration.test.ts`): en cada corrida gana exactamente uno, la otra solicitud recibe el error, y no queda ninguna sesión activa para ese usuario al terminar — cuál de las dos ramas (la toma atómica o la detección de reuso clásica, si la perdedora llega a leer después de que la ganadora ya confirmó) atrapa a la perdedora depende del timing real de red contra Neon, pero ambas aplican exactamente la misma respuesta de seguridad.

**b) Vinculación estricta sesión↔usuario en `requireAuth`.** El middleware validaba la sesión por `sid` y el usuario por `sub` de forma independiente, sin exigir que `session.userId === payload.sub`. Un token firmado correctamente (misma clave real) pero cuyo `sub` no coincidiera con el dueño real de esa sesión igual pasaba: se armaba `req.auth` con el `sub` del token y el rol de OTRO usuario, autenticado con la sesión de un tercero. Corregido agregando esa comprobación al mismo chequeo que ya validaba `revokedAt`/`expiresAt` — si no coinciden, se rechaza con el mismo `AuthenticationRequiredError` genérico, sin revelar cuál de las dos condiciones falló. Test dedicado en `backend/src/test/auth/requireAuth.test.ts`.

**c) Coherencia de `JWT_ACCESS_SECRET`.** Antes de esta corrección había dos fuentes de verdad: el schema de Zod la declaraba opcional (para no bloquear health/CORS/tests), pero `auth/config.ts` la exigía de forma *eager* al importarse, y las rutas de auth se montan siempre — en la práctica el servidor completo ya no arrancaba sin ella, solo que fallaba tarde y en un lugar distinto al que documentaba la variable. Corregido igualando el patrón a `DATABASE_URL`: `JWT_ACCESS_SECRET` es ahora obligatoria en `config/env.ts` (mínimo 32 caracteres, mensaje claro, sin revelar el valor), y `auth/config.ts` se simplificó a solo convertir el valor ya validado al formato que `jose` espera, sin repetir el chequeo de presencia.

**Validaciones de esta corrección**: Prisma format/validate/generate (sin cambios), `migrate status` sin drift, build, typecheck, lint, suite unitaria completa (207 tests) y suite de integración autorizada contra `demo` (23 tests, incluida la nueva prueba de concurrencia real) en verde, `format:check` en verde, escaneo de secretos sin coincidencias, `.env` sin trackear, 4 usuarios reales y 0 sesiones confirmados por SQL directo tras correr los tests.

**c) Build offline roto.** `prisma.config.ts` resolvía `DIRECT_URL` de forma eager (vía el helper `env()` de `prisma/config`), así que `prisma format`/`validate`/`generate` — que no tocan ninguna base — fallaban igual sin un `.env`. Se corrigió armando `datasource` de forma condicional (`process.env.DIRECT_URL` leído directo, sin el helper que lanza; `datasource` se omite por completo si falta, **sin URL de reemplazo hardcodeada ni connection string ficticia guardada**). Verificado con un entorno real sin `DATABASE_URL`/`DIRECT_URL`/`DATABASE_TARGET` (`.env` movido a un backup temporal fuera del repo y restaurado después, sin tocar su contenido): instalación, `prisma generate`, `prisma validate`, build, typecheck, lint, tests unitarios y `format:check` funcionan igual — ninguno requiere Neon. Solo conexión (`db:check`), migraciones, seed y tests de integración necesitan las variables reales, y fallan con un mensaje claro (nunca con una connection string) si faltan.

Tests agregados: `backend/src/test/guard-db-command.test.ts` (la guarda como función pura — target rechazado, variable ausente, forma incorrecta, sin secretos en el mensaje) y `backend/src/test/offline-commands.test.ts` (spawns reales de `prisma format`/`validate`/`generate` sin ninguna de las tres variables, confirmando que sí funcionan). `backend/src/test/env.test.ts` se actualizó para reflejar que `DATABASE_URL` es obligatoria.
