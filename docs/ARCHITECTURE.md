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

- **Frontend (Netlify)**: solo presentación y consumo de la API del backend vía HTTPS. No contiene ningún secreto. **Actualización Etapa 3C**: ya no se comunica mediante una URL de API absoluta configurada por variable de entorno — usa rutas relativas bajo `/api`, resueltas por un proxy (Vite en desarrollo, Netlify en producción — ver sección 14.14). Cero variables `VITE_*` en esta etapa.
- **Backend (Render)**: dueño de toda la lógica de negocio (cálculo de períodos, estados de stock, desempeño, etc. — hoy vive en el cliente y debe migrar al servidor), de la autenticación/autorización, de la integración con Neon Object Storage, y del acceso a Postgres vía Prisma.
- **Base de datos (Neon)**: solo accesible desde el backend (connection string en variable de entorno del backend, nunca expuesta al navegador).

## 5. Estrategia de autenticación (a definir en detalle en su propia etapa)

Puntos que la migración debe resolver — **no se decide en este documento**, se documenta como pendiente:

- Reemplazar el PIN comparado en el cliente por un endpoint de login en el backend que valide el PIN (o el mecanismo que se decida) contra la base y emita una sesión (cookie httpOnly + servidor con estado, o JWT firmado por el servidor).
- Definir si se mantiene el modelo "PIN de 4 dígitos por persona + PIN de admin compartido" o se reemplaza por credenciales por persona con rol propio (recomendado para trazabilidad — hoy, como se documentó en `docs/BUSINESS_RULES.md` sección 4, un login como "Administrador" sin persona asociada no deja registro de qué individuo actuó).
- Definir política de intentos fallidos / bloqueo, ausente en el prototipo actual.

**Actualización Etapa 2**: el modelo de datos que soporta esto ya existe (`User.passwordHash`, `User.status`, `Session`). Se confirmó (decisión del usuario) que `User` y `Employee` son entidades separadas con relación explícita — ver `docs/DATABASE.md`, "Separación User/Employee". Los 4 empleados reales ya tienen su `User` correspondiente sembrado en `status: PENDING_ACTIVATION`, sin contraseña ni PIN — no pueden autenticarse hasta que un `ADMIN` los active vía `POST /api/v1/admin/users/:id/activate`.

**Actualización Etapa 3B.1**: implementado — login por contraseña (Argon2id), autorización por rol validada en el servidor contra la base (nunca solo contra el claim del JWT), y activación/gestión de usuarios como se describe arriba. Detalle completo en la sección 14.

**Actualización Etapa 3B.2**: corrección de modelo de credenciales — se resuelve la pregunta que quedaba pendiente en el segundo punto de esta sección ("PIN compartido vs. credenciales individuales"), a favor de **PIN individual por persona, nunca compartido ni predeterminado** (ni siquiera el admin comparte su PIN con nadie) — se mantiene la UX de PIN del prototipo (selección de identidad + 4 dígitos) pero con la trazabilidad de credenciales por persona que el prototipo no tenía, y con hash Argon2id + bloqueo persistente por intentos fallidos, ausentes en el original. `username`+contraseña visible, que la Etapa 3B.1 había introducido, se reemplaza por selección de identidad (`GET /auth/login-options`) + PIN. Detalle completo en la sección 14.1/14.13.

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
- **Actualización Etapa 3B.2**: acciones nuevas por el cambio a PIN: `auth.login.locked` (bloqueo por intentos), `admin.user.pin_reset` (reemplaza `admin.user.password_reset`) y `admin.user.sessions_revoked_by_pin_reset`. `previousState`/`newState` nunca incluyen el PIN, igual que nunca incluyeron una contraseña. Detalle en la sección 14.1a/14.13.

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
| Frontend (Netlify) | Ninguna — **Actualización Etapa 3C**: `VITE_API_URL` se eliminó; el frontend usa rutas relativas bajo `/api`, resueltas por el proxy de Netlify en producción (sección 14.14), nunca una variable `VITE_*` con la URL del backend | — |

**Por qué esto funciona sin un `.env` en producción — comprobado, no solo asumido:**

- `dotenv` (backend, `backend/src/config/index.ts`) da prioridad a las variables ya presentes en `process.env` por sobre cualquier `.env` de archivo — así funciona por diseño. Como el repositorio nunca commitea un `.env` real (`.gitignore`), en Netlify y Render simplemente no hay archivo que leer: `dotenv.config()` no encuentra el archivo, no lanza error, y no pisa nada — el proceso sigue con lo que la plataforma ya inyectó en `process.env`.
- El backend valida con Zod únicamente `NODE_ENV`, `PORT`, `FRONTEND_URL` y las variables previstas — **nunca lee ni declara ninguna variable `VITE_*`**. Verificado con un test dedicado (`backend/src/test/env.test.ts`): si por algún motivo una variable `VITE_*` llegara a estar presente en el entorno del proceso backend, el schema la descarta silenciosamente (Zod no incluye claves no declaradas en el resultado).
- El frontend, por diseño de Vite, solo expone al bundle del cliente las variables con prefijo `VITE_` (`envPrefix` por defecto) — cualquier variable del backend (`DATABASE_URL`, `JWT_ACCESS_SECRET`, etc.) nunca llega a `import.meta.env` ni al código empaquetado, aunque estuviera presente en el entorno de build. **Actualización Etapa 3C**: `.env.example` ya no declara ninguna variable `VITE_*` — el frontend no necesita ninguna para funcionar, ni en desarrollo (proxy de Vite) ni en producción (proxy de Netlify).
- Verificado empíricamente sobre el build real (`frontend/dist`): ninguna cadena de las variables previstas para el backend (secretos, URLs internas), ni `localStorage`/`sessionStorage`, ni un PIN hardcodeado, aparece en el bundle compilado.

**Configuración esperada al desplegar** (no ejecutada en esta etapa, es la referencia para cuando se despliegue):

- **Netlify**: "Base directory" = `frontend`, build command = `npm run build` (o el equivalente desde la raíz apuntando al workspace), "Publish directory" = `frontend/dist`. Ninguna variable de entorno que configurar para que el frontend hable con el backend — eso lo resuelve el archivo de proxy/redirects (sección 14.14), no una variable de build.
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

## 14. Autenticación (Etapa 3B.1, modelo de credenciales corregido a PIN en la Etapa 3B.2)

Implementado íntegramente en el backend — sin pantalla de login ni ningún cambio funcional en el frontend (más allá de lo estrictamente necesario para que el proyecto siga compilando). Ver también `docs/SECURITY.md` (amenazas consideradas) y `docs/DATABASE.md` (cambios al modelo `User`/`Session`).

### 14.1 PIN (Etapa 3B.2 — reemplaza usuario+contraseña)

El acceso ya no usa username+contraseña: la persona selecciona su identidad (ver 14.6a, `GET /auth/login-options`) e ingresa un PIN numérico de exactamente 4 dígitos (`^\d{4}$`) — mismo patrón de UX que el prototipo original, pero validado y almacenado de forma segura del lado del servidor (ver `docs/SECURITY.md`, "Autenticación por PIN", para el detalle de por qué esto no es "volver a la inseguridad del HTML heredado"). El PIN es siempre un `string`, nunca un número: `'0007'` se valida y se hashea tal cual, sin ningún `Number()`/`parseInt()` en ningún punto del flujo (perdería el cero inicial).

Hash: Argon2id (`argon2`, mismos parámetros que se usaban para contraseñas — el costo del hash no depende de la longitud de la entrada: `memoryCost=19456` (19 MiB), `timeCost=2`, `parallelism=1`). El login nunca distingue en su respuesta entre identidad inexistente, PIN incorrecto, cuenta no `ACTIVE` o cuenta bloqueada por intentos fallidos — siempre el mismo error genérico —, y compara igual contra un hash *dummy* cacheado en esos casos, para no filtrar por tiempo de respuesta qué rama del código se ejecutó. Ni el PIN ni su hash se devuelven nunca al cliente, ni se registran en logs o auditoría (`AuditLog.previousState`/`newState` nunca incluyen el campo `pin`). Detalle completo del cambio (por qué, cómo se migró la columna, qué se corrigió en el camino) en 14.13.

### 14.1a Protección contra fuerza bruta (Etapa 3B.2)

Un PIN de 4 dígitos tiene solo 10.000 combinaciones posibles — bastante menos que una contraseña — así que la protección contra fuerza bruta deja de ser "deseable" y pasa a ser obligatoria. Dos capas independientes:

1. **Rate limiting por IP** (`createAuthRateLimiter`, en memoria del proceso — ver 14.9): primera capa, ya existía desde la Etapa 3B.1, alcanza para frenar un intento automatizado desde una sola IP sin agregar infraestructura nueva.
2. **Bloqueo persistente por usuario** (`User.failedLoginAttempts`, `User.lockedUntil` — Postgres, no memoria del proceso): sobrevive a un reinicio de Render, y protege aunque el ataque venga de IPs rotativas. Tras 5 intentos fallidos consecutivos, la cuenta queda bloqueada 15 minutos — durante ese tiempo, el login se rechaza genéricamente **aunque el PIN enviado sea el correcto**, sin revelar que la causa fue el bloqueo. Un login exitoso resetea el contador y el bloqueo; también lo resetea un cambio de PIN hecho por un admin (`POST /admin/users/:id/reset-pin`, ver 14.6b). El contador **no** se resetea solo porque el bloqueo haya vencido — solo un login correcto o una intervención del admin lo hacen.

El incremento del contador usa el operador atómico de Prisma (`{ increment: 1 }`, `SET col = col + 1` a nivel SQL) — nunca "leer el valor, sumar en la aplicación, escribir", que perdería incrementos bajo intentos concurrentes. La transición de "no bloqueada" a "bloqueada" usa además una escritura condicionada (`updateMany` con `WHERE ... AND (locked_until IS NULL OR locked_until < now())`), el mismo patrón de toma atómica que la rotación de refresh tokens (14.12): bajo una ráfaga de intentos concurrentes que cruzan el umbral a la vez, esto garantiza que como máximo una de esas solicitudes quede marcada como la que "aplicó" el bloqueo y audite el evento — sin esa condición, cada solicitud que ve el contador ya en 5+ generaría su propia entrada de auditoría de bloqueo, duplicándola. Verificado con un test de integración real contra `demo` que lanza 10 intentos fallidos concurrentes sobre el mismo usuario: el contador final es exactamente 10 (ningún incremento perdido) y aparece exactamente una fila de auditoría `auth.login.locked` (ninguna duplicada).

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

`/api/v1/auth`:
- **`GET /login-options`** (Etapa 3B.2, público, sin autenticación) — ver 14.6a.
- **`POST /login`** — body `{ userId: string (uuid), pin: string (4 dígitos) }` (antes `{ username, password }`); `userId` es el `id` de la identidad elegida en el selector, nunca un `username`.
- `POST /refresh` (lee el refresh token solo de la cookie, valida `Origin` contra `FRONTEND_URL`).
- `POST /logout` (ídem, idempotente, nunca revela si el token existía).
- `GET /me` (requiere access token; nunca devuelve `pinHash`, `username`, sesiones, ni intentos fallidos/bloqueo).

`/api/v1/admin/users` (`ADMIN` únicamente, vía `requireAuth` + `requireRole('ADMIN')`): `GET /` (paginado, filtrable por status/rol — a diferencia de `login-options`, esta vista SÍ incluye `username`, porque es administrativa, no el selector público), `POST /:id/activate` (solo desde `PENDING_ACTIVATION`, body `{ pin }`), **`POST /:id/reset-pin`** (Etapa 3B.2, antes `reset-password`; body `{ pin }`; revoca todas las sesiones activas del usuario Y resetea `failedLoginAttempts`/`lockedUntil` en la misma transacción), `PATCH /:id/status` (transiciones explícitas — nunca `PENDING_ACTIVATION → ACTIVE` por esta vía, reservado a `/activate` —, con protección de auto-lockout: un admin no puede suspenderse/desactivarse a sí mismo si eso dejara al sistema sin ningún `ADMIN` activo). Ningún endpoint permite que un empleado cambie su propio PIN — esa acción es exclusiva de `ADMIN`, no existe ninguna ruta de autoservicio.

### 14.6a Selector público de identidad (`GET /auth/login-options`, Etapa 3B.2)

Público, de solo lectura, sin autenticación — el rate limit general de `/api` (14.9) alcanza como primera capa, no necesita el límite más estricto de `/login`/`/refresh` (no hay credenciales involucradas). Devuelve únicamente `{ id, displayName, role, colorHex }` por cada identidad habilitada:

- **`id`**: el `User.id` (UUID) — mismo valor que se envía después en `POST /login`.
- **`displayName`**: `Employee.displayName` para usuarios `EMPLOYEE`; para un `ADMIN` sin `Employee` vinculado (el caso normal — el admin nace del bootstrap, no del seed de empleados) se usa una etiqueta genérica fija, `"Administrador"` — nunca `username`, que es un identificador técnico interno.
- **`role`**: `ADMIN` | `EMPLOYEE` — el indicador visual mínimo para distinguir el tipo de identidad en el selector.
- **`colorHex`**: el de `Employee.colorHex` si existe; `null` para un `ADMIN` sin `Employee`.

**"Habilitado" significa exactamente `status: ACTIVE`** — decisión explícita, documentada acá para que no quede ambigua: `PENDING_ACTIVATION` no tiene PIN todavía (no puede autenticarse), y `SUSPENDED`/`DEACTIVATED` no deben ofrecerse como opción seleccionable aunque conserven un PIN antiguo. Nunca se selecciona `pinHash`, `username`, `failedLoginAttempts` ni `lockedUntil` — ni siquiera para descartarlos después: el `select` de Prisma los excluye desde la consulta. Orden estable: por `createdAt` ascendente (mismo criterio que `GET /admin/users`). Un `User` `EMPLOYEE` sin `Employee` vinculado (no debería ocurrir en datos reales, la regla de negocio es 1:1 desde el seed) se excluye del listado en vez de inventar un nombre o exponer el `username` — es una decisión defensiva, no una regla de negocio nueva.

### 14.6b Corrección: reactivar a alguien que nunca tuvo PIN (Etapa 3D)

Encontrado por revisión de contrato antes de construir la pantalla de administración de usuarios (Etapa 3D), no por un test que fallara en producción. `ALLOWED_TRANSITIONS` (`backend/src/auth/userStatus.ts`) permite `SUSPENDED -> ACTIVE` y `DEACTIVATED -> ACTIVE` sin condición — pensado para reactivar a alguien que ya tenía PIN antes de suspenderse/deshabilitarse. Pero un usuario puede llegar a `DEACTIVATED` directo desde `PENDING_ACTIVATION` (transición sí permitida, `PENDING_ACTIVATION -> DEACTIVATED`) sin pasar nunca por `POST /activate` — ese usuario nunca tuvo `pinHash`. Como no existe ninguna transición de vuelta a `PENDING_ACTIVATION`, la única forma normal de asignarle un PIN es activarlo en su momento original desde ese estado; si en cambio se lo "reactiva" con `PATCH /status { status: 'ACTIVE' }`, el `UPDATE` intentaría dejarlo `ACTIVE` con `pinHash: NULL`, violando el `CHECK` real de la base (`users_active_requires_pin_hash_check`, ver `docs/DATABASE.md`) — sin este chequeo, ese intento producía un 500 crudo (error de Postgres sin traducir) en vez de un rechazo controlado.

Corregido en `adminUsersController.changeStatus`, después del chequeo de transición permitida y antes del chequeo de auto-bloqueo: si `nextStatus === 'ACTIVE'` y el usuario no tiene `pinHash`, se rechaza con `InvalidStatusTransitionError` (400, mismo tipo de error que una transición no permitida) y un mensaje que explica por qué. No cambia el contrato del endpoint (mismo body, mismos valores de `status`, mismo tipo de error) — es una validación adicional, no un cambio de forma. Verificado con un test de integración real contra `demo` (`backend/src/test/integration/adminUsers.integration.test.ts`): un usuario sintético `PENDING_ACTIVATION -> DEACTIVATED` (nunca activado) rechaza limpiamente `PATCH /status { status: 'ACTIVE' }`, mientras que `DEACTIVATED -> SUSPENDED` (transición sin relación con `pinHash`) se sigue aceptando sin cambios.

### 14.7 Primer administrador

`npm run auth:bootstrap-admin` (`backend/src/scripts/bootstrapAdmin.ts`): núcleo puro `bootstrapAdmin(prisma, input)` + `main()` interactivo. Pide `username` (identificador técnico interno — columna `NOT NULL @unique` en el schema, y el único dato que permite identificar al admin en `GET /admin/users`; ya no se usa para iniciar sesión, pero sigue siendo necesario) y un PIN de 4 dígitos por prompt oculto vía `@inquirer/prompts`, **con confirmación** (se pide dos veces, se aborta sin crear nada si no coinciden) — nunca como argumento de línea de comandos, nunca hardcodeado, nunca impreso. No pide nada más (ni nombre visible, ni email): un admin creado por bootstrap no tiene `Employee` vinculado, así que el selector público lo muestra con la etiqueta genérica "Administrador" (14.6a). Se niega si ya existe un `ADMIN` con status `ACTIVE` (idempotente, seguro ante una segunda corrida), respeta la guarda `DATABASE_TARGET=demo`, y audita la creación sin registrar nunca el PIN ni su hash en la salida de consola. **No se ejecutó en ningún momento de esta etapa ni de la anterior** — solo se construyó y se testeó (unitariamente con un Prisma en memoria, y de forma controlada contra `demo` con limpieza determinística en `backend/src/test/integration/bootstrapAdmin.integration.test.ts`, nunca invocando su `main()`).

### 14.8 Cookies y CSRF

Frontend en Netlify, backend en Render — dominios distintos en esta etapa. CORS restringido a `FRONTEND_URL` con `credentials: true` (nunca `origin: '*'` combinado con credenciales). La cookie del refresh token se configura en un único lugar (`backend/src/config/cookies.ts`) para que su creación y su borrado usen exactamente los mismos atributos (nombre, `path`, `sameSite`, `secure`, `httpOnly`) — `res.clearCookie` los compara y, si no coinciden, la cookie no se borra realmente. `login`/`refresh`/`logout` exigen `Content-Type: application/json`; `refresh`/`logout` además validan el header `Origin` contra `FRONTEND_URL` antes de actuar.

`COOKIE_SAME_SITE` (`lax`\|`strict`\|`none`) es configurable; si se deja vacía, se deriva `none` en producción (dominios cruzados reales) y `lax` en desarrollo local (mismo origen efectivo). La regla dura, verificada con un test dedicado (`deriveSecureFlag`): `SameSite=None` siempre fuerza `Secure=true`, sin excepción — nunca se desactiva esa protección "para que funcione".

**Pendiente, documentado a propósito**: no se decidió todavía si la arquitectura final usa un proxy de Netlify (`_redirects`/Netlify Functions) para que frontend y backend compartan efectivamente el mismo origen público (evitando cookies cross-site del todo), o si se mantienen dominios separados con `SameSite=None; Secure`. **Actualización Etapa 3C**: la pantalla de login ya existe y ya usa un proxy equivalente en desarrollo (Vite, ver sección 15.7) — la decisión de PRODUCCIÓN sigue pendiente porque falta la URL real de Render; sección 15.7 documenta exactamente qué regla habrá que agregar cuando exista.

### 14.9 Rate limiting, respuestas y auditoría

Límite específico para `/auth/login` y `/auth/refresh` (`createAuthRateLimiter`, más estricto que el límite general de `/api`) — `/auth/login-options` no lo necesita, ver 14.6a. Todas las respuestas de `/api/v1/auth`/`/api/v1/admin` llevan `Cache-Control: no-store`. Morgan nunca registra cookies ni el header `Authorization`. Auditoría (`AuditLog`) para: login exitoso/fallido, bloqueo por intentos fallidos (`auth.login.locked`, escrito una única vez por evento de bloqueo — ver 14.1a), refresh, detección de reuso, detección de rotación concurrente, logout, activación, cambio de PIN por admin (`admin.user.pin_reset`) y su revocación de sesiones asociada (`admin.user.sessions_revoked_by_pin_reset`, fila separada), cambio de estado, bootstrap del admin — nunca con el PIN, una contraseña, ni ningún token en `previousState`/`newState`. Un fallo al auditar el camino normal de login/refresh/logout nunca rompe la autenticación (auditoría *best-effort*, fuera de la transacción); en las operaciones administrativas y en la detección de reuso/rotación concurrente, en cambio, la auditoría es parte del efecto atómico (dentro de la misma transacción que el cambio de estado).

### 14.10 Migraciones y verificación

`20260923110309_auth_session_security` (Etapa 3B.1) generada offline (`prisma migrate diff --from-schema <schema.prisma antes del cambio> --to-schema <schema.prisma actual> --script`, comparación pura entre dos archivos, sin base de shadow ni conexión — el flujo interactivo estándar de `migrate dev --create-only` no es viable en este entorno no interactivo cuando hay una advertencia que normalmente pide confirmación), inspeccionada a mano, y aplicada únicamente a `demo` con `prisma migrate deploy` (guardado). Verificado contra Postgres real: los dos índices nuevos existen exactamente como se esperaba, `_prisma_migrations` muestra ambas migraciones aplicadas sin rollback, las 75 filas del seed original y la tabla `sessions` (vacía antes de esta etapa) quedaron intactas.

`pin_authentication` (Etapa 3B.2) — detalle completo en 14.13.

### 14.11 Tests

Suite unitaria (`backend/src/test/auth/`, corre con `npm test`, nunca contra Neon): política de PIN, hash/verificación (incluido el caso de cero inicial), tokens (firma/verificación, expiración, secreto/issuer/audience incorrectos, `alg=none`), transiciones de estado, cookies, `authService` (login por PIN/fuerza bruta/`getLoginOptions`/refresh/rotación/detección de reuso/logout), `requireAuth`/`requireRole`, `bootstrapAdmin`. Suite de integración (`backend/src/test/integration/`, `npm run test:integration`, guardada por `DATABASE_TARGET=demo`, siempre secuencial — `fileParallelism: false`, porque varios archivos miden conteos globales de filas como línea de base): login por PIN/refresh/rotación/detección de reuso/logout reales, activación/reset de PIN/cambio de estado/listado reales, bloqueo real por intentos concurrentes sin incrementos perdidos, e idempotencia real de `bootstrapAdmin` — todo con limpieza determinística, nunca deja usuarios/sesiones/auditorías de prueba, nunca toca las filas del seed real. Esta suite encontró dos bugs reales de concurrencia que los tests unitarios (Prisma en memoria, sin transacciones reales) no podían detectar: el rollback de la detección de reuso (14.3) y la duplicación del audit log de bloqueo bajo una ráfaga de intentos fallidos (14.1a/14.13).

### 14.12 Corrección posterior: rotación concurrente, vinculación sesión↔usuario, `JWT_ACCESS_SECRET`

Revisión puntual, sin cambios de schema ni nueva migración, sobre tres puntos encontrados en la implementación de la Etapa 3B.1:

**a) Rotación concurrente del refresh token.** La rotación revocaba la sesión vieja con un `update` incondicional (`WHERE id = X`), no condicionado por su estado. Dos solicitudes de `POST /auth/refresh` con el mismo refresh token, casi simultáneas, podían ambas leer la sesión como "activa" antes de que cualquiera escribiera, y ambas terminar creando una sesión nueva — dos refresh tokens válidos a partir de uno solo. Corregido reemplazando ese `update` por un `updateMany` condicionado (`WHERE id = X AND revokedAt IS NULL AND expiresAt > now()`), y avanzando a crear la sesión nueva solo si `count === 1`. Bajo el nivel de aislamiento por defecto de Postgres (READ COMMITTED) esto ya alcanza como exclusión mutua real: un `UPDATE` toma un lock de fila; una segunda transacción que intente actualizar la misma fila queda bloqueada hasta que la primera confirme, y al desbloquearse Postgres vuelve a evaluar el `WHERE` contra la fila ya committeada — si `revoked_at` ya no es nulo, esa segunda escritura simplemente no afecta ninguna fila. No hace falta `SERIALIZABLE` ni un `SELECT ... FOR UPDATE` explícito. Cuando `count !== 1` (la solicitud perdió la carrera, o directamente llegó tarde y ya la encuentra revocada), se trata igual que un reuso: se revocan conservadoramente todas las sesiones activas del usuario (incluida la que la solicitud ganadora acababa de crear), se audita (`auth.refresh.concurrent_rotation_detected`), y se responde con el mismo error genérico de sesión inválida — nunca se emite un segundo refresh token. Verificado con un test de integración real contra `demo` que lanza dos `refresh()` simultáneos sobre el mismo token (`backend/src/test/integration/auth.integration.test.ts`): en cada corrida gana exactamente uno, la otra solicitud recibe el error, y no queda ninguna sesión activa para ese usuario al terminar — cuál de las dos ramas (la toma atómica o la detección de reuso clásica, si la perdedora llega a leer después de que la ganadora ya confirmó) atrapa a la perdedora depende del timing real de red contra Neon, pero ambas aplican exactamente la misma respuesta de seguridad.

**b) Vinculación estricta sesión↔usuario en `requireAuth`.** El middleware validaba la sesión por `sid` y el usuario por `sub` de forma independiente, sin exigir que `session.userId === payload.sub`. Un token firmado correctamente (misma clave real) pero cuyo `sub` no coincidiera con el dueño real de esa sesión igual pasaba: se armaba `req.auth` con el `sub` del token y el rol de OTRO usuario, autenticado con la sesión de un tercero. Corregido agregando esa comprobación al mismo chequeo que ya validaba `revokedAt`/`expiresAt` — si no coinciden, se rechaza con el mismo `AuthenticationRequiredError` genérico, sin revelar cuál de las dos condiciones falló. Test dedicado en `backend/src/test/auth/requireAuth.test.ts`.

**c) Coherencia de `JWT_ACCESS_SECRET`.** Antes de esta corrección había dos fuentes de verdad: el schema de Zod la declaraba opcional (para no bloquear health/CORS/tests), pero `auth/config.ts` la exigía de forma *eager* al importarse, y las rutas de auth se montan siempre — en la práctica el servidor completo ya no arrancaba sin ella, solo que fallaba tarde y en un lugar distinto al que documentaba la variable. Corregido igualando el patrón a `DATABASE_URL`: `JWT_ACCESS_SECRET` es ahora obligatoria en `config/env.ts` (mínimo 32 caracteres, mensaje claro, sin revelar el valor), y `auth/config.ts` se simplificó a solo convertir el valor ya validado al formato que `jose` espera, sin repetir el chequeo de presencia.

**Validaciones de esta corrección**: Prisma format/validate/generate (sin cambios), `migrate status` sin drift, build, typecheck, lint, suite unitaria completa (207 tests) y suite de integración autorizada contra `demo` (23 tests, incluida la nueva prueba de concurrencia real) en verde, `format:check` en verde, escaneo de secretos sin coincidencias, `.env` sin trackear, 4 usuarios reales y 0 sesiones confirmados por SQL directo tras correr los tests.

### 14.13 Corrección arquitectónica posterior (Etapa 3B.2): contraseña → PIN

El modelo de credenciales visible cambió: ya no es usuario+contraseña, es selección de identidad + PIN de 4 dígitos (ver 14.1/14.1a/14.6a) — decisión funcional del usuario, no un hallazgo de seguridad sobre la Etapa 3B.1. Todo lo demás de la Etapa 3B.1 (JWT de acceso, refresh opaco con rotación, sesiones persistentes revocables, cookies `HttpOnly`, autorización por rol desde la base, `session.userId === token.sub`, protección de concurrencia en la rotación) se conserva sin reducir ninguna protección.

**Cambios de código**: `backend/src/auth/password.ts` → `backend/src/auth/pin.ts` (`validatePinPolicy`, `hashPin`, `verifyPin`, `verifyAgainstDummy` — mismos parámetros Argon2id, política cambiada de "12-128 caracteres" a "exactamente 4 dígitos"). `authService.login()` pasa a recibir `{ userId, pin }` en vez de `{ username, password }` — ya no normaliza ni busca por `username`, busca directo por `id` (el mismo valor que devuelve `getLoginOptions`). `PublicUser` (la forma que ven `/me` y la respuesta de login) dejó de incluir `username` — es un identificador técnico interno, no algo que la propia persona autenticada necesite ver. Nueva función `getLoginOptions` (14.6a). `adminUsersController.resetPassword` → `resetPin`, ahora también resetea `failedLoginAttempts`/`lockedUntil` (antes solo cambiaba el hash y revocaba sesiones) y audita la revocación de sesiones como una fila separada de la del cambio de PIN en sí. `bootstrapAdmin` pide PIN con confirmación en vez de contraseña simple.

**`username` se conserva, pero cambia su propósito**: sigue siendo `String @unique NOT NULL` en el schema — es la clave natural del seed idempotente y el identificador que ve un `ADMIN` en `GET /admin/users` — pero dejó de ser lo que se ingresa para iniciar sesión, y dejó de exponerse en `login-options`/`/me`/la respuesta de login. Se revisaron todas sus referencias antes de decidir esto (seed, bootstrap, `GET /admin/users`, tests) — no se eliminó el campo: eliminarlo hubiera roto la clave de idempotencia del seed sin necesidad, para una limpieza cosmética que no pedía el usuario.

**Cambios de schema y migración** (`pin_authentication`, ver `docs/DATABASE.md` para el detalle SQL completo): rename de columna `password_hash` → `pin_hash` (`ALTER TABLE ... RENAME COLUMN`, nunca drop+recreate — preserva cualquier valor existente, aunque en este caso los 4 valores reales seguían siendo `NULL`), rename del constraint asociado, y dos columnas nuevas (`failed_login_attempts`, `locked_until`) para la protección de fuerza bruta (14.1a). Generada offline con el mismo procedimiento que `auth_session_security` (`prisma migrate diff` no detecta el rename comparando dos schemas sueltos — genera un drop+add — así que el SQL se escribió a mano usando `RENAME COLUMN`/`RENAME CONSTRAINT`), inspeccionada a mano, aplicada solo a `demo` con `prisma migrate deploy`.

**Bug real encontrado y corregido durante esta misma corrección**: la primera versión de la protección de fuerza bruta escribía una fila de auditoría `auth.login.locked` en **cada** intento fallido una vez superado el umbral de 5 (`failedLoginAttempts >= 5`), no solo en el que cruzó el umbral por primera vez — bajo una ráfaga de intentos concurrentes, varias solicitudes pueden cruzar el umbral con su propio incremento (el conteo en sí nunca se pierde gracias al operador atómico `increment`, pero decidir *cuál* solicitud "aplica" el bloqueo si no se atomiza también). Corregido con el mismo patrón de toma atómica que la rotación de refresh tokens (14.12, punto a): el bloqueo se aplica con un `updateMany` condicionado por `lockedUntil: null` o ya vencido, y solo la solicitud cuyo `count` da 1 se considera la que efectivamente bloqueó la cuenta y audita el evento. Encontrado por el test de integración real de 10 intentos concurrentes contra `demo` (`backend/src/test/integration/auth.integration.test.ts`) — un test unitario con Prisma en memoria (secuencial, sin condiciones de carrera reales) no lo hubiera detectado, igual que con el bug de 14.3.

**Validaciones de esta corrección**: Prisma format/validate/generate, migración generada e inspeccionada, aplicada solo a `demo`, `migrate status` sin drift, build, typecheck, lint, suite unitaria completa (222 tests) y suite de integración autorizada contra `demo` (28 tests, corrida dos veces para descartar flakiness) en verde, `format:check` en verde, escaneo de secretos y de PIN hardcodeados sin coincidencias, `.env` sin trackear, 4 usuarios reales (siguen `PENDING_ACTIVATION`, sin PIN inventado) y 0 sesiones/usuarios de prueba confirmados por SQL directo tras correr los tests. No se creó ningún administrador real, no se ejecutó `npm run auth:bootstrap-admin`, `production` no se tocó, no se avanzó con ninguna pantalla de login funcional.

## 15. Frontend de autenticación por PIN (Etapa 3C)

Construido íntegramente sobre React 19 + `react-router-dom` v7 + Vitest/Testing Library, sin agregar ninguna librería nueva de estado global, HTTP ni UI (el proyecto no tenía ninguna de las tres antes de esta etapa, y no hizo falta para lo que pedía el flujo de login). Todavía no hay dashboard ni módulos de negocio — la única pantalla protegida es un punto de entrada temporal que confirma usuario/rol y ofrece cerrar sesión.

### 15.1 Access token — solo en memoria

`frontend/src/auth/accessTokenStore.ts`: una variable de módulo (no React state, no `localStorage`/`sessionStorage`/`IndexedDB`/cookie legible desde JS), con `getAccessToken`/`setAccessToken`/`clearAccessToken`/`subscribeToAccessToken`. Se pierde a propósito al recargar la página — la restauración de sesión (15.3) es lo que la repone, usando el refresh token opaco que el navegador nunca puede leer (cookie `HttpOnly`). El cliente HTTP (15.2) lo lee de forma síncrona para armar el header `Authorization`; ningún componente de React necesita acceso directo al valor del token (`AuthContext` expone `user`/`status`, nunca el token en sí).

### 15.2 Cliente HTTP (`frontend/src/api/httpClient.ts`)

Rutas relativas bajo `/api/v1` (nunca una URL absoluta del backend, nunca una variable `VITE_*`) — ver 15.7 para cómo se resuelven en desarrollo y qué falta para producción. `credentials: 'include'` siempre, para que la cookie del refresh token viaje en cada request. `Authorization: Bearer <token>` se agrega únicamente cuando la request se marca `authenticated: true` **y** hay un token en memoria — `login-options`/`login`/`refresh`/`logout` nunca lo agregan (estructuralmente: no pasan esa opción), así que tampoco pueden entrar nunca a la lógica de reintento de 15.4.

Errores parseados en un `ApiError` tipado (`status`, `code`, `message`) reflejando la forma real del backend (`{ error: { message, code } }`, ver `backend/src/middleware/errorHandler.ts`) — nunca un mensaje inventado ni la respuesta cruda expuesta tal cual a la UI.

### 15.3 Restauración de sesión al iniciar/recargar

`AuthProvider` (`frontend/src/auth/AuthProvider.tsx`) intenta un único `POST /auth/refresh` al montar. Estados posibles:

- Éxito → `GET /auth/me` (la respuesta de `/refresh` no trae `user`, a diferencia de `/login` — se pidió a propósito, ver `backend/src/controllers/authController.ts`) → `authenticated`.
- Falla con un `ApiError` (sesión inexistente o vencida — el caso normal, más común la primera vez que alguien nunca inició sesión) → `anonymous`, sin ningún mensaje de error técnico.
- Falla por un problema de red/conectividad (no un `ApiError`) → `sessionError`, con un botón "Reintentar" (`retryBootstrap`) que vuelve a intentar el mismo flujo de verdad.

`AppRoutes` resuelve `bootstrapping`/`sessionError` ANTES de montar cualquier `<Routes>` — nunca hay un parpadeo del selector de login mientras todavía se está restaurando una sesión válida.

### 15.4 Un único coordinador de refresh — StrictMode y 401 concurrentes

`frontend/src/auth/refreshCoordinator.ts` expone `requestRefresh()`: single-flight real (una promesa de módulo, `inFlight`) que sirve **dos** disparadores distintos con el mismo mecanismo:

1. **El doble montaje de efectos de React StrictMode** en desarrollo — sin esto, dispararía dos `POST /auth/refresh` reales con el mismo refresh token, y el backend trata una rotación concurrente como posible robo (`docs/ARCHITECTURE.md` §14.12): el "perdedor" de esa carrera puede terminar revocando todas las sesiones del usuario, incluida la que "ganó".
2. **Varias requests autenticadas que reciben 401 casi al mismo tiempo** (`httpClient.ts`, `attemptWithRefresh`): comparten el mismo refresh en vez de disparar uno cada una, y cada request original se reintenta **como máximo una vez** — nunca hay loop, y un segundo 401 tras el reintento no dispara un segundo refresh.

**Logout durante un refresh en vuelo**: `accessTokenStore` lleva una "época" (`epoch`) que se incrementa en cada `clearAccessToken()` (logout). `requestRefresh` captura la época al empezar y, si cambió cuando el refresh HTTP responde, descarta el resultado (nunca llama a `setAccessToken`, la promesa rechaza) — un refresh tardío nunca vuelve a autenticar a alguien que ya cerró sesión deliberadamente. Las tres garantías (single-flight StrictMode, reintento único tras 401, logout-durante-refresh) tienen test dedicado y pasan de forma determinística — no dependen de timing real de red, a diferencia del equivalente del lado del backend (§14.12), porque acá todo corre en el mismo proceso de JS.

### 15.5 Selector de identidad (`GET /auth/login-options`)

Consume la forma real de la respuesta, `{ options: LoginOption[] }` (nunca un array suelto). Solo usuarios `ACTIVE` — una lista vacía (el estado real actual: 0 usuarios activos, los 4 empleados reales siguen `PENDING_ACTIVATION` y no hay administrador todavía) se muestra como tal, nunca se completa con fixtures: "Todavía no hay usuarios habilitados para ingresar." + "El administrador debe crear su acceso inicial y habilitar a los integrantes del equipo." — sin ningún control para crear el administrador desde el frontend. `colorHex` se valida contra un patrón hex estricto antes de usarse en un estilo inline; cualquier valor que no matchee (incluido `null`) cae a un gris neutro fijo. El rol `ADMIN` se distingue con una insignia visual y semántica (`aria-label`), nunca solo por color.

### 15.6 PIN — nunca en storage, nunca en logs

El PIN vive únicamente como estado local de `PinEntryScreen` (nunca en `AuthContext`, nunca en `accessTokenStore`, nunca en la URL) — siempre `string` (un valor como `'0007'` nunca se convierte a número, en ningún punto del frontend ni del backend). Se limpia ante un login rechazado, al volver al selector, y al desmontar el componente. Nunca se muestra en texto plano (solo 4 indicadores de "lleno/vacío"). El login rechazado nunca distingue visualmente PIN incorrecto / identidad inexistente / cuenta bloqueada / estado no permitido — siempre el mensaje genérico del backend (`ApiError.message`); un error de red muestra un mensaje de conectividad distinto, nunca "PIN incorrecto". Doble envío evitado con una guarda síncrona (`ref`, no solo el `disabled` del DOM) — más allá de que el propio backend también es la autoridad final ante cualquier reintento.

### 15.7 Proxy local de Vite (desarrollo) y proxy de Netlify (pendiente, producción)

**Desarrollo** (`frontend/vite.config.ts`): `server.proxy['/api'] -> http://localhost:4000` (mismo puerto que `PORT` en `.env.example`), sin `rewrite` — el prefijo `/api/v1` llega intacto al backend, que lo necesita (monta ahí sus rutas). `changeOrigin: true` reescribe el header `Host`, nunca el header `Origin` (el navegador lo sigue mandando como el origen real de la página) — necesario para que `validateOrigin`/CORS del backend validen contra `FRONTEND_URL`. Verificado en vivo (backend + frontend corriendo de verdad): `GET /api/v1/auth/login-options` a través del proxy devuelve exactamente lo mismo que pegarle directo al backend, con `access-control-allow-origin`/`access-control-allow-credentials` correctos.

**Producción (pendiente, documentado a propósito — no se decide en esta etapa)**: falta la URL real de Render para escribir la regla. Cuando exista, hace falta un archivo de redirects de Netlify (`frontend/public/_redirects` o `netlify.toml`) con, como mínimo:

```
/api/*  https://<url-real-de-render>/api/:splat  200
/*      /index.html                              200
```

Con la regla de `/api/*` **antes** que el catch-all de SPA (`/* -> /index.html`) — si el orden se invierte, cualquier request a `/api/...` recibiría el `index.html` de la SPA en vez de llegar al backend, y el frontend interpretaría eso como una respuesta JSON inválida. `FRONTEND_URL` en Render deberá coincidir exactamente con la URL pública real de Netlify (mismo requisito que ya exige `validateOrigin`/CORS en desarrollo, sección 14.8) — un mismatch rompe `/auth/refresh`/`/auth/logout` con `403 AUTH_ORIGIN_INVALID`, no con un error obvio de conexión. El header `Origin` se preserva igual que en desarrollo (Netlify's proxy reenvía la request tal cual la mandó el navegador). Verificación pendiente para cuando exista el despliegue real: confirmar que la respuesta de `/auth/login`/`/auth/refresh` trae `Set-Cookie` con los atributos esperados (`HttpOnly`, `Secure`, `SameSite=None` en cross-site real — ver `docs/ARCHITECTURE.md` §14.8), que un `refresh` posterior efectivamente manda esa cookie de vuelta, y que `logout` la limpia (`document.cookie` nunca debería mostrar `lc_refresh_token`, precisamente porque es `HttpOnly`). No se decide todavía si la arquitectura final usa este proxy de Netlify o un dominio propio compartido (mismo punto pendiente que §14.8).

### 15.8 Rutas protegidas y autorización por rol

`ProtectedRoute` (`frontend/src/routes/ProtectedRoute.tsx`): solo se monta cuando `status` ya está resuelto a `anonymous`/`authenticated` (`AppRoutes` filtra `bootstrapping`/`sessionError` antes) — `authenticated` renderiza `<Outlet/>`, cualquier otro estado redirige a `/login`. Nunca decide en base a un rol leído del JWT del lado del cliente — la fuente es siempre `user` tal como lo devolvió el backend (`/login` o `/me`). `RequireRole` (`frontend/src/routes/RequireRole.tsx`): utilidad preparada para rutas admin-only de etapas futuras, sin ningún consumidor real todavía (no hay módulos administrativos que proteger en esta etapa).

### 15.9 Tests y validaciones

66 tests nuevos (Vitest + Testing Library), entre ellos: single-flight de `requestRefresh` bajo llamadas concurrentes, descarte de un refresh tardío tras logout, StrictMode real (`<StrictMode>` + `render`) confirmando un único `POST /auth/refresh`, reintento único tras 401 y ausencia de loop ante un segundo 401, parseo del error real del backend, selector con estado vacío/error/carga real, conservación del cero inicial del PIN, prevención de doble envío, y ausencia de `localStorage`/`sessionStorage` en cualquier punto del flujo. Suite completa del backend (222 unitarios + 28 de integración contra `demo`) sigue en verde, sin cambios de schema en esta etapa.

**c) Build offline roto.** `prisma.config.ts` resolvía `DIRECT_URL` de forma eager (vía el helper `env()` de `prisma/config`), así que `prisma format`/`validate`/`generate` — que no tocan ninguna base — fallaban igual sin un `.env`. Se corrigió armando `datasource` de forma condicional (`process.env.DIRECT_URL` leído directo, sin el helper que lanza; `datasource` se omite por completo si falta, **sin URL de reemplazo hardcodeada ni connection string ficticia guardada**). Verificado con un entorno real sin `DATABASE_URL`/`DIRECT_URL`/`DATABASE_TARGET` (`.env` movido a un backup temporal fuera del repo y restaurado después, sin tocar su contenido): instalación, `prisma generate`, `prisma validate`, build, typecheck, lint, tests unitarios y `format:check` funcionan igual — ninguno requiere Neon. Solo conexión (`db:check`), migraciones, seed y tests de integración necesitan las variables reales, y fallan con un mensaje claro (nunca con una connection string) si faltan.

Tests agregados: `backend/src/test/guard-db-command.test.ts` (la guarda como función pura — target rechazado, variable ausente, forma incorrecta, sin secretos en el mensaje) y `backend/src/test/offline-commands.test.ts` (spawns reales de `prisma format`/`validate`/`generate` sin ninguna de las tres variables, confirmando que sí funcionan). `backend/src/test/env.test.ts` se actualizó para reflejar que `DATABASE_URL` es obligatoria.

## 16. Administración de usuarios en el frontend (Etapa 3D)

Primer consumidor real de `RequireRole` (hasta acá preparado sin usarse, sección 15.8) y primera pantalla que hace mutaciones administrativas desde el frontend. Sin librería nueva (ni HTTP, ni UI, ni estado global) — reutiliza íntegramente `httpClient`/`ApiError`/el token en memoria/el single-flight de refresh ya existentes.

### 16.1 Ruta y protección

`/admin/users` (`frontend/src/routes/AppRoutes.tsx`) anidada bajo `ProtectedRoute` (exige sesión) y envuelta en `RequireRole role="ADMIN" fallback={<AccessDeniedScreen/>}` (exige rol) — las dos protecciones ya existían desde la Etapa 3C, esta etapa es su primer uso real, no una reimplementación. Comportamiento: anónimo → redirige a `/login` (vía `ProtectedRoute`); `EMPLOYEE` autenticado → `AccessDeniedScreen` (alerta simple, nunca el contenido administrativo); `ADMIN` autenticado → `AdminUsersScreen`; mientras se restaura la sesión (`bootstrapping`) → `AppRoutes` ya resuelve ese estado antes de montar cualquier ruta (sección 15.3), así que nunca hay contenido administrativo visible durante la restauración. El backend vuelve a exigir lo mismo de forma completamente independiente en cada request (`requireAuth` + `requireRole('ADMIN')`, sección 14.5) — el frontend nunca es la única barrera, solo evita renderizar contenido que el backend igual rechazaría. Entrada visible desde `AuthenticatedHome` ("Administrar usuarios") únicamente cuando `user.role === 'ADMIN'`.

### 16.2 Tipos — `AdminUserListItem` como contrato deliberadamente distinto de `AuthenticatedUser`

`frontend/src/api/adminTypes.ts` define `AdminUserListItem` leyendo directo el `select` real de `adminUsersController.listUsers` — nunca se asumió que fuera la misma forma que `AuthenticatedUser` (`/auth/me`). Diferencias reales: `AdminUserListItem` sí incluye `username` (identificador técnico interno, útil en una vista administrativa) y `createdAt`/`updatedAt`; su `employee` no incluye `colorHex` (a diferencia del `employee` de `AuthenticatedUser` y de `LoginOption`) porque ese endpoint no lo selecciona. Ninguno de los dos tipos incluye jamás `pinHash`, intentos fallidos, bloqueo, sesiones ni tokens — el backend no los selecciona, no hay nada que ocultar del lado del cliente. `frontend/src/api/adminApi.ts` centraliza las cuatro operaciones (`fetchAdminUsers`, `activateUser`, `resetUserPin`, `changeUserStatus`), todas `authenticated: true`, todas enviando el PIN en el body JSON, nunca en query string.

### 16.3 Listado y estados de pantalla

`AdminUsersScreen` (`frontend/src/features/admin/AdminUsersScreen.tsx`) modela el estado de carga como una unión discriminada (`loading` | `error` | `loaded`, con `users: []` como caso válido de `loaded`, no un estado aparte) — nunca un booleano `isLoading` que pueda contradecir a otro. Estado vacío real ("Todavía no hay usuarios cargados.") en vez de fixtures. Error de red ofrece "Reintentar" (vuelve a `fetchAdminUsers()`). `AdminUserRow` (`frontend/src/features/admin/AdminUserRow.tsx`) traduce rol/estado a etiquetas en español (`userStatusTransitions.ts`: Pendiente de activación/Activo/Suspendido/Deshabilitado, Administrador/Equipo) con clases de `badge` distintas por estado — nunca expone `pinHash` ni ningún dato que el backend no haya seleccionado. Layout mobile-first (tarjeta por fila, sin scroll horizontal obligatorio) que en escritorio (`≥768px`) alinea identidad/badges/acciones en una fila más compacta — mismo sistema de diseño de la Etapa 3C (paleta/tipografía nuevas, sin intentar reconstruir el diseño original retirado en la Etapa 2.3), sin convertirse en un dashboard.

### 16.4 Activación, cambio de PIN y el componente `PinDialog`

Un único componente (`frontend/src/features/admin/PinDialog.tsx`) sirve tanto a "Activar y asignar PIN" (`PENDING_ACTIVATION`, `POST /admin/users/:id/activate`) como a "Cambiar PIN" (`ACTIVE`, `POST /admin/users/:id/reset-pin`) — misma validación, mismo manejo de errores, mismo patrón de limpieza, diferenciados solo por `mode`. Reglas, todas verificadas con tests:

- El PIN es siempre `string`, nunca se convierte a número — preserva ceros iniciales (`'0007'` llega tal cual al body `{ pin: '0007' }`).
- Valida exactamente 4 dígitos y que el PIN y su confirmación coincidan **del lado del cliente**, antes de llamar a la API — el backend vuelve a validar lo mismo de forma independiente (`pinSchema`, sección 14.1), esto es solo una mejora de UX, nunca la única validación.
- Ambos campos se limpian al cancelar, al completar con éxito, al fallar, y al desmontar el componente (`useEffect` de limpieza) — nunca queda un PIN en el estado de un componente que ya no está en pantalla.
- Doble envío bloqueado con una guarda síncrona (`ref`), mismo patrón que `PinEntryScreen` de la Etapa 3C (sección 15.6) — no alcanza con `disabled` del DOM solo, porque el `setState` que lo activa es asíncrono.
- Nunca sugiere ni genera un PIN automáticamente; nunca pide ni puede mostrar el PIN anterior (no existe ningún campo para eso).
- Modo `reset` muestra siempre la advertencia "Al cambiar el PIN se cerrarán todas las sesiones activas de esta persona." — extendida si el objetivo es el propio admin logueado (`isSelf`), avisando que también incluye la sesión actual.
- Input: `type="password"` (nunca `type="number"`, que convertiría el valor a número y perdería ceros iniciales) + `inputMode="numeric"` + `pattern="\d*"` (teclado numérico en móvil) + `autoComplete="one-time-code"` (evita que el navegador lo trate como una contraseña guardable, sin necesitar `type="number"` para eso).
- Errores de la API se muestran con `ApiError.message` tal cual (nunca JSON crudo ni stack trace) dentro del propio diálogo — el diálogo permanece abierto para reintentar, no se refresca la lista ni se cierra hasta que la operación termina en éxito o el usuario cancela.

### 16.5 Cambio de estado y el componente `ConfirmDialog`

`PATCH /admin/users/:id/status` vía `ConfirmDialog` (`frontend/src/features/admin/ConfirmDialog.tsx`), que exige un click explícito de confirmación antes de aplicar cualquier cambio — nunca una acción de un solo click. Las transiciones ofrecidas por fila salen de `userStatusTransitions.ts`, un espejo manual de `ALLOWED_TRANSITIONS` (`backend/src/auth/userStatus.ts`) — documentado explícitamente como espejo, no como fuente de verdad: el backend sigue decidiendo con autoridad final en cada request, una desincronización accidental de este archivo solo puede resultar en un botón de más (que el backend igual rechaza) o de menos, nunca en una transición indebida aceptada. `wouldSelfLockout` (calculado en `AdminUsersScreen`, contando cuántos otros `ADMIN` `ACTIVE` hay en la lista ya cargada) deshabilita preventivamente, del lado del cliente, el botón que dejaría al sistema sin ningún administrador activo — el backend vuelve a rechazar exactamente ese caso de forma independiente (`SelfLockoutError`, sección 14 — hallado y corregido en la Etapa 3B.1), esto es solo una mejora de UX que evita ofrecer un botón que de todos modos fallaría. La descripción del diálogo de confirmación indica explícitamente si la transición revoca sesiones (`statusChangeRevokesSessions`, mismo criterio que el backend: solo `-> SUSPENDED`/`-> DEACTIVATED`).

### 16.6 Mutación sobre la propia cuenta: logout en vez de refresco

Si la mutación recién exitosa (cambio de PIN, o cambio de estado que revoca sesiones) tuvo como objetivo al propio usuario autenticado, `AdminUsersScreen` llama a `useAuth().logout()` en vez de refrescar el listado — reutiliza exactamente el mecanismo ya construido en la Etapa 3C (`AuthProvider.logout()`, que limpia el access token en memoria e incrementa la "época" de `accessTokenStore`, sección 15.4) sin ningún código nuevo para esto. Esto satisface, sin construir nada adicional: la sesión local se cierra y vuelve al login; un refresh que ya estuviera en vuelo al momento del cambio se descarta por la misma comprobación de época que ya protegía contra un logout normal — no hace falta un mecanismo distinto porque, del lado del cliente, "cerrar sesión por cambio de PIN propio" y "cerrar sesión porque el usuario tocó 'Cerrar sesión'" son la misma operación.

### 16.7 Corrección de backend encontrada durante esta etapa

Ver sección 14.6b — reactivar (`-> ACTIVE`) a un usuario que nunca tuvo `pinHash` asignado ahora se rechaza limpiamente en vez de romper el `CHECK` de la base con un 500 crudo. Encontrado por revisión de contrato antes de construir la UI que depende de este endpoint, no por un fallo en producción.

### 16.8 Tests

Frontend (Vitest + Testing Library): protección de ruta (`ADMIN` ve la pantalla, `EMPLOYEE` ve acceso denegado, anónimo vuelve a login), listado real sin datos inventados, estados de carga/vacío/error con reintento, `AdminUserRow` mostrando la acción correcta según estado y las transiciones correctas según la matriz, `PinDialog` (4 dígitos exactos, cero inicial preservado, coincidencia de confirmación, doble envío bloqueado, limpieza en cancelar/error, foco inicial, Escape, `aria-live`, atributos del input, advertencia de revocación), `ConfirmDialog` (confirmación explícita, doble envío bloqueado, error sin JSON crudo), `AdminUsersScreen` orquestando activación/reset/cambio de estado con los mocks de `adminApi` (verificando el body exacto enviado, el refresco de la lista tras éxito ajeno, y el `logout()` tras una mutación sobre la propia cuenta), ausencia de `pinHash`/hash/JSON crudo en cualquier estado renderizado.

Backend: nuevo test de integración contra `demo` para la corrección de 14.6b/16.7 (usuario sintético `DEACTIVATED` sin `pinHash` rechaza `-> ACTIVE`, pero sí acepta `-> SUSPENDED`), más dos verificaciones explícitas que ya se cumplían por construcción pero no tenían test dedicado: un usuario `SUSPENDED` no puede iniciar sesión, y desaparece de `GET /auth/login-options` (ambas ya garantizadas por `authService.login`/`getLoginOptions` filtrando por `status: 'ACTIVE'`, sección 14.1/14.6a — esta etapa solo agregó la prueba, no cambió el comportamiento).

## 17. Sistema visual del frontend (Etapa 3E)

Reconciliación visual de las pantallas ya existentes (login, PIN, estados, Inicio temporal, acceso denegado, administración de usuarios, diálogos) con la identidad original recuperada en `docs/UI_CONTEXT.md`, que pasa a ser la fuente de verdad visual. Sin cambios de contratos API, autenticación, roles, backend ni base. Detalle de implementación (tokens, breakpoints, componentes, fuentes) en `frontend/README.md`, "Sistema visual (Etapa 3E)".

### 17.1 Decisiones

- **Tokens CSS, sin librería visual.** Todas las decisiones visuales viven en `frontend/src/styles/tokens.css` (paleta original + tokens semánticos + espaciado, radios, sombras, alturas, z-index, movimiento). Hojas por área (`base`, `components`, `app-shell`, `auth`, `home`, `admin`) importadas desde un único `global.css`. Un test estructural (`styles.test.ts`) impide colores literales fuera de los tokens. Sin CSS-in-JS ni framework de componentes: el proyecto no los tenía y las pantallas actuales no los justifican.
- **Contexto invertido por tokens.** Las superficies sobre verde bosque (`.theme-inverse`: login, splash, header, navegación) redefinen los mismos tokens semánticos en vez de tener variantes de componente duplicadas.
- **Fuentes locales.** `@fontsource/fraunces` y `@fontsource/karla`, subset latin y solo los pesos usados — el frontend no depende de Google Fonts en runtime (ni de ningún origen externo para renderizar).
- **App shell como ruta de layout** dentro de `ProtectedRoute`: solo existe con sesión. Rutas y menú salen de la misma configuración tipada (`frontend/src/routes/navigation.ts`), que también define el rol que `RequireRole` exige — el menú no puede ofrecer un destino sin ruta, ni una ruta admin-only aparecer para otro rol. El backend sigue siendo la autoridad final (§14.5).
- **Un solo `<nav>` en el DOM**, reubicado por CSS (barra inferior en móvil / sidebar en escritorio), para no duplicar enlaces ni lógica.
- **`Modal` en portal** sobre `document.body`, con foco contenido, restauración del foco al cerrar, bloqueo de scroll del fondo y sin cierre por click en el overlay (un toque accidental no descarta un PIN a medio escribir).
- **Container queries** en el listado administrativo, para que el cambio tarjetas → tabla dependa del ancho disponible (con o sin sidebar), no del viewport.
- **Ajustes de UX sin cambio funcional**: tras una mutación administrativa exitosa el listado se refresca en segundo plano (sin volver a "Cargando…"); el enlace "← Volver" de `/admin/users` se reemplazó por la navegación del shell; el botón deshabilitado por auto-bloqueo ahora tiene su explicación visible y asociada (`aria-describedby`), además del `title` que ya tenía.

### 17.2 Build de producción garantizado

Vite 8 aplica un `NODE_ENV=development` presente en un archivo `.env` al build, siempre que `process.env.NODE_ENV` no estuviera definido al empezar a resolver la configuración — comprobación que ocurre antes de cargar `vite.config.ts`, así que no puede corregirse desde la config. Como el `.env` centralizado (§11) puede definirlo para el backend, `vite build` producía el build de desarrollo de React. Decisión: `npm run build` del frontend invoca Vite desde `frontend/scripts/build.mjs`, que fija `NODE_ENV=production` antes de importarlo (Node puro: multiplataforma, sin `cross-env`, sin tocar el `.env` ni depender de la terminal de cada persona). Complemento: un plugin en `vite.config.ts` hace fallar cualquier `vite build` que no resuelva `isProduction` (p. ej. `vite build` invocado directo con ese `.env`), en vez de generar un bundle de desarrollo en silencio. `frontend/src/test/productionBuild.test.ts` reproduce la condición (`VITE_USER_NODE_ENV=development`, la variable interna que Vite deriva del `.env`) sin leer el `.env` real, y verifica ambas cosas; se comprobó que falla si se quita la línea que fija `NODE_ENV`. El backend no cambia (proceso propio; `tsx watch` sigue leyendo `NODE_ENV` del `.env`). Descartado: `envDir: false` (rompería el manejo centralizado de variables para futuras `VITE_*`) y `define` manual de `process.env.NODE_ENV` (Vite seguiría resolviendo `isProduction: false` para el resto del pipeline).

### 17.3 Seguridad

Sin cambios en el manejo de credenciales: el PIN sigue siendo `string` local de `PinEntryScreen`/`PinDialog`, con la misma limpieza, guardas de doble envío y mensajes genéricos; el access token sigue solo en memoria; `logout()` es el mismo de §15.4 (el nuevo `LogoutButton` solo evita un segundo click mientras el primero sigue en curso). `colorHex` sigue validándose antes de llegar a un `style` (movido a `frontend/src/utils/color.ts`). Ningún indicador visual del PIN depende del dígito ingresado.

### 17.4 Validación visual

jsdom no aplica CSS, así que los tests (Vitest + Testing Library) cubren semántica, estados y comportamiento, más guardas estructurales sobre las hojas de estilo; no se incorporó axe ni regresión visual por píxel. La revisión visual automatizada se hizo con Chrome headless vía DevTools Protocol en 360/390/768/1366/1920 px y en horizontal (login y PIN contra el backend real sin enviar ningún PIN; Inicio, Usuarios y diálogos con respuestas sintéticas interceptadas dentro de ese navegador descartable, sin tocar backend ni base), midiendo además overflow horizontal, objetivos táctiles < 44px y fuentes cargadas. La aprobación visual final es humana.

## 18. Módulo Tareas (Etapa 4A)

Primer módulo operativo real, de punta a punta: `backend/src/tasks/` (schemas Zod + servicio), `backend/src/controllers/tasksController.ts`, `backend/src/routes/tasksRoutes.ts`, `backend/src/lib/businessTime.ts`; frontend en `frontend/src/features/tasks/` + `frontend/src/api/tasksApi.ts`/`taskTypes.ts`. Reglas de negocio en `docs/BUSINESS_RULES.md` §2–§5; modelo y migración en `docs/DATABASE.md`, "Etapa 4A".

### 18.1 Endpoints (`/api/v1/tasks`, todos detrás de `requireAuth`)

| Método y ruta | Quién | Qué hace |
| --- | --- | --- |
| `GET /tasks?employeeId&frequency&status` | todos (`status=inactive\|all` solo ADMIN) | Tareas + ejecución vigente del período de cada una + `canComplete`/`canRevert` calculados en backend. `status=active` (default) oculta las únicas ya completadas. |
| `GET /tasks/employees` | todos | Empleados activos (id, nombre, color) para filtros, formularios y el diálogo de completado. |
| `GET /tasks/history?week=YYYY-MM-DD&employeeId` | todos | Semana lunes–domingo (cualquier día se normaliza al lunes; semanas futuras → 400). |
| `POST /tasks` | ADMIN | Crear (`description`, `employeeId`, `frequency`). |
| `PATCH /tasks/:id` | ADMIN | Editar descripción/responsable/frecuencia (solo campos presentes; `active` no se acepta acá). |
| `PATCH /tasks/:id/status` | ADMIN | `{ active }` — desactivar/reactivar. Nunca borrado físico. |
| `POST /tasks/:id/complete` | todos | EMPLOYEE: ejecutor = su empleado (otro `employeeId` → 403). ADMIN: `employeeId` del ejecutor (obligatorio si no tiene empleado propio; debe existir y estar activo). |
| `POST /tasks/:id/revert` | todos, con reglas | `{ executionId, reason? }` — ver 18.4. |

Todas las mutaciones exigen `Content-Type: application/json`, validan con Zod `.strict()` (un campo desconocido como `completedByEmployeeId` o `periodKey` → 400) y devuelven la tarea serializada. Errores propios: `TASK_ALREADY_COMPLETED` (409), `TASK_INACTIVE` (409), `TASK_EXECUTION_NOT_ACTIVE` (409), `TASK_DUPLICATE` (409, `@@unique([employeeId, description])`); nunca un error de Prisma crudo. Los permisos se deciden en `tasksService.ts` con el rol y el empleado leídos de la base (`resolveActor`: sesión → `User` → `employeeId`), no con `requireRole` por ruta, porque varias rutas sirven a ambos roles con reglas distintas.

### 18.2 Períodos y zona horaria

`computePeriodKey` (`backend/src/lib/businessTime.ts`) es la única autoridad: DAILY = fecha local, WEEKLY = lunes local, MONTHLY = primer día del mes local, URGENT = `'URGENT'`, ONE_TIME = `'ONE_TIME'`. El navegador nunca envía ni calcula un `periodKey`. La zona es `BUSINESS_TIME_ZONE` (backend, IANA, default `America/Argentina/Buenos_Aires`, validada con `Intl` al iniciar; offsets fijos como `-03:00` se rechazan). Implementado con `Intl.DateTimeFormat` sin dependencias; tests cerca de medianoche UTC, domingo→lunes y fin de mes.

### 18.3 Concurrencia

Completar corre en una transacción (lectura de la tarea, inserción de la ejecución con el snapshot `assignedEmployeeId` y auditoría). La defensa final es el índice único parcial `(task_id, period_key) WHERE reverted_at IS NULL`: si dos requests compiten, la segunda viola el índice (P2002), su transacción entera se revierte (sin auditoría huérfana) y se responde 409 `TASK_ALREADY_COMPLETED`. No hay "buscar y luego crear". Verificado con 8 finalizaciones simultáneas reales contra `demo`: 1 ejecución, 1 auditoría, 7 × 409.

### 18.4 Reversión

Nunca borra: marca la fila (`revertedAt`, `revertedByUserId`, `revertReason`, `completed=false`) con un `updateMany` condicionado a `revertedAt: null` (dos reversiones simultáneas no se aplican ambas) y libera el período para una fila nueva. EMPLOYEE: solo lo que completó él mismo y solo en el período vigente de la tarea; motivo opcional. ADMIN: cualquier ejecución vigente (también desde el historial), motivo obligatorio. Auditoría `task.completion_reverted` con `administrativeCorrection`.

### 18.5 Historial

Endpoint propio y liviano. Diarias y semanales: un slot por período con `expected` (tarea activa hoy, período ya empezado, tarea ya existente) y `completed/expected` real — corrige el 0% fijo del prototipo. Mensuales, urgentes y únicas: finalizaciones cuya fecha local cae en la semana. Solo ejecuciones vigentes; incluye tareas hoy desactivadas que tuvieron ejecuciones. El filtro por persona lo resuelve el backend (slot de quien lo tenía asignado según el snapshot, o de quien lo completó). Limitación documentada: la clasificación diaria/semanal usa la frecuencia actual de la tarea.

### 18.6 Frontend

`/tasks` para todo usuario autenticado, en la navegación con el emoji ✅ del prototipo (decorativo; nombre accesible "Tareas"). Filtros por persona (chips con avatar y pendientes, desplazables) y frecuencia (las cinco del enum) sobre la lista ya cargada; el historial pide su endpoint con la persona elegida. Sin actualizaciones optimistas: cada operación espera la respuesta real y vuelve a pedir la lista; doble envío bloqueado con guardas síncronas. EMPLOYEE completa sin diálogo y nunca envía un ejecutor; ADMIN elige el ejecutor entre empleados activos reales. Deshacer siempre pide confirmación. Un 401 que sobrevive al refresh-y-reintento de `httpClient` dispara el `logout()` existente. Sin librería nueva de datos ni de UI (solo la primitiva `Chip`).

## 19. Desempeño (Etapa 4B)

`TaskPlanningInterval` versiona responsable, frecuencia y vigencia. Crear/reactivar abre; reasignar o cambiar frecuencia cierra y abre; desactivar cierra, siempre dentro de la transacción de `Task`. Un índice parcial permite un solo intervalo abierto.

`GET /performance/summary?from&to` y `GET /performance/employees/:employeeId?from&to` aceptan hasta 90 días y usan `BUSINESS_TIME_ZONE`. ADMIN ve el equipo; EMPLOYEE queda forzado al Employee de su sesión. El backend genera ocurrencias y DTO; el frontend no recalcula métricas.

## 20. Backend base de Stock (Etapa 5A)

`/api/v1/stock` está completamente detrás de `requireAuth`. El router solo publica lecturas, altas y cambios de catálogo/estado; el historial de movimientos no tiene `PUT`, `PATCH` ni `DELETE`.

| Operación | Permiso |
| --- | --- |
| listar/detallar productos, categorías activas, destinos activos e historial | todo usuario autenticado |
| ver catálogo inactivo | solo `ADMIN` |
| crear/editar/desactivar categorías y productos | solo `ADMIN` |
| `INCOME` y `CONSUMPTION` | `ADMIN` y `EMPLOYEE` (este último requiere empleado activo vinculado) |
| `ADJUSTMENT_INCREASE` y `ADJUSTMENT_DECREASE` | solo `ADMIN` |

Los schemas Zod son estrictos: el movimiento no acepta `employeeId`, `stockItemId`, saldo, área ni estado. La identidad se resuelve desde la sesión y la base. Los decimales viajan como strings canónicos y se convierten a `Prisma.Decimal`; el saldo se devuelve y audita como string, sin `number`/`Float`.

Cada movimiento ejecuta en una sola `prisma.$transaction`: actualización condicional del saldo, creación de `StockMovement` y creación de `AuditLog`. Los consumos/ajustes a la baja usan `updateMany` con `currentQuantity >= quantity`; los ingresos/ajustes al alta usan incremento atómico con límite `99999999.99`. Esto evita saldos negativos, incrementos perdidos y overflow de `Decimal(10,2)`. Una falla posterior revierte las escrituras anteriores.

La fecha efectiva se interpreta como fecha de calendario en `BUSINESS_TIME_ZONE`: nunca futura, hoy para `EMPLOYEE`, pasada permitida solo a `ADMIN`. `@db.Date` persiste la fecha sin hora. El destino es opcional durante 5A porque `demo` no tiene destinos reales y el CRUD se difiere; si se informa, el backend exige que exista, esté activo y que el movimiento sea `CONSUMPTION`.

No hubo cambio de `schema.prisma` ni migración: el modelo creado en Etapa 2 y migrado en 3A ya soporta este contrato. 5A no incluye frontend, reportes, compras ni administración de destinos.

## 21. Stock — destinos, nivel server-side e idempotencia (Etapa 5C.1)

Extiende el contrato de §20 sin romperlo. Los nuevos endpoints siguen detrás de `requireAuth` y la decisión de permiso sigue viviendo en `stockService.ts`:

| Operación | Permiso |
| --- | --- |
| `GET /stock/destinations?status=active\|all` (`all` muestra inactivos) | todo autenticado / `all` solo `ADMIN` |
| `POST /stock/destinations` | solo `ADMIN` |
| `PATCH /stock/destinations/:id` (nombre y/o estado; `type` inmutable) | solo `ADMIN` |
| `GET /stock/items?stockLevel=ok\|low\|critical` | todo usuario autenticado (mismo gate que el listado) |
| `POST /stock/items/:id/movements` con header opcional `Idempotency-Key` | igual que 5A |

**Sin borrado físico de destinos**: el router no declara `DELETE` en ningún recurso de stock; la baja de un destino es `PATCH { active: false }`, siempre permitida (los `StockMovement` históricos conservan su FK con `ON DELETE RESTRICT`). Auditorías con acciones separadas: `stock.destination.created`, `stock.destination.updated`, `stock.destination.status_changed`.

**Filtro de nivel en Postgres**: Prisma no puede expresar comparaciones columna-vs-columna (`current_quantity < minimum_quantity`) en su `where`, así que `listStockItems` resuelve los ids del nivel con un `prisma.$queryRaw` parametrizado (`backend/src/stock/stockLevel.ts` — el único módulo que define la regla, compartido por el DTO, el SQL y el fake de tests) y aplica sobre esos ids el resto de los filtros, el conteo, el orden enum y la paginación, que siguen yendo a Postgres. Nunca se carga el inventario completo para filtrar en memoria. El DTO de producto incluye `stockLevel` calculado en el backend; `barPercent` de la barra visual sigue siendo una responsabilidad del frontend (decisión aprobada en 5C.1).

**Idempotencia opcional**: `Idempotency-Key` (`^[A-Za-z0-9_-]{8,64}$`) en `POST /stock/items/:id/movements`. La tabla `idempotency_records` guarda (actor, endpoint lógico, clave) como único, con `request_hash` (SHA-256 de una serialización canónica de orden fijo: endpoint, producto, tipo, cantidad decimal, fecha efectiva resuelta en `BUSINESS_TIME_ZONE`, destino y motivo) y `response_status`/`response_body`/`completed_at`. El flujo en UNA transacción: INSERT de reserva (primero) → actualización condicional del saldo → `StockMovement` → `AuditLog` → respuesta armada → UPDATE de completitud. Si la transacción falla en cualquier paso, no sobrevive ningún registro incompleto. Creación y replay responden `201` con el mismo contrato público `{ movement, item }`; el controller descarta el discriminante interno `kind` y nunca expone `requestHash` ni el registro. Los UUID del producto y del destino se canonicalizan en minúsculas en el endpoint lógico y en la huella. Un `P2002` se trata como idempotencia solo si identifica exactamente el unique de reserva (con Prisma 7 + `@prisma/adapter-pg` la identidad llega como `meta.driverAdapterError.cause.constraint.index = "idempotency_records_actor_user_id_endpoint_key_key"`, verificado contra `adapter-pg@7.10.0`; la forma `meta.target` de otros engines también se acepta; un `P2002` sin identidad se propaga) y se lee el registro una vez, después del rollback del perdedor: existe → replay/conflicto/pendiente según su estado y huella; no visible → `409 IDEMPOTENCY_RECORD_PENDING`, sin reintento ciego. La transacción tiene timeout acotado y un `P2002` de otro unique se propaga sin convertirse en replay. No hay caché en memoria ni reutilización de `StockMovement.reference`. La purga de registros viejos NO existe en esta etapa: hay índice sobre `created_at` para el futuro proceso y la deuda está documentada en `docs/DATABASE.md`.

**Errores nuevos**: `409 STOCK_DESTINATION_DUPLICATE`, `400 IDEMPOTENCY_KEY_INVALID`, `409 IDEMPOTENCY_KEY_CONFLICT`, `409 IDEMPOTENCY_RECORD_PENDING` (todos operacionales, con código estable).

**Migración**: `20260924210000_stock_idempotency_balance_check` — tabla `idempotency_records` + índices + FK `RESTRICT` generados offline con `prisma migrate diff` entre dos archivos de schema, más un `CHECK (current_quantity >= 0)` agregado a mano (piso de defensa en profundidad de la invariante de saldo no negativo; la garantía frente a concurrencia sigue siendo la actualización condicional de §20). **Estado**: aplicada a `demo` el 2026-09-25 (Etapa 5C.1C) con `db:migrate:deploy`, tras verificar la precondición (0 saldos negativos); `production` no se tocó. Nunca `db push`, reset ni seed.

**Transacciones interactivas y `pg`**: dentro de un `$transaction` interactivo las consultas van **secuenciales** (nunca `Promise.all` sobre `tx`): la transacción usa una sola conexión y `pg` depreca (`pg@9` elimina) consultas concurrentes sobre el mismo cliente. Detectado en la integración real de 5C.1C; el fake de tests rechaza consultas solapadas dentro de una transacción.
