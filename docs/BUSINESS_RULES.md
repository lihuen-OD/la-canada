# BUSINESS_RULES.md — Reglas de negocio extraídas de `index.html`

> Convención de este documento: cada regla cita la(s) función(es) o línea(s) de `index.html` donde se comprobó. Cuando una regla parece incompleta, contradictoria o no verificable solo con lectura estática, se marca explícitamente con **⚠️ DUDA** o **⚠️ INCONSISTENCIA**. Nada de lo marcado así debe tratarse como comportamiento definitivo hasta que un humano lo confirme.
>
> **Nota (Etapa 2.3)**: `index.html` fue retirado del repositorio (contenía credenciales reales de Supabase — ver `docs/SECURITY.md`). Las citas de línea de este documento quedan como registro histórico de la auditoría; ya no corresponden a un archivo presente en el repo.

## 1. Roles y permisos

- Dos roles: `admin` y `user` (equipo de trabajo). `isAdmin()` → `currentRole === 'admin'` (línea 3889).
- Elementos con clase `admin-only` se ocultan/muestran por JS según rol (`applyRoleUI()`, línea 3842; también recalculado en `rndMascotaDetalle()` línea 2496 y `rndMas()` línea 3884).
- Acciones **restringidas a admin** (botón condicionado a `isAdmin()` en el render):
  - Crear/editar/eliminar tareas (`+ Nueva tarea`, ✏️/✕ en lista de tareas).
  - Crear/editar/eliminar/dar de baja personas.
  - Crear/editar ítems de stock, ajustar stock por el badge de estado, gestionar categorías y destinos.
  - Crear/editar/eliminar eventos.
  - Alta de tipos de mascota; edición de ficha de mascota; eliminación de registros clínicos.
  - Alta/baja de gallinas (`ajustarGallinas`, botones "+ Alta"/"− Baja" con clase `admin-only`).
  - Ver panel "Cumplimiento por persona" y "Tareas más incumplidas" en Desempeño.
  - Ver "Configuración" y "Datos del equipo".
  - Cambiar el PIN de admin y el PIN de cualquier persona (desde Configuración → Personas).
  - **Actualización Etapa 3B.2**: se preserva "cambiar el PIN de cualquier persona es admin-only", pero se corrige deliberadamente un punto distinto — en el prototipo (`docs/PROJECT_CONTEXT.md`, sección de flujo de acceso) el PIN de un empleado *se definía solo, la primera vez que lo usaba*, sin intervención del admin. La reconstrucción no reproduce eso: el PIN inicial también lo asigna el administrador, al activar la cuenta (`POST /admin/users/:id/activate`) — un empleado nunca define ni cambia su propio PIN, ni siquiera la primera vez. Se documenta como una desviación intencional del comportamiento original (no un bug de esta etapa): asignar el PIN inicial es más consistente con el resto del modelo (el admin ya controla activación/estado/roles) y evita el caso sin trazar de "¿quién eligió este PIN?".
  - **Actualización Etapa 3D**: la regla anterior ya no es solo un contrato de backend sin interfaz — `/admin/users` (frontend) es hoy la única forma real de ejercerla: activar con PIN, cambiar PIN, suspender/reactivar/deshabilitar, todo exclusivo de `ADMIN` y protegido tanto en el frontend (ruta + rol) como, con autoridad final, en el backend (igual que antes). Sigue sin existir ningún camino, en ningún lado de la interfaz, para que un `EMPLOYEE` cambie su propio PIN. Un `ADMIN` tampoco puede, desde esta pantalla, dejar al sistema sin ningún administrador activo (mismo auto-bloqueo del backend, reflejado también como UX preventiva en el frontend).
- Acciones disponibles para **cualquier usuario logueado** (admin o equipo):
  - Tildar/destildar tareas propias; tildar tareas de otra persona (dispara el flujo "¿Quién completa esta tarea?", ver sección 4).
  - Registrar consumo/ingreso de stock (botón 📤 en cada ítem, sin gate de admin).
  - Registrar novedades.
  - Registrar recolección de huevos.
  - Registrar (no eliminar) registros clínicos de mascotas.
  - Subir fotos.
  - Editar su propio perfil ("Mi perfil") y sus hijos.
- **⚠️ INCONSISTENCIA — Eliminar fotos no está restringido a admin.** `verFoto()` (línea 1672) renderiza el botón "🗑 Eliminar" para cualquier usuario logueado, sin chequear `isAdmin()`, a diferencia de tareas/eventos/personas donde el botón de borrado ni siquiera se renderiza para el rol `user`. Cualquier persona del equipo puede borrar cualquier foto (propia o de otra persona).
- **⚠️ DUDA — No hay tercer nivel de "empleado ve solo lo suyo".** Un usuario `user` puede ver tareas y avance de *todas* las personas (los filtros de personas en Tareas no distinguen "mis tareas" por defecto), y puede completar tareas ajenas (con registro de quién la completó). No se detectó ninguna restricción que oculte datos de otras personas a un usuario no-admin, salvo los paneles admin-only de Desempeño y Configuración.
- La autorización es enteramente client-side (una variable JS). Ver `docs/SECURITY.md` para el riesgo de esto — no se debe interpretar como control de acceso real a nivel de datos.

## 2. Tareas y frecuencias

- Cinco frecuencias válidas (`<select id="t-frec">`, línea 848): `diaria`, `semanal`, `mensual`, `urgente`, `unica` ("Una vez").
- Cada tarea (`tareas`) tiene: descripción (`d`), persona asignada (`pid`), frecuencia (`frec`). **No tiene** campo de estado activo/inactivo pese a que otra parte del código lo asume (ver sección 6, ⚠️ INCONSISTENCIA).
- Orden de visualización fijo por frecuencia: urgente → única → diaria → semanal → mensual (`frecOrden`, línea 1216).
- Las tareas de frecuencia `unica` que ya están completadas se ocultan de la lista principal y solo quedan visibles en el historial semanal (línea 1219).

## 3. Cálculo de períodos (recurrencia)

Función `getPeriodo(frec)` (línea 1115) — determina a qué "instancia" de la tarea corresponde el estado de completado actual:

- **Diaria** → el período es la fecha de hoy (`YYYY-MM-DD`). Se resetea todos los días.
- **Semanal** → el período es la fecha del **lunes** de la semana actual (semana definida lunes a domingo). Se resetea cada lunes.
- **Mensual** → el período es el primer día del mes actual (`YYYY-MM-01`). Se resetea el día 1 de cada mes.
- **Urgente** → no tiene período variable; usa el string fijo `'urgente'`. Una vez completada, permanece completada indefinidamente (no hay lógica de reseteo visible) salvo que se destilde manualmente o se elimine la tarea.
- **Única** → string fijo `'unica'`; comportamiento de completado permanente igual que urgente.

Cada combinación tarea+período tiene a lo sumo una fila en `ejecuciones` (`getEj`, línea 1136).

## 4. Cumplimiento de tareas ("completado por")

- `togTarea(id)` (versión activa, línea 2007): si el usuario logueado es distinto de la persona asignada a la tarea Y la está marcando como hecha (no destildando), se abre un modal "¿Quién completa esta tarea?" (`mo-compby`) donde se elige quién la completó realmente y una nota opcional (línea 2011-2026).
- Si el usuario asignado la completa él mismo, o si se está destildando, se guarda directo sin modal.
- El campo `compPid` (completado por) y `nota` quedan en la fila de `ejecuciones`. En el listado de tareas e historial se muestra "✓ por <Nombre>" cuando `compPid` difiere del asignado original (líneas 1248-1252, 1301-1305).
- **⚠️ DUDA** — Si `currentRole==='admin'` y no hay `currentUser` (login como Administrador, sin persona asociada), `compPid` se guarda como `null` (línea 1899: `currentUser ? currentUser.id : null`). No queda registrado *qué admin* completó la tarea, solo que "fue completada" — no hay identidad individual para el rol admin.

**Actualización Etapa 2 (revisión correctiva)**: el prototipo solo guarda `compPid` ("quién completó"), sin registrar por separado "a quién estaba asignada la tarea en ese momento" — un dato que se pierde apenas se reasigna la tarea (`Task.pid` cambia y no hay rastro de la asignación anterior). El nuevo modelo (`backend/prisma/schema.prisma`, `TaskExecution`) corrige esto agregando `assignedEmployeeId` (snapshot obligatorio e inmutable de a quién estaba asignada la tarea al crear la ejecución) **separado** de `completedByEmployeeId` (equivalente al `compPid` del prototipo). Detalle completo en `docs/DATABASE.md`, "Historial de asignación de tareas".

## 5. Historial

- Historial semanal (`rndHistorial()`, línea 1261) muestra únicamente tareas de frecuencia `diaria` y `semanal` (las mensuales/urgentes/únicas no aparecen ahí).
- Cubre las **últimas 8 semanas** (`getSemanas()`, línea 1184), seleccionables por un `<select>`.
- Calendario mensual en Configuración (`rndCal()`, línea 1676) marca visualmente los días que "tendrían" tareas según una heurística: diaria siempre, semanal en días hábiles (lunes a viernes), mensual el día 1 (línea 1685). **⚠️ DUDA** — esta heurística no refleja el cálculo real de `getPeriodo` (que ancla la semanal al lunes específico, no a "todo día hábil"); es solo un indicador visual aproximado, no una fuente de verdad de cumplimiento.

### Actualización Etapa 4A — reglas implementadas de Tareas (§2–§5)

Implementado en `backend/src/tasks/tasksService.ts` (detalle técnico en `docs/ARCHITECTURE.md` §18). Diferencias deliberadas respecto del prototipo, aprobadas por el usuario:

- **Visibilidad**: todo usuario autenticado ve las tareas activas de todas las personas (igual que el prototipo, ver ⚠️ DUDA de §1 — sin cambios). Solo `ADMIN` ve desactivadas.
- **Administración**: crear, editar (descripción, responsable, frecuencia), desactivar y reactivar son exclusivos de `ADMIN`. Sin borrado físico (el prototipo borraba la tarea y sus ejecuciones).
- **Quién completó**: un `EMPLOYEE` siempre queda registrado como ejecutor (sale de su sesión; no puede elegir a otra persona). Puede completar tareas asignadas a otra persona si las hizo él — reemplaza el modal "¿Quién completa esta tarea?" del prototipo, que permitía elegir a cualquiera. Un `ADMIN` sí elige el ejecutor (empleado activo) y queda como actor en la auditoría — corrige la ⚠️ DUDA de §4 (`compPid = null` para el admin). Sin nota opcional en esta etapa (el campo `note` del modelo queda sin usar).
- **Reversión** (el prototipo solo "destildaba"): nunca borra; queda marcada y auditada. Un `EMPLOYEE` solo deshace lo que completó él y solo en el período vigente, motivo opcional; un `ADMIN` corrige cualquier ejecución con motivo obligatorio.
- **Urgentes y únicas**: una sola finalización vigente (clave fija `URGENT`/`ONE_TIME`); una urgente completada sigue visible como completada; una única completada sale del listado operativo (como en el prototipo), se conserva en base, aparece en el historial de la semana en que se completó y un `ADMIN` la ve con "Incluir desactivadas y únicas ya completadas".
- **Historial**: semana lunes–domingo con selector de 8 semanas (como el prototipo), pero incluye todas las frecuencias (diarias/semanales por período; mensuales, urgentes y únicas por fecha de finalización) y un conteo realizadas/esperadas real.
- **Períodos**: misma estrategia que §3, calculada solo en el backend y en la zona horaria de negocio (`BUSINESS_TIME_ZONE`, Argentina), nunca en el navegador ni en UTC.
- **Desempeño (§6)**: sigue sin implementarse — Etapa 4B.

## 6. Desempeño (⚠️ módulo con lógica rota, verificado en código)

- Panel "Desempeño" dentro de Tareas, con períodos seleccionables de 7/14/30 días (`desempPeriodo`).
- **Estrella de la semana**: persona activa con más tareas completadas en el período (`rndDesempeno()`, línea 3559-3602).
- **Ranking**: todas las personas activas ordenadas por cantidad de tareas completadas en el período, con medallas 🥇🥈🥉 y racha de días consecutivos (🔥).
- **Racha** (`calcRacha`, línea 3538): cuenta días consecutivos con al menos una tarea completada por esa persona, mirando hasta 30 días atrás.
- **Cumplimiento por persona (%)** y **Tareas más incumplidas** (solo admin): comparan tareas completadas contra tareas "esperadas" en el período.
- **⚠️ INCONSISTENCIA / BUG VERIFICADO**: tanto `calcRacha` (línea 3540: `tareas.filter(function(t){return t.pid===pid&&t.activa;})`) como `rndDesempeno` (línea 3565: `t.pid===p.id&&t.activa&&...` y línea 3644 para "tareas más incumplidas") filtran por `t.activa`. Pero **ningún objeto de `tareas` tiene jamás el campo `activa`** — ni el literal inicial (línea 934), ni el mapeo desde Supabase en `loadAll()` (línea 1793: `{id:r.id,d:r.descripcion,pid:r.persona_id,frec:r.frecuencia}`), ni `dbAddTarea`/`dbUpdateTarea`. Como resultado, `t.activa` es siempre `undefined` (falsy), por lo que:
  - `calcRacha()` siempre devuelve `0` → la racha 🔥 nunca se muestra.
  - `misTareas` en `rndDesempeno()` siempre es un array vacío → `esperadas` siempre es `0` → el porcentaje de cumplimiento por persona siempre da `0%`.
  - La lista de "tareas más incumplidas" siempre está vacía (el filtro `t.activa` la vacía antes de llegar al filtro de incumplimiento).
  - El **ranking** y la **estrella de la semana** sí funcionan, porque no dependen de `t.activa`.
  - Esto debe tratarse como un defecto del prototipo a corregir en la reconstrucción, **no** como una regla de negocio real ("cumplimiento siempre 0%" no es una regla intencional).
- **Actualización Etapa 2**: `backend/prisma/schema.prisma` ya define `Task.active` (`Boolean @default(true)`) — el campo que el prototipo esperaba pero nunca tuvo. Esto resuelve la causa estructural del bug a nivel de modelo de datos; el desempeño en sí (cálculo de racha, % de cumplimiento) se **recalculará desde `TaskExecution` reales** cuando se implemente el servicio correspondiente (Etapa 5), no se porta la lógica rota del prototipo.

## 7. Stock — mínimo, estados y cálculo

- Cada ítem de stock (`sCasa`/`sJardin`) tiene: nombre, stock actual, stock mínimo, unidad, categoría.
- Estado (`sStatus`, línea 1014):
  - `crit` (crítico) si `stock <= 0`.
  - `low` (bajo) si `stock < min`.
  - `ok` en cualquier otro caso (incluido `stock === min`, que cuenta como OK).
- Porcentaje de barra visual (`sPct`, línea 1015): `min(100, round(stock / (min*2) * 100))`. Si `min` es `0`, se muestra `100%` sin importar el stock. **⚠️ DUDA** — un ítem con `min:0` nunca puede aparecer como bajo/crítico salvo `stock<=0` (crítico), independientemente de cuánto stock tenga; es una regla implícita del cálculo, no declarada en ningún lado como tal.
- Las cantidades de stock admiten decimales (`parseFloat`, `step` en inputs) — no están limitadas a enteros, salvo huevos y gallinas que usan `parseInt`.
- **Actualización Etapa 5C.1**: esta misma regla de estado está implementada en el backend (`backend/src/stock/stockLevel.ts`, única definición compartida por DTO y filtro SQL) y documentada en §8, "Contrato implementado en Etapa 5C.1A/5C.1B", incluida la interpretación de la DUDA de `min:0` con saldo `0`.

## 8. Ingresos y consumos de stock

- Modal único "Registrar movimiento" (`mo-consumo`) con dos modos, `tipoMov`: **consumo** (resta stock) o **ingreso** (suma stock) (`setTipoMov`, `guardarConsumo`, líneas 3002-3111).
- El consumo no puede dejar el stock negativo (`Math.max(0, ...)`, línea 3085).
- Todo movimiento pide: cantidad, fecha, persona (o "🔐 Administrador" si el select se deja en `0`), destino opcional (vehículo o sector) y motivo/observación opcional.
- Toda edición de un ítem de stock que cambie la cantidad actual (`gItem()`, admin) genera automáticamente un registro en `consumos` con motivo `"Ajuste a la baja: -X <u>"` o `"Ajuste al alta: +X <u>"`, prefijado con `[Admin] ` si no hay persona logueada asociada (líneas 1500-1531). Esto asegura que **todo cambio de cantidad queda trazado** en el historial de consumos, incluso los hechos "a mano" desde el formulario de edición.
- Existe un destino especial autogenerado **"Ajuste de inventario"** (tipo `sector`), creado la primera vez que hace falta (`ensureAjusteDestino()`, línea 1749, invocado en `initUI()`) para asociar esos ajustes automáticos.
- Reportes de consumo (`rndReportes()`, línea 3263): agregan por destino, por persona y por ítem, en un rango de fechas configurable (chips de 7/30/90/365 días o fechas manuales), con exportación a CSV (`exportarCSV()`, línea 3402).

### Contrato implementado en Etapa 5A

- Todos los usuarios autenticados consultan catálogo e historial; `EMPLOYEE` registra `INCOME` y `CONSUMPTION`; solo `ADMIN` registra `ADJUSTMENT_INCREASE`/`ADJUSTMENT_DECREASE` y administra categorías/productos. El responsable sale de la sesión, nunca del body.
- `quantity` es texto decimal positivo, con hasta 8 enteros y 2 decimales. La dirección la determina `type`, nunca un número negativo. `OPENING_BALANCE` queda reservado al seed. `minimumQuantity`, en cambio, es un umbral no negativo y admite `0`, coherente con la regla de barra de §7.
- Un producto nuevo empieza en saldo `0`; la primera carga operativa es un `INCOME`. No hay edición directa de `currentQuantity`, ni actualización/eliminación de movimientos, ni borrado físico de catálogo.
- Saldo, movimiento y `AuditLog` se confirman en una única transacción. Las reducciones usan `UPDATE ... WHERE current_quantity >= quantity`; los incrementos son atómicos y controlan el máximo de `Decimal(10,2)`.
- Nunca se aceptan fechas futuras. `EMPLOYEE` solo opera en la fecha actual de `BUSINESS_TIME_ZONE`; `ADMIN` puede registrar una fecha pasada.
- El destino sigue siendo opcional porque el seed real contiene cero destinos y 5A no incorpora su CRUD. Si se envía, debe existir, estar activo y acompañar exclusivamente a un `CONSUMPTION`; ingresos y ajustes no lo admiten. Es una transición hasta la etapa administrativa de destinos.

### Contrato implementado en Etapa 5C.1A/5C.1B

- **Nivel de stock server-side (decisión aprobada)**: el backend calcula `stockLevel` (`ok`/`low`/`critical`) con la misma regla de §7 y lo devuelve en el DTO de producto; el frontend sigue calculando solo su `barPercent` visual (la fórmula de §7, sin cambios). `GET /api/v1/stock/items` acepta el filtro `stockLevel`, resuelto en Postgres con SQL parametrizado (la comparación `current_quantity < minimum_quantity` es columna-vs-columna y Prisma no la expresa en su `where`); la paginación se aplica después del filtro y el conteo sigue siendo server-side.
  - Prioridad de ramas idéntica a §7: `critical` si `saldo <= 0`; `low` si `saldo > 0 y saldo < mínimo`; `ok` si `saldo > 0 y saldo >= mínimo` (la igualdad con el mínimo es `ok`).
  - **Interpretación documentada de la DUDA de §7**: un producto con `(saldo = 0, mínimo = 0)` cae en `critical` (la rama de saldo no positivo tiene prioridad). La afirmación "mínimo cero con stock no negativo = ok" queda reservada para `saldo > 0`, que es como la fórmula de la barra (`sPct`) lo renderiza.
  - Los productos inactivos conservan su nivel matemático; el estado administrativo se combina con el filtro `status` como cualquier otro.
- **Compras = vista derivada (decisión aprobada)**: la lista de compras del prototipo (`rndCompras()`, §20) no crea tabla ni endpoint propio — se arma con `GET /stock/items?stockLevel=low` + `stockLevel=critical` (ambas áreas) sobre productos activos, agrupable por categoría o estado en el cliente.
- **Alertas de stock no persistidas (decisión aprobada)**: no hay tabla de alertas ni notificaciones; el "estado crítico/bajo" vive en el nivel calculado y en los filtros. Si se desea avisar, será derivado al mostrar, no almacenado.
- **CRUD de destinos sin borrado físico (decisión aprobada)**: `POST /stock/destinations` y `PATCH /stock/destinations/:id` son exclusivos de `ADMIN`. No existe `DELETE`: la baja es inactivación (`active: false`), siempre permitida, incluso con movimientos históricos que referencian al destino (esos `StockMovement` no se tocan). `type` es inmutable; el `name` es único global y renombrar está permitido y auditado. `GET /stock/destinations` admite `status=active|all` (`all` es de `ADMIN`, igual que categorías). Auditorías: `stock.destination.created`, `stock.destination.updated` (cambio de nombre) y `stock.destination.status_changed` (cambio de estado, acción separada — un PATCH que cambia ambos deja dos filas).
- **Idempotencia `Idempotency-Key` opcional en `POST /stock/items/:id/movements` (decisión aprobada — 5C.2 la hará obligatoria en el frontend)**: header con formato `^[A-Za-z0-9_-]{8,64}$`. Con clave: la reserva del registro, la actualización de saldo, el `StockMovement`, su `AuditLog` y la respuesta almacenada viven en una única transacción — o todo confirma o nada queda. El replay devuelve exactamente el status y el body originales (`201`), sin nuevo saldo, movimiento ni auditoría. Sin clave: comportamiento idéntico al de 5A, sin registro alguno.
  - Mismo (actor, endpoint, clave) con cuerpo distinto → `409 IDEMPOTENCY_KEY_CONFLICT`; clave mal formada → `400 IDEMPOTENCY_KEY_INVALID`; clave con transacción aún no confirmada (estado inesperado) → `409 IDEMPOTENCY_RECORD_PENDING`, nunca se reejecuta a ciegas.
  - La huella (`requestHash`) es SHA-256 sobre una serialización canónica con orden fijo: endpoint lógico, `itemId`, tipo, cantidad normalizada a dos decimales, fecha efectiva **ya resuelta** en `BUSINESS_TIME_ZONE`, `destinationId` y motivo normalizado por Zod. Los opcionales omitidos/`undefined` se representan como `null`; `null` explícito y string vacío son inválidos en el request, no variantes equivalentes. No incluye secretos ni aleatoriedad.
  - Para `EMPLOYEE` que omite `effectiveDate`, la fecha resuelta del día de negocio forma parte de la huella: la misma clave reintentada el mismo día hace replay; reutilizada después del cambio de día produce `409 IDEMPOTENCY_KEY_CONFLICT` y nunca repite silenciosamente el movimiento anterior.
  - Los UUID (producto de la ruta y `destinationId`) se canonicalizan en minúsculas tanto en el endpoint lógico como en la huella: el mismo producto escrito con otra capitalización no abre una segunda reserva ni una segunda escritura.
  - Creación y replay responden `201` con el mismo contrato público `{ movement, item }` (sin `kind`, `requestHash` ni datos del registro). El body del replay es el almacenado en `response_body` (JSONB): semánticamente idéntico al original, aunque Postgres puede devolver las claves JSON en otro orden. El `item` refleja el saldo al momento de la creación, no el actual.
  - Límite conocido y seguro: las validaciones de fecha (no futura; `EMPLOYEE` solo hoy) corren antes de la reserva. Un `EMPLOYEE` que envía explícitamente la fecha de hoy y reintenta después del cambio de día recibe `403` en lugar del replay — nunca una segunda escritura. El frontend actual no envía `effectiveDate` para `EMPLOYEE`, así que ese caso solo aplica a clientes externos.
  - Un error de negocio dentro de la transacción (saldo insuficiente, producto inactivo, etc.) revierte también la reserva: la clave queda libre y un reintento posterior se evalúa de nuevo. Los errores no se almacenan para replay.
  - Sin caché en memoria; la colisión concurrente la resuelve el índice único de Postgres. No se reutiliza `StockMovement.reference` (clave natural reservada al seed).

## 9. Gallinero

- Un único contador global de "gallinas activas" (`gallinasActivas`), ajustable ±1 por vez por un admin, con confirmación (`ajustarGallinas`, línea 2300). **⚠️ DUDA / RIESGO** — el ajuste solo persiste en Supabase si ya existe una fila en la tabla `gallinero` (`if (gallineroId) {...}`, línea 2306); si no existe ninguna fila todavía, el cambio se aplica solo en memoria y se pierde al recargar la página. No hay lógica de "crear la fila si no existe".
- Recolección diaria: huevos buenos + huevos rotos, persona que recolectó, fecha, observación opcional (`addRecoleccion`, línea 2313).
- **Postura del día** = `round(huevos_buenos_hoy / gallinas_activas * 100)` (línea 2184).
- **Postura media del período** = `round(total_buenos_período / (gallinas_activas * días_con_datos) * 100)` (línea 2193) — nota: usa el conteo *actual* de gallinas activas para todo el período, no el histórico (si la cantidad de gallinas cambió durante el período, la postura media queda distorsionada). No hay tracking histórico de cuántas gallinas había en cada fecha.
- Historial agrupado por fecha, con total de buenos/rotos y % de postura por día.
- **⚠️ BUG VERIFICADO** — `rndGallHistorial()` (línea 2270) referencia `DIAS_ES[d.getDay()]`, una variable que **no está declarada en ningún lugar del archivo** (el archivo define `DIAS`, `DIAS2`, `DIAS3`, pero no `DIAS_ES`). Esto debería producir un `ReferenceError` en tiempo de ejecución cada vez que se intenta renderizar el historial del gallinero con al menos un registro. No se ejecutó el archivo en navegador para confirmar el efecto exacto (p. ej. si rompe solo esa función o interrumpe el render de toda la pantalla); se deja como hallazgo a verificar en la etapa de reconstrucción, no como comportamiento asumido.

## 10. Producción de huevos

Ver sección 9 — está integrada al módulo Gallinero, no es un módulo separado en el código.

## 11. Mascotas

- Cada mascota (`mascotas`): nombre, tipo (de un catálogo `tiposMascota`), raza opcional, fecha de nacimiento opcional, foto opcional (URL, no upload de archivo — a diferencia del módulo Fotos), activa.
- El catálogo de tipos es extensible por el admin (`guardarTipoMascota`, `eliminarTipo`) contra la tabla `tipos_mascota`; los tipos "built-in" (`Perro, Gato, Caballo, Burro, Guinea, Pato, Pavo real, Gallina, Faisán`) no se pueden eliminar desde la UI de gestión de tipos (línea 2638, comparación contra array `builtin` hardcodeado ahí mismo — **duplica** la lista inicial de `tiposMascota` en dos lugares del código).
- Edad (`calcEdad`, línea 2391) y próximo cumpleaños (`calcProxCumple`, línea 2403) se calculan a partir de `fechaNac`.
- Alta automática de evento "Cumpleaños" al cargar/editar una mascota con fecha de nacimiento (`autoAddCumpleMascota`, línea 2620).

## 12. Registros clínicos

- Tipos: `vacuna`, `peso`, `desparasitacion`, `chequeo` (chequeo sanitario), `evento` (evento clínico genérico).
- Solo el tipo `peso` pide un valor numérico (kg); el resto solo descripción libre.
- KPIs por mascota: cantidad de vacunas, último peso registrado, cantidad de desparasitaciones, días al próximo cumpleaños.
- Alta disponible para cualquier usuario logueado; **eliminación restringida a admin** (`delRegistro`, botón condicionado a `isAdmin()` en línea 2547).

## 13. Eventos

- Tipos: `visita`, `cumple` (cumpleaños), `mant` (mantenimiento), `otro`.
- CRUD completo, restringido a admin salvo la creación automática de cumpleaños (ver siguiente sección).
- Filtro por tipo; se separan visualmente "Próximos" y "Pasados" según la fecha respecto a hoy.

## 14. Cumpleaños

Tres orígenes distintos de eventos tipo `cumple`, todos automáticos:

1. **Familia** — hardcodeados en `addFamilyBirthdays()` (línea 1759): Benjamín (16/09), Vicky (10/03), Felicitas (01/06). Se recalcula la próxima fecha cada vez que se corre la función y se evita duplicar por título+tipo.
2. **Empleados** — al guardar "Mi perfil" con fecha de nacimiento, o al cargarla por primera vez (`autoAddCumpleEmpleado`, línea 2973).
3. **Hijos de empleados** — al agregar un hijo con fecha de nacimiento (`guardarHijo` → `autoAddCumpleEmpleado`, línea 2918-2923, reutiliza la misma función que empleados).
4. **Mascotas** — al cargar fecha de nacimiento de una mascota (`autoAddCumpleMascota`, línea 2613/2620).

**⚠️ INCONSISTENCIA VERIFICADA — dato de cumpleaños duplicado y contradictorio para "Benjamín".** El array literal inicial `eventos` (línea 995-999) incluye `{titulo:'Cumpleaños de Benjamín', fecha:'2026-02-19', tipo:'cumple', nota:''}`. Pero `addFamilyBirthdays()` calcula la fecha de Benjamín como **16 de septiembre** (mes 9, día 16), con título `'🎂 Cumpleaños de Benjamín'` (con emoji) y nota `'familia'`. Son dos fechas de nacimiento distintas para la misma persona, en dos lugares distintos del código, con formato de título distinto (con/sin emoji) que además evita que se reconozcan como duplicados entre sí (la deduplicación compara por título exacto). **Se requiere una decisión humana**: ¿cuál es la fecha real de cumpleaños de Benjamín — 19/02 o 16/09? Ver también `docs/DATA_INVENTORY.md`.

**Actualización Etapa 2**: se modeló `RecurringBirthday` (mes+día, recurrencia calculada dinámicamente, nunca una fecha con año fijo) para los cumpleaños familiares sin entidad propia en el sistema — Vicky y Felicitas ya están sembrados ahí (`backend/prisma/seed-data/recurringBirthdays.ts`). **Benjamín sigue sin sembrarse, en ninguna de las dos fechas**, hasta que esta inconsistencia se resuelva con una persona — la omisión está documentada explícitamente en el código (`OMITTED_BENJAMIN_BIRTHDAY`) y en `docs/SEED_MANIFEST.md`. Los cumpleaños de empleados e hijos (orígenes 2 y 3 de esta lista) no necesitan un `RecurringBirthday` propio: se calculan directamente desde `EmployeeProfile.birthDate` / `EmployeeChild.birthDate`, ya modelados. El de mascotas (origen 4) se calculará desde `Animal.birthDate` cuando exista.

## 15. Empleados (ficha de datos)

- Datos por persona (tabla futura `empleados_datos`): nombre completo, fecha de nacimiento, estado civil, teléfono, CUIL, obra social, contacto de emergencia (nombre + teléfono).
- Autogestionable por el propio empleado desde "Mi perfil"; visible en modo lectura para el admin desde "Datos del equipo", con filtro completos/incompletos (se considera "completo" si tiene al menos fecha de nacimiento, teléfono o CUIL cargado — `tiene = d && (d.fechaNac||d.tel||d.cuil)`, línea 2820).
- **⚠️ DUDA** — No hay ninguna restricción que impida a un empleado editar los datos de *otro* empleado a nivel de código (la función `guardarMiPerfil()` siempre usa `currentUser.id`, así que en la práctica un `user` solo puede guardar los suyos vía la UI normal — pero esto depende enteramente de que el cliente no sea manipulado; no hay verificación en el backend porque no hay backend).

## 16. Hijos

- Registrados por empleado: nombre y fecha de nacimiento opcional (`hijosData`).
- Alta/baja gestionadas por el propio empleado desde "Mi perfil"; sin edición (solo alta y eliminación, no hay función de editar un hijo existente).
- Alta automática de evento de cumpleaños si se carga fecha de nacimiento (ver sección 14).

## 17. Novedades

- Registro simple: persona que reporta + texto libre + fecha/hora automática (`new Date()` al guardar).
- **No existen funciones de edición ni eliminación de novedades** (se buscó explícitamente `delNov`/`editNov` en todo el archivo y no existen). Una vez creada, una novedad es permanente desde la UI — solo se podría borrar manipulando la base de datos directamente.
- Se muestran ordenadas de más reciente a más antigua, con "hace X tiempo" (`ago()`, línea 1017).

## 18. Fotografías

- Alta vía `<input type="file">` con `FileReader` → se codifica como `data:` URL (base64) y se guarda tal cual en el campo `src` de la tabla `fotos` (no hay compresión, resize, ni límite de tamaño validado en el cliente).
- Tipo: `tarea` (evidencia de una tarea) o `recuerdo`; persona opcional asociada.
- Filtro por tipo; grilla 3 columnas mobile / 5 columnas escritorio.
- Eliminación disponible para **cualquier usuario logueado**, no solo admin (ver sección 1, inconsistencia ya señalada).
- Esta es el área explícitamente señalada por el usuario del proyecto como destino de una futura integración con Google Drive vía backend (no implementada en el prototipo).

## 19. Desempeño (ver sección 6)

Repetido aquí por completitud del pedido original — el detalle completo y el bug verificado están en la sección 6.

## Actualización Etapa 4B — Desempeño

- Denominador: DAILY/WEEKLY/MONTHLY esperadas según planificación histórica. URGENT/ONE_TIME se informan aparte.
- Cumplimiento = completadas asignadas / esperadas asignadas; el equipo usa totales ponderados. Cero esperadas devuelve `null` ("Sin datos").
- Una completada usa `assignedEmployeeId`; un pendiente usa el responsable vigente al cierre, o ahora si sigue abierto. La cobertura suma trabajo a quien realizó y cumplimiento/ayuda a quien la tenía asignada.
- Reversiones no cuentan. La racha considera solo DAILY: hoy incompleto no rompe la racha cerrada ayer y un día sin tareas no suma ni corta.

## 20. Otras reglas encontradas

- **Clima → recomendaciones de jardín** (`rndClima()`, línea 1650-1665): reglas fijas sobre datos de Open-Meteo — no regar si llovió/lloverá suficiente, no fumigar si hay lluvia prevista al día siguiente o viento >25 km/h, regar temprano si la máxima supera 32°, proteger plantas si la máxima es menor a 10°.
- **Lista de compras** (`rndCompras()`, dentro de Stock → Compras): todo ítem con estado distinto de `ok` (bajo o crítico) de ambas áreas, agrupable por categoría o por estado, compartible vía `navigator.share` o portapapeles (`compartir()`, línea 1593).
- **Categorías de stock**: catálogo editable por admin (`categorias_stock`, con área `casa`/`jardin`/`ambas`); si la tabla está vacía, se usa como *fallback* un catálogo fijo en el código (`CATS_CASA`, `CATS_JARDIN` — ver `docs/DATA_INVENTORY.md`).
- **Destinos de consumo**: catálogo editable por admin, tipo `vehiculo` o `sector`; eliminar un destino ofrece elegir entre inactivar (conserva historial) o borrar en forma definitiva (con doble confirmación, línea 3198-3223).
- **Exportación CSV** de consumos filtrados por rango de fechas (`exportarCSV`, línea 3402) — columnas: Fecha, Ítem, Cantidad, Unidad, Persona, Destino, Motivo.
- **Sesión**: `sessionStorage` recuerda rol + persona entre recargas de la misma pestaña/sesión de navegador, pero se pierde al cerrar el navegador (no es "recordarme" persistente entre dispositivos ni entre reinicios del navegador). `logout()` la limpia explícitamente.
