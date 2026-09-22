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

**Actualización Etapa 2**: el modelo de datos que soporta esto ya existe (`User.passwordHash`, `User.status`, `Session`), pero **ningún flujo de autenticación está implementado todavía** — eso sigue siendo íntegramente Etapa 3. Se confirmó (decisión del usuario) que `User` y `Employee` son entidades separadas con relación explícita — ver `docs/DATABASE.md`, "Separación User/Employee". Los 4 empleados reales ya tienen su `User` correspondiente sembrado en `status: PENDING_ACTIVATION`, sin contraseña ni PIN — no pueden autenticarse hasta que la Etapa 3 implemente la activación real.

## 6. Sesiones persistentes

- El prototipo usa `sessionStorage` (se pierde al cerrar el navegador). La arquitectura objetivo debe decidir, en su propia etapa, si usa cookies de sesión httpOnly con expiración configurable (recomendado, evita exposición a robo de token vía XSS) o JWT de corta duración con refresh — pendiente de definición explícita, no se resuelve en esta auditoría.
- **Actualización Etapa 2**: el modelo `Session` ya existe en el schema (`refreshTokenHash` — nunca el token en texto plano —, `expiresAt`, `revokedAt` nullable para revocación sin borrado físico, `ipAddress`, `userAgent`). Sin filas sembradas ni lógica de emisión/validación todavía.

## 7. Roles `ADMIN` y `EMPLOYEE`

- Mapeo directo de los roles actuales (`admin` → `ADMIN`, `user`/"equipo de trabajo" → `EMPLOYEE`).
- A diferencia del prototipo, el backend debe rechazar en el servidor cualquier operación admin-only intentada por un `EMPLOYEE`, independientemente de lo que el cliente envíe u oculte visualmente.
- Ver `docs/BUSINESS_RULES.md` sección 1 para el detalle completo de qué operaciones son hoy admin-only en la UI (deben serlo también en el backend) y la inconsistencia detectada en fotos (a resolver como decisión de producto: ¿se mantiene abierto a todos, o se restringe a admin en la reconstrucción?).
- **Actualización Etapa 2**: confirmado — la eliminación de fotografías (`FileAsset`) será exclusiva de `ADMIN` en las etapas de implementación de endpoints (Etapa 5 en adelante), no abierta a todo `EMPLOYEE` como en el prototipo.

## 8. Auditoría

- El prototipo actual **no tiene una tabla de auditoría genérica**. Lo más cercano es el campo `compPid`/`completado_por` + `nota` en `ejecuciones` (quién completó una tarea de otra persona) y el registro automático de "ajustes" de stock como filas de `consumos` con motivo prefijado (`docs/BUSINESS_RULES.md` sección 8).
- La arquitectura objetivo debe definir, en su propia etapa, si se agrega una tabla de auditoría transversal (quién hizo qué, cuándo, sobre qué entidad) — no existe en el prototipo, por lo que es una decisión nueva, no una migración de algo existente.
- **Actualización Etapa 2**: se agregó `AuditLog` (actor, `action` como texto libre —no enum, ver justificación en `docs/DATABASE.md`—, `entityType`/`entityId`, `previousState`/`newState` en JSON, IP, user-agent, timestamp). Sin filas sembradas ni lógica de escritura todavía — eso corresponde a cuando se implementen los servicios que modifican datos (Etapa 5).

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
| Backend (Render) | `NODE_ENV`, `PORT`, `FRONTEND_URL` (activas); `DATABASE_URL`, `JWT_*`, `OBJECT_STORAGE_*` (previstas, opcionales todavía) | Variables de entorno configuradas en el dashboard de Render para ese servicio — inyectadas directamente en `process.env` del proceso Node, sin ningún archivo |
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
