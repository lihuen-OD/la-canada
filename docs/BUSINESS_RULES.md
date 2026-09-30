# BUSINESS_RULES.md — Reglas de negocio extraídas de `index.html`

> Convención de este documento: cada regla cita la(s) función(es) o línea(s) de `index.html` donde se comprobó. Cuando una regla parece incompleta, contradictoria o no verificable solo con lectura estática, se marca explícitamente con **⚠️ DUDA** o **⚠️ INCONSISTENCIA**. Nada de lo marcado así debe tratarse como comportamiento definitivo hasta que un humano lo confirme.
>
> **Nota (Etapa 2.3)**: `index.html` fue retirado del repositorio (contenía credenciales reales de Supabase — ver `docs/SECURITY.md`). Las citas de línea de este documento quedan como registro histórico de la auditoría; ya no corresponden a un archivo presente en el repo.

## Regla de paridad funcional (permanente)

La reconstrucción conserva las funciones y permisos del prototipo tal como los documenta este archivo: lo que el prototipo permitía a todo usuario logueado sigue permitido; lo restringido a admin sigue restringido. No se agregan, quitan ni restringen funciones sin autorización expresa del usuario, aunque parezca más seguro o conveniente; la seguridad se mejora por dentro (backend como autoridad, validación, transacciones) sin cambiar la experiencia autorizada. Ante una conducta no determinable con esta documentación, se informa la ambigüedad y se pide el HTML original como referencia temporal. **Única excepción funcional autorizada**: Desempeño (§6/§19) — `ADMIN` ve el desempeño de todos y el detalle de cada empleado; `EMPLOYEE` solo el propio, con el alcance impuesto por el backend (implementado en 4B). Las diferencias deliberadas de Stock ya resueltas están en §8, "Contrato implementado en Etapa 5C.2".

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
    - En la app actual, el ADMIN ingresa una cantidad entera positiva por alta o baja y confirma el total anterior y el nuevo. El backend impide un saldo negativo, más de 100.000 gallinas y cambios sobre un total modificado por otra persona.
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
- **Actualización — stock objetivo (reemplaza la regla anterior)**: cada producto tiene stock actual, **mínimo** (cuándo reponer) y **objetivo** (la cantidad a la que se busca llegar al reponer; no es un máximo: un ingreso puede superarlo). Estados, con comparaciones exactas en decimal y el punto medio sin redondear (se evalúa `2 × actual ≤ mínimo + objetivo`):
  - **Crítico**: actual ≤ mínimo. La igualdad ya es crítica; con mínimo 0, el saldo 0 es crítico.
  - **Bajo**: actual > mínimo y ≤ (mínimo + objetivo) / 2.
  - **Normal**: actual > (mínimo + objetivo) / 2.
  - Ejemplo: mínimo 20 y objetivo 50 → hasta 20 crítico, de 20 a 35 bajo, más de 35 normal. Con 19 en stock, Compras sugiere 31.
  - El objetivo es no negativo y **mayor que el mínimo** (lo valida el servicio y lo refuerza un CHECK), con la misma precisión que el mínimo: `Decimal(10,2)`. Es obligatorio en productos nuevos, y también al editar el mínimo o el objetivo.
  - **Productos anteriores sin objetivo** (`target_quantity` NULL; nunca se inventa): **crítico** si actual ≤ mínimo; **normal** si actual > mínimo (sin objetivo no hay umbral de bajo, y nunca se inventa uno). **No existe un cuarto estado**: la falta de objetivo solo se ve en el campo de edición y en Compras, donde «Completar stock objetivo» reemplaza la cantidad sugerida. Se pueden renombrar, recategorizar o desactivar sin completar el objetivo; cambiar el mínimo lo exige. Se completa desde la edición del producto.
  - Barra visual: actual / objetivo, limitada a 100% solo en la representación. Sin objetivo, la barra anterior (`stock / (min*2)`, sin barra con mínimo 0).
  - Regla única en `backend/src/stock/stockLevel.ts` (TypeScript y SQL). El DTO trae `stockLevel`, `targetQuantity` y `suggestedPurchaseQuantity`, y el frontend no recalcula nada.

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

### Contrato implementado en Etapa 5C.2 (cierre funcional de Stock)

- **Nivel**: la UI muestra solo el `stockLevel` del backend; ya no existe una regla de nivel en el frontend. La barra sigue la fórmula de §7 y se oculta con mínimo `0`.
- **Compras (derivada, sin persistencia)**: productos activos en `critical` o `low` de ambas áreas (filtros Todos / Críticos / Bajos), con actual, mínimo, objetivo, unidad, prioridad y la **cantidad sugerida = objetivo − actual** para ambos estados, o «Completar stock objetivo» en su lugar si falta el objetivo. Es una sugerencia: no registra compras ni mueve stock. **Inicio/Dashboard muestra solo críticos** (actual ≤ mínimo, igualdad incluida). Se puede agrupar por estado o categoría y compartir la lista visible mediante Web Share o portapapeles. No hay estado "comprado" ni alertas guardadas. Registrar un ingreso desde Compras es un `INCOME` normal.
- **Movimientos y destinos**: el modal unificado permite Consumo/Ingreso, fecha de hoy o pasada y destino activo opcional en cualquier tipo. `ADMIN` elige a cualquier empleado o administrador activo (incluido él mismo; por defecto, él mismo, como el «🔐 Administrador» del prototipo); `EMPLOYEE` queda fijado a sí mismo. Quien realizó el movimiento se guarda aparte del autor: `employeeId` o, para un administrador sin ficha, `participantUserId`. El autor siempre sale de la sesión y queda en `AuditLog`. Los historiales muestran «<persona> · Registró: <autor>» cuando lo cargó otro usuario. Ajustes: separados, motivo obligatorio y solo `ADMIN`. Nadie puede registrar una fecha futura ni consumir más que el saldo.
- **Reportes**: agregados en el backend por período (fechas de `BUSINESS_TIME_ZONE`, máximo 366 días; el prototipo ofrecía 7/30/90/365), área, categoría, tipo, producto, persona y destino. Los conteos son globales; **las cantidades se informan siempre por unidad** (nunca se suman litros con kilos). Los saldos iniciales (`OPENING_BALANCE`) se cuentan aparte y no son ingresos. Un movimiento sin persona asociada registrado por un `ADMIN` sin empleado se muestra (historial, reportes, "Movimientos por persona" —un grupo por administrador— y columna "Persona" del CSV) con el nombre visible de quien lo registró, tomado de su auditoría de alta (`stock.movement.created`). "Sin persona asociada"/"Sin persona registrada" queda solo para lo que no tiene autor identificable (aperturas del seed). Los niveles actuales no dependen del período.
- **Permisos de Reportes (paridad verificada)**: todo usuario autenticado ve el mismo historial, incluidos productos hoy inactivos, y puede exportarlo. Evidencia del HTML original: `#chip-reportes`, `#p-reportes`, sus fechas y el botón `onclick="exportarCSV()"` no llevan `admin-only`; `swStock('reportes')`, `rndReportes()` y `exportarCSV()` no condicionan por `isAdmin()`.
- **CSV**: endpoint server-side autenticado con los mismos filtros y rango, límite de 10.000 filas, BOM UTF-8 y columnas Fecha/Ítem/Cantidad/Unidad/Persona/Destino/Motivo. Escapa comas, comillas y saltos y neutraliza fórmulas de planilla.
- **Idempotencia desde el navegador**: todo movimiento creado por la UI envía `Idempotency-Key`; el mismo envío repetido no duplica, un formulario distinto es una operación nueva.

## 9. Gallinero

- Un único contador global de "gallinas activas" (`gallinasActivas`), ajustable ±1 por vez por un admin, con confirmación (`ajustarGallinas`, línea 2300). **⚠️ DUDA / RIESGO** — el ajuste solo persiste en Supabase si ya existe una fila en la tabla `gallinero` (`if (gallineroId) {...}`, línea 2306); si no existe ninguna fila todavía, el cambio se aplica solo en memoria y se pierde al recargar la página. No hay lógica de "crear la fila si no existe".
- Recolección diaria: huevos buenos + huevos rotos, persona que recolectó, fecha, observación opcional (`addRecoleccion`, línea 2313).
- **Postura del día** = `round(huevos_buenos_hoy / gallinas_activas * 100)` (línea 2184).
- **Postura media del período** = `round(total_buenos_período / (gallinas_activas * días_con_datos) * 100)` (línea 2193) — nota: usa el conteo *actual* de gallinas activas para todo el período, no el histórico (si la cantidad de gallinas cambió durante el período, la postura media queda distorsionada). No hay tracking histórico de cuántas gallinas había en cada fecha.
- Historial agrupado por fecha, con total de buenos/rotos y % de postura por día.
- **⚠️ BUG VERIFICADO** — `rndGallHistorial()` (línea 2270) referencia `DIAS_ES[d.getDay()]`, una variable que **no está declarada en ningún lugar del archivo** (el archivo define `DIAS`, `DIAS2`, `DIAS3`, pero no `DIAS_ES`). Esto debería producir un `ReferenceError` en tiempo de ejecución cada vez que se intenta renderizar el historial del gallinero con al menos un registro. No se ejecutó el archivo en navegador para confirmar el efecto exacto (p. ej. si rompe solo esa función o interrumpe el render de toda la pantalla); se deja como hallazgo a verificar en la etapa de reconstrucción, no como comportamiento asumido.

### Contrato implementado en Etapa 5G (Gallinero)

- **Permisos (paridad)**: ver KPIs, análisis e historial y registrar recolecciones = todo usuario autenticado; configurar, "+ Alta"/"− Baja" y eliminar recolecciones = solo `ADMIN` (backend como autoridad).
- **"¿Quién juntó?"**: `EMPLOYEE` queda fijado a su empleado (la identidad sale de la sesión); `ADMIN` elige a cualquier empleado o administrador activo (por defecto, él mismo: su ficha si la tiene o su usuario). Quien juntó se guarda en `employeeId` o `participantUserId`, y el autor aparte (`recordedByUserId` + `AuditLog`). El historial muestra «Registró: …» cuando lo cargó otro usuario.
- **Fecha**: hoy o pasada para todos, nunca futura, según `BUSINESS_TIME_ZONE` (el prototipo no validaba).
- **Configuración pendiente**: sin `ChickenCoop "main"` el `ADMIN` carga la cantidad real una sola vez; el resto ve "Configuración pendiente". Se puede registrar igual; la postura se muestra "—".
- **Alta/Baja**: de a una, con la confirmación "¿Cambiar gallinas activas de X a Y?". El backend aplica solo si la cantidad sigue siendo X (si no, `409 CHICKEN_COOP_COUNT_CHANGED`); nunca negativa. Corrige la ⚠️ DUDA de §9: ya no se pierde un ajuste por falta de fila.
- **Cálculos (backend)**: fórmulas de §9 sin cambios. Diferencias deliberadas: el período son los últimos N días de calendario incluido hoy (7/30/90/365); sin gallinas configuradas (o con 0) la postura es `null` ("—") y no un 0% falso. Se conserva la limitación documentada: la postura histórica usa la cantidad **actual** de gallinas.
- **Historial**: agrupado por fecha, paginado por días completos (10 por página, "Cargar más días"). Corrige el `DIAS_ES` no declarado: el día de la semana se muestra completo.
- **Eliminar**: confirmación "¿Eliminar este registro?" → anulación lógica auditada (`chicken_coop.collection_voided`), nunca borrado físico.
- **Idempotencia**: el alta de recolección acepta `Idempotency-Key` (mismo contrato que Stock); el frontend lo envía siempre.

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

### Contrato implementado en Etapa 5M (Mascotas, §11–§12)

- **Permisos (paridad)**: todo usuario autenticado ve listado, ficha, KPIs e historial y registra datos clínicos; solo `ADMIN` crea/edita la ficha, cambia o quita la foto, agrega/da de baja tipos y elimina registros (backend como autoridad).
- **Tipos**: los 9 precargados no se eliminan. "Eliminar" un tipo agregado es una baja lógica ("Las mascotas de este tipo no se borran"): conservan su tipo, pero no se ofrece para mascotas nuevas. Duplicado sin distinguir mayúsculas → "Este tipo ya existe."; volver a agregar uno dado de baja lo reactiva. El símbolo (25 opciones de `ANIMAL_EMOJIS`) ahora se persiste — el prototipo lo perdía al recargar.
- **Listado**: mascotas activas en orden de alta, chips "Todas" + tipos con mascotas, paginado. Aviso de cumpleaños hoy o dentro de 30 días; último peso. Estado vacío real "Sin mascotas registradas".
- **Ficha**: KPIs del prototipo (vacunas, último peso, desparasitaciones, días al próximo cumpleaños); edad y cumpleaños calculados en el backend con `BUSINESS_TIME_ZONE` (meses ajustados por día; un 29/02 se festeja el 01/03 en años no bisiestos).
- **Registros clínicos**: 5 tipos del prototipo; fecha hoy o pasada (todos son hechos ocurridos: el prototipo no tiene "próximo control"); ⚖️ Peso exige kg positivo (hasta 9999,99) y ningún otro tipo lo acepta; descripción opcional. Persona = la de la sesión (sin persona para un `ADMIN` sin empleado, como `currentUser` del prototipo); actor real en `recordedByUserId` + `AuditLog`; sin persona, el historial muestra el nombre visible de ese actor. `Idempotency-Key` en el alta. "✕" = anulación lógica auditada; deja de contar en KPIs e historial.
- **Foto**: el prototipo pedía una URL externa; ahora es un archivo (JPG/PNG/WebP, tipo real por bytes, máx. 5 MB) en Neon Object Storage privado vía el backend (`FileAsset`). Reemplazar o quitar = baja lógica y luego borrado físico. Sin `OBJECT_STORAGE_*` configurado, las fotos se deshabilitan con un aviso claro y el resto funciona.
- **Cumpleaños**: el prototipo creaba un evento "🎂 Cumpleaños de <mascota>" al guardar la fecha de nacimiento; desde la Etapa 5X se calcula en Eventos desde `Animal.birthDate` (§14), sin filas.

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

### Contrato implementado en Etapa 5X (☰ Más, §13–§18)

- **Grilla**: el orden y los subtítulos del prototipo (`rndMas`): Novedades ("N hoy" o "N total"), Eventos ("N próximos", cumpleaños incluidos), Clima ("Villa Elisa, E.Ríos"), Fotos ("N fotos"), Configuración (solo ADMIN) y Mi perfil (empleado), más "Cerrar sesión". Todo en una sola request de conteos.
- **Novedades (§17)**: todos ven el historial (más reciente primero, "hace X") y registran. "¿Quién reporta?": un `EMPLOYEE` queda fijado a su persona (mismo criterio aprobado en Gallinero); un `ADMIN` elige una persona activa. El actor real queda aparte (`recordedByUserId` + auditoría). Sin edición ni borrado, como el prototipo. Se permite repetir un texto (se quitó la unicidad empleado + texto). `Idempotency-Key` en el alta.
- **Eventos (§13)**: filtro Todos/Visitas/Cumpleaños/Mantenimiento/Otros; "Próximos" desde hoy y "Pasados" atenuados y paginados, en `BUSINESS_TIME_ZONE`. Crear, editar y eliminar solo `ADMIN`; "eliminar" es una **anulación lógica** auditada (el prototipo borraba la fila) y un evento anulado puede volver a cargarse. Sin duplicados vigentes (título + fecha + tipo → 409). Fecha real entre 1900 y 2100.
- **Cumpleaños (§14)**: **se calculan al leer, no se crean filas**: familia (`RecurringBirthday`: Vicky, Felicitas), personas activas con fecha en Mi perfil ("Equipo"), sus hijos ("Hijo/a de <persona>") y mascotas activas ("Mascota"). Siempre la próxima ocurrencia (un 29/02 se festeja el 01/03 en años no bisiestos); nunca pasan a "Pasados". No se editan desde Eventos: se corrigen en su origen. Diferencia deliberada: el prototipo creaba filas con una fecha fija que al año quedaba vieja y mostraba el emoji dos veces. **Benjamín sigue omitido.**
- **Clima (§20)**: lo consulta el backend (Open-Meteo, ubicación `PropertyLocation "main"`), con caché compartida de 10 minutos; mismos textos, íconos, umbrales y recomendaciones que `rndClima`. Todos lo ven.
- **Fotos (§18)**: todos ven y suben (JPG/PNG/WebP, tipo real por bytes, máx. 10 MB) con título ("Sin título"), tipo (📷 Recuerdo / ✅ Tarea) y persona opcional; filtros Todas/Tareas/Recuerdos. **Eliminar es solo de `ADMIN`** — diferencia deliberada con el prototipo (§1, que dejaba borrar a cualquiera): es irreversible y ya estaba aprobada (`docs/ARCHITECTURE.md` §7). Baja lógica y luego borrado físico. Sin almacenamiento configurado, la subida se deshabilita con aviso.
- **Configuración (solo ADMIN)**: 👥 Personas — alta (nombre, rol Doméstica/Parque/Otro, color; nace con su cuenta pendiente, sin PIN), edición, 🔑 asignar/cambiar PIN y Baja/Activar ("Dar de baja a X?"). La baja es lógica: la persona deja de aparecer en el selector de ingreso, no puede entrar y se cierran sus sesiones (paridad: el prototipo solo listaba personas activas); su historial se conserva. 👤 Datos del equipo (lectura; filtro Todos/Completos/Sin datos; "completo" = fecha de nacimiento, teléfono o CUIL). 📅 Calendario de tareas con la marca aproximada del prototipo (diarias todos los días, semanales de lunes a viernes, mensuales el día 1). 🔐 Cambiar el propio PIN (cierra la sesión, como en Usuarios) y acceso a Usuarios. 📱 Instalar como app (texto).
- **Mi perfil**: la persona de la sesión (nunca otra) carga sus datos personales, contacto de emergencia e hijos (alta y ✕, sin edición, como el prototipo). Fechas de nacimiento hoy o pasadas. Teléfono y CUIL con formato razonable (solo números y separadores). La auditoría registra qué campos cambiaron, nunca los valores. Un hijo eliminado se borra de verdad (dato de un menor sin historia operativa).

## Jardín (Etapa 5Y)

Módulo **nuevo**: el prototipo no tenía plano del jardín, así que no hay regla heredada ni dato que migrar. El estado inicial es vacío a propósito (no se siembran planos de ejemplo).

- **Ver el plano y su historial**: todos los usuarios autenticados, igual que la galería de Fotos (§18), que también era visible para todos.
- **Publicar una versión nueva**: **solo `ADMIN`**, la única acción de escritura del módulo y la que deja una versión nueva en el historial; por eso exige el mismo permiso que el resto de la configuración. Sin la imagen no se publica nada (415) ni con un archivo de más de 10 MB (413).
- **Versiones inmutables y crecientes**: publicar siempre crea una versión nueva (`1`, `2`, `3`…); la anterior **no se modifica, no se reemplaza y no se borra**. No hay edición, restauración, eliminación ni "revertir a una anterior" en el alcance de la etapa.
- **La vigente es la de número más alto**: no existe una marca de "vigente" que se pueda desincronizar; publicar de nuevo deja la anterior como parte del historial y la nueva como la que se ve.
- **Un archivo por versión**: una versión no puede reutilizar la imagen de otra. La imagen vive en el almacenamiento privado y se sirve por el backend; nunca se expone el bucket, la clave ni una URL del almacenamiento.
- **Historial**: paginado de 20 en 20, del más reciente al más antiguo, con la versión vigente arriba. Sin conexión, se ve un estado inicial claro según el rol (no un error).
- **Auditoría**: cada publicación queda registrada con su actor (`garden_plan.version_published`).
- **Fuera de alcance** (no existe y no se agrega sin pedido expreso): editar o recortar el plano, marcar zonas o detalles sobre la imagen, medir superficies, OCR, subir varios archivos en una publicación, descargar o compartir el plano por link.

### Contrato implementado en Etapa 5Y (🌳 Jardín)

- **Grilla de Más**: tarjeta "🌳 Jardín" después de 📸 Fotos, con el subtítulo "Sin plano" cuando no hay ninguna versión y "N versiones" cuando las hay. Todos la ven (no es una acción de `ADMIN`).
- **Pantalla `/more/garden`**: el plano vigente a tamaño completo (nunca recortado: `object-fit: contain`), con quién lo publicó y cuándo; debajo, el historial paginado con miniatura, número, autor y fecha, y un botón para abrir cualquier versión en un visor. "Volver" como en las demás pantallas de Más.
- **Publicar (solo `ADMIN`)**: se elige **una** imagen JPG/PNG/WebP de hasta 10 MB, se ve una vista previa antes de confirmar y se publica con `Idempotency-Key` (reintentar el mismo archivo no publica dos versiones). Sin almacenamiento configurado, el botón queda deshabilitado con un aviso claro, como en Fotos.
- **El tipo de imagen lo dicen los bytes**: ni la extensión ni el tipo declarado deciden; un archivo que no sea una imagen válida se rechaza con 415 y no queda registro.
- **Lo que no existe**: editar una versión, borrarla, restaurarla ni convertir a mano una versión anterior en vigente.
- **Paridad funcional**: el módulo es nuevo, así que no hay conducta del prototipo que preservar; se sigue el criterio de Fotos (§18) para lo visible por todos y el de Configuración para lo que solo puede hacer un `ADMIN`.

## 19. Desempeño (ver sección 6)

Repetido aquí por completitud del pedido original — el detalle completo y el bug verificado están en la sección 6.

## Actualización Etapa 4B — Desempeño

- Denominador: DAILY/WEEKLY/MONTHLY esperadas según planificación histórica. URGENT/ONE_TIME se informan aparte.
- Cumplimiento = completadas asignadas / esperadas asignadas; el equipo usa totales ponderados. Cero esperadas devuelve `null` ("Sin datos").
- Una completada usa `assignedEmployeeId`; un pendiente usa el responsable vigente al cierre, o ahora si sigue abierto. La cobertura suma trabajo a quien realizó y cumplimiento/ayuda a quien la tenía asignada.
- Reversiones no cuentan. (La racha de la Etapa 4B se retiró en 5D.2.)

## Actualización Etapa 5D — Regla definitiva de Desempeño (reemplaza lo anterior donde difiera)

- **Cumplimiento personal** = obligaciones propias realizadas por la misma persona / obligaciones asignadas. Si Coke completa una tarea asignada a Juan, la ejecución conserva `assignedEmployeeId = Juan` y `completedByEmployeeId = Coke`: la tarea queda terminada, sigue en el denominador de Juan, no suma a su numerador y no altera el porcentaje de Coke; se informa como **cobertura recibida** (Juan) y **cobertura realizada** (Coke). Ejemplo: 10 asignadas, 8 propias, 1 cubierta, 1 pendiente → 80%.
- **Los cinco tipos cuentan.** DAILY/WEEKLY/MONTHLY: una obligación por día/semana/mes planificado según `TaskPlanningInterval` (altas, bajas, reasignaciones y cambios de frecuencia), nunca fuera de lo planificado. URGENT/ONE_TIME: **una sola** obligación por tarea, si su ventana (desde la planificación hasta la finalización vigente, o hasta el cierre de la planificación si sigue pendiente) se superpone con el rango: completada antes del rango o creada después → no entra; completada durante el rango → entra; completada después del fin del rango → entra como pendiente.
- Responsable: siempre el snapshot `assignedEmployeeId` de la ejecución; si está pendiente, el de la planificación vigente al cierre. Nunca se deduce por nombres ni por el responsable actual, y ninguna ejecución histórica se modifica.
- Métricas del DTO: `assigned`, `completedPersonally`, `percentage`, `pending`, `coverageReceived`, `coverageGiven` y `operationalCompleted` (trabajo terminado por la persona, propio + coberturas, fuera del porcentaje). Reversiones no suman ni cuentan como cobertura. Sin puntos, premios ni ponderaciones.
- **Simplificación (5D.2)**: sin racha (se retiró del cálculo, del DTO y de la pantalla). Etiquetas visibles: **Sin completar** (asignadas que nadie terminó), **Le cubrieron** (propias hechas por otra persona) y **Cubrió a otros** (ajenas hechas por la persona); el porcentaje sigue siendo realizadas personalmente / asignadas (Cami: 2 asignadas, 1 propia, 1 cubierta → 50%, Sin completar 0, Le cubrieron 1). Rangos públicos: 7, 14 y 30 días (predeterminado e Inicio: 7). Con 0 obligaciones asignadas no hay denominador: se muestra «Sin tareas en el período» (nunca «0%» ni «Sin datos») con barra neutra; con asignadas y ninguna realizada sí es «0%».

## 20. Otras reglas encontradas

- **Clima → recomendaciones de jardín** (`rndClima()`, línea 1650-1665): reglas fijas sobre datos de Open-Meteo — no regar si llovió/lloverá suficiente, no fumigar si hay lluvia prevista al día siguiente o viento >25 km/h, regar temprano si la máxima supera 32°, proteger plantas si la máxima es menor a 10°.
- **Lista de compras** (`rndCompras()`, dentro de Stock → Compras): todo ítem con estado distinto de `ok` (bajo o crítico) de ambas áreas, agrupable por categoría o por estado, compartible vía `navigator.share` o portapapeles (`compartir()`, línea 1593).
- **Categorías de stock**: catálogo editable por admin (`categorias_stock`, con área `casa`/`jardin`/`ambas`); si la tabla está vacía, se usa como *fallback* un catálogo fijo en el código (`CATS_CASA`, `CATS_JARDIN` — ver `docs/DATA_INVENTORY.md`).
- **Destinos de consumo**: catálogo editable por admin, tipo `vehiculo` o `sector`; eliminar un destino ofrece elegir entre inactivar (conserva historial) o borrar en forma definitiva (con doble confirmación, línea 3198-3223).
- **Exportación CSV** de consumos filtrados por rango de fechas (`exportarCSV`, línea 3402) — columnas: Fecha, Ítem, Cantidad, Unidad, Persona, Destino, Motivo.
- **Sesión**: `sessionStorage` recuerda rol + persona entre recargas de la misma pestaña/sesión de navegador, pero se pierde al cerrar el navegador (no es "recordarme" persistente entre dispositivos ni entre reinicios del navegador). `logout()` la limpia explícitamente.
## Inicio/Dashboard (Etapa 5I)

- Replica `rndInicio`: tareas completadas del período vigente sobre tareas operativas; urgentes activas sin ejecución vigente; productos activos críticos/bajos; suma de huevos buenos no anulados del día; avance por persona activa; tres próximos eventos/cumpleaños; tres novedades más recientes.
- Usa `BUSINESS_TIME_ZONE` para “hoy”. El backend es la autoridad y ambos roles reciben únicamente este DTO operativo; Desempeño conserva por separado su excepción ADMIN/todos y EMPLOYEE/propio.
- No contiene Clima, Mascotas ni accesos rápidos: esas pantallas existen en sus módulos, pero no eran widgets del Inicio original.
- **Desempeño en Inicio (5D)**: mismo cálculo y mismo período predeterminado (últimos 7 días) que Tareas → Desempeño; ADMIN ve "Avance del equipo" con el cumplimiento personal de cada persona, EMPLOYEE ve "Mi desempeño" solo con sus cifras. El KPI "Tareas completadas" sigue siendo operativo (período vigente) y no se mezcla con el cumplimiento personal.
- **Fechas**: toda fecha completa visible se muestra `dd/mm/aaaa` (con hora, `dd/mm/aaaa HH:mm`); se conservan los relativos del diseño ("Hoy", "Mañana", "hace 2 días") y las etiquetas parciales de grillas/gráficos (día y mes).

## Política de eliminación, desactivación y anulación (Etapa 5E)

| Entidad | Editar | Desactivar / reactivar | Eliminar definitivo (solo ADMIN) | Anular / revertir |
| --- | --- | --- | --- | --- |
| Tarea | ADMIN | ADMIN | Solo sin ninguna ejecución (tampoco revertida) ni archivo → si no, `409 TASK_IN_USE`. Sus intervalos técnicos se borran en la misma transacción. | Ejecución: reversión auditada |
| Categoría de stock | ADMIN | ADMIN (no con productos activos) | Solo sin ningún producto (activo o inactivo) → `409 STOCK_CATEGORY_IN_USE` | — |
| Producto de stock | ADMIN | ADMIN | Solo sin ningún movimiento (tampoco `OPENING_BALANCE`) y saldo 0 → `409 STOCK_ITEM_IN_USE`. Los 14 del seed solo se desactivan. | — |
| Destino | ADMIN | ADMIN | Solo si nunca se usó en un movimiento → `409 STOCK_DESTINATION_IN_USE` | — |
| Movimiento de stock | Nunca | — | Nunca | Ledger inmutable (correcciones por ajuste) |
| Tipo de mascota | — | ADMIN, solo agregados (los 9 precargados no cambian) | Solo agregados y sin ninguna mascota (activa o inactiva) → `409 PET_TYPE_IN_USE` / `409 PET_TYPE_BUILTIN` | — |
| Mascota | ADMIN | ADMIN (murió, se entregó, ya no está); inactiva: fuera del listado por defecto, filtro ADMIN Activas/Inactivas/Todas, sin registros ni fotos nuevas (`409 PET_INACTIVE`) | Solo sin registros clínicos (tampoco anulados) ni archivos (tampoco eliminados lógicamente) → `409 ANIMAL_IN_USE` | Registro clínico: anulación |
| Recolección / gallinero | — | — | Nunca | Recolección: anulación; ajustes de gallinas con historial |
| Evento | ADMIN | — | Nunca físico | Anulación lógica (también para eventos futuros) |
| Foto (galería / mascota) | — | — | El objeto se borra del almacenamiento; el `FileAsset` queda como baja lógica | Baja lógica |
| Novedad | — | — | No (historia operativa; el prototipo tampoco borraba) | — |
| Usuario / empleado | ADMIN | Estados (suspender, deshabilitar, reactivar) | No (sesiones, auditoría e historia) | — |
| Hijo (Mi perfil) | Propietario | — | Propietario, como en el prototipo (sin dependencias; auditado con snapshot mínimo) | — |

Toda eliminación: `DELETE` explícito, `204`/`403`/`404`/`409 *_IN_USE`, transacción con verificación de dependencias por `count` dentro de ella, auditoría con snapshot (sin PIN, hashes ni binarios) escrita antes del borrado, borrado condicionado (dos DELETE simultáneos → `204` + `404`) y clave foránea rota por una dependencia agregada en paralelo → el mismo `409 *_IN_USE` de la entidad (nunca `500`). La traducción de la FK solo ocurre dentro de la eliminación: fuera de ella, un P2003 inesperado es un error genérico («Ocurrió un error inesperado. Intentá nuevamente.»), sin detalles. Sin `ON DELETE CASCADE` y sin borrar historia para poder eliminar.

## Perfil personal y familia del ADMIN; cumpleaños derivados vs. manuales (Etapa 5F)

- **Cambio funcional autorizado explícitamente por el usuario (2026-09-28)**: en el prototipo "Mi perfil" era solo del equipo (`!admin`, `applyRoleUI`). Ahora el ADMIN también lo tiene: 🎂 Mi cumpleaños (nombre visible opcional + fecha de nacimiento) y 👨‍👩‍👧‍👦 Mi familia (nombre, relación, fecha; crear, editar, desactivar, reactivar, eliminar). Sin campos laborales y **sin crear un `Employee` ficticio**: el ADMIN sigue fuera de Tareas, Desempeño, responsables, recolecciones, Stock, autores y todo selector laboral.
- **Relación**: `PARTNER` (Pareja), `CHILD` (Hijo/a), `FAMILY` (Familia), `OTHER` (Otro); no existe "yo" como familiar. Vicky y Felicitas quedaron como `FAMILY`: el HTML solo dice `nota:'familia'`, sin parentesco concreto.
- **Fechas sin año**: se guardan día y mes y el año queda vacío (API `--MM-DD`, visible `dd/mm`), sin años de relleno. La edad solo se calcula con año real. Con año: fecha real, no futura, desde 1900. El 29/02 se admite y se festeja el 01/03 en años no bisiestos.
- **Duplicados en la familia**: mismo nombre (sin distinguir mayúsculas) y mismo día/mes, con el mismo año o sin año en alguno → 409 «Ya agregaste un familiar con ese nombre y esa fecha.». Un homónimo con otra fecha se permite.
- **Eliminar familiar**: solo uno cargado por error (confirmación irreversible, auditoría con nombre y relación, sin fecha). Los familiares de los datos originales (Vicky, Felicitas) **solo se desactivan** (409 `FAMILY_MEMBER_SEEDED`). Desactivar lo saca de Eventos y se puede reactivar.
- **EMPLOYEE**: sin cambios (ficha, contacto de emergencia, hijos en `EmployeeChild`, mismos permisos). "Mi familia" no aplica a quien tiene ficha de equipo (409 `FAMILY_USES_EMPLOYEE_PROFILE`), para no duplicar hijos.
- **Cumpleaños derivados** (perfil del ADMIN, su familia, empleados, hijos, mascotas y globales sin propietario): se calculan al leer, nunca son filas `Event`, muestran su origen («🔁 Automático desde Mi familia», etc.) y no tienen "Eliminar". Se corrigen en su fuente: el propio perfil o la propia familia → Mi perfil; ADMIN mirando un empleado o hijo → Datos del equipo (lectura); mascota → su ficha («Editar ficha» para ADMIN, «Ver ficha» para EMPLOYEE). La familia y el perfil del ADMIN se ven en Eventos para todos, igual que los cumpleaños de familia del prototipo, pero sin enlace para el EMPLOYEE.
- **Cumpleaños manuales** ("Nuevo evento" tipo Cumpleaños): filas `Event`; solo ADMIN crea, edita (título, fecha, tipo, nota) y anula (lógica, auditada). No modifican perfiles, familia, empleados, hijos ni mascotas. Antes de guardar uno: si ya hay otro manual vigente de la misma persona ese día → 409 «Ya existe un cumpleaños con este nombre y fecha.»; si ya hay un derivado activo de esa persona que cae ese día → 409 «Este cumpleaños ya se genera automáticamente desde el perfil correspondiente. Editalo desde su perfil para evitar duplicados.». La persona se compara por nombre normalizado (minúsculas, espacios, sin «🎂» ni «Cumpleaños de»).
- **Riesgo aceptado**: dos personas distintas con igual nombre y cumpleaños no se pueden distinguir con el modelo actual. Por eso no hay constraint de base: el chequeo es de aplicación y se resuelve diferenciando el título (p. ej. «Cumpleaños de Vicky (prima)»).
- **Benjamín** sigue omitido.

### Ampliación 5F — nombre visible editable

- **Cambio funcional autorizado explícitamente por el usuario (2026-09-28)**: cada persona corrige su propio nombre visible desde Más → Mi perfil. En el prototipo, solo el admin editaba nombres (Personas). El ADMIN, además, corrige el de cualquier empleado desde Datos del equipo (mismo endpoint de Personas).
- Es solo el nombre humano de la interfaz: nunca cambia `User.id`, `username`, rol, `Employee.id`, `Employee.code`, PIN, sesiones, relaciones, tareas, ejecuciones ni auditorías históricas. Cambiarlo no cierra sesiones.
- **Dónde se guarda**: ADMIN sin Employee → `UserProfile.displayName`; EMPLOYEE → `Employee.displayName` (sin copia en `UserProfile` ni en la ficha personal). "Nombre completo" de la ficha sigue siendo un dato aparte.
- **Dónde se ve**: saludo de Inicio («Buenos días, <nombre> 👋»), header y sesión, Mi perfil, selector de ingreso, su cumpleaños en Eventos, el selector "🔐 <nombre>" de Stock (ADMIN), Usuarios y Configuración. Sin nombre cargado, el ADMIN sigue viéndose como «Administrador»; nunca se muestra el `username`, salvo en la vista administrativa de Usuarios cuando no hay ningún nombre.
- **Validación única** (Mi perfil, Datos del equipo, alta/edición de Personas): obligatorio al guardar; espacios recortados y colapsados; 2 a 100 caracteres con al menos 2 letras; letras de cualquier idioma (tildes, ñ, ü), espacio, apóstrofe, guion y punto; sin dígitos, símbolos ni caracteres de control. Sin unicidad: dos personas pueden llamarse igual.

## Múltiples administradores (Etapa 5U)

- **Función nueva autorizada explícitamente por el usuario (2026-09-28)**: desde Más → Configuración → Usuarios, un ADMIN crea otro ADMIN con «＋ Nuevo administrador» (nombre visible, PIN y confirmación). En el prototipo había un único administrador y el primero de la app nueva se crea con el bootstrap interactivo; esta es la única vía en la app para sumar más.
- El nuevo ADMIN **no es un Employee**: no recibe tareas, no aparece en Desempeño, responsables, recolecciones, Stock, autores ni selectores laborales. Su nombre visible vive en `UserProfile` (lo puede corregir desde Mi perfil).
- La cuenta nace `ACTIVE` y puede ingresar enseguida (selector de identidad + PIN). El rol `ADMIN` y el estado los fija el backend.
- **PIN**: string de exactamente 4 dígitos (conserva ceros iniciales); nunca se sugiere, genera ni usa uno predeterminado; ambos campos se limpian al cerrar, fallar o completar. Nombre: la validación única del nombre visible (5F).
- Después se administra como cualquier cuenta: otro ADMIN le cambia el PIN, lo suspende o deshabilita y lo reactiva, y le corrige el nombre visible desde Usuarios (✏️, solo en cuentas sin Employee; el nombre de una persona del equipo se corrige en Datos del equipo).
- **Un ADMIN nunca se suspende ni se deshabilita a sí mismo** → 409 «No podés desactivar tu propia cuenta.» (antes solo se impedía si era el único activo). **Nunca quedan 0 ADMIN activos**: la regla anterior, más la exigencia de que el actor siga activo cuando se aplica el cambio, garantizan que siempre queda al menos uno. El 409 «No podés desactivar al último administrador activo.» queda como defensa en profundidad.
- **Dos ADMIN desactivándose en simultáneo**: gana uno solo; el otro recibe 409 «Tu cuenta ya no está activa. Volvé a ingresar.» (o 401 si su sesión ya se revocó). Nunca quedan los dos inactivos.
