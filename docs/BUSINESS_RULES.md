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
- **Quincenal** (nueva, no existía en el prototipo; ver "Tareas quincenales" más abajo) → dos períodos por mes calendario: del 1 al 15 y del 16 al último día, inclusive (`YYYY-MM-Q1` / `YYYY-MM-Q2`). Se resetea el 16 y el 1 de cada mes. No es "cada 15 días" desde la creación ni desde la última ejecución.
- **Bimestral** y **Anual** (nuevas; ver "Fecha para realizar y tareas bimestrales/anuales" más abajo) → bimestres de calendario ene–feb, mar–abr, may–jun, jul–ago, sep–oct, nov–dic (`YYYY-B1` … `YYYY-B6`) y año calendario del 1/1 al 31/12 (`YYYY-A`). No son "dos meses / un año desde la última ejecución".
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
- **Urgentes y únicas**: una sola finalización vigente (clave fija `URGENT`/`ONE_TIME`); ~~una urgente completada sigue visible como completada~~ (desde el 2026-10-30 también sale del listado, ver "Urgentes completadas fuera del listado de Tareas"); una única completada sale del listado operativo (como en el prototipo), se conserva en base, aparece en el historial de la semana en que se completó y un `ADMIN` la ve con "Incluir desactivadas y completadas («Una vez» y urgentes)".
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
- **Próxima aplicación o control** (ampliación): campo opcional «Fecha de próxima aplicación o control» en vacunas, desparasitaciones, chequeos y eventos (nunca en ⚖️ Peso). Se carga a mano según la indicación veterinaria (sin intervalos automáticos ni sugerencias) y debe ser posterior a la atención; puede estar ya vencida si se registra una atención histórica. Los registros anteriores sin fecha no generan pendientes ni se consideran vencidos. Solo `ADMIN` completa o corrige esa fecha (acción acotada y auditada, `pet.record_next_due_updated`).
- **Estados** (backend, fechas de calendario de `BUSINESS_TIME_ZONE`): **Vigente** (> 30 días), **Próxima** (1–30), **Vence hoy**, **Vencida** (ya pasó) y **Cumplida** (otra atención vigente la registró). Textos: «En 12 días», «Vence hoy», «Hace 3 días».
- **Cumplimiento**: «Registrar aplicación» (vacuna, desparasitación) o «Registrar control» (chequeo, evento) abre el formulario de siempre con la mascota y el tipo de ese pendiente; la persona confirma la fecha real y puede programar la siguiente. En una transacción: nueva atención + vínculo explícito con el pendiente elegido (`fulfillsRecordId`) + auditoría `pet.record_due_fulfilled`. **Solo se cumple el pendiente elegido**: nunca por coincidir tipo, texto o fecha, y una mascota puede tener varias vacunas o tratamientos distintos. Dos solicitudes no pueden cumplir el mismo pendiente (índice único parcial → 409 «Esta atención programada ya fue registrada»); `Idempotency-Key` evita duplicados por doble envío.
- **Anulaciones y permisos**: sin cambios (registrar = todos; anular y corregir fechas = `ADMIN`; el autor sale de la sesión). Un registro anulado no genera pendientes; si se anula la atención que cumplió un pendiente, ese pendiente vuelve a estar abierto (si el original sigue vigente). Una mascota inactiva conserva su historial, no admite aplicaciones nuevas y no aparece en Vencimientos.
- **📅 Vencimientos** (pestaña de Mascotas): atenciones programadas de mascotas activas por fecha ascendente (primero las vencidas más antiguas); filtros por mascota, tipo y estado; las cumplidas solo con su filtro; paginación en el backend. El listado de mascotas muestra un indicador discreto de vencidas, de hoy y próximas. Sin notificaciones. Desde el 2026-10-26, Inicio muestra un resumen de solo lectura (ver «🐾 Atenciones de mascotas en Inicio»).
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
- **Novedades (§17)**: todos ven el historial (más reciente primero, "hace X") y registran. "¿Quién reporta?": un `EMPLOYEE` queda fijado a su persona (mismo criterio aprobado en Gallinero); un `ADMIN` elige una persona activa. El actor real queda aparte (`recordedByUserId` + auditoría). Sin edición ni borrado, como el prototipo (cambio autorizado el 2026-10-30: ver «Edición y eliminación de mensajes en Novedades»). Se permite repetir un texto (se quitó la unicidad empleado + texto). `Idempotency-Key` en el alta.
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
- **Los cinco tipos cuentan** (seis desde las quincenales: `SEMI_MONTHLY` cuenta con el mismo criterio que `MONTHLY`, una obligación por quincena planificada; ocho desde `BIMONTHLY`/`ANNUAL`, con el mismo criterio; y una `ONE_TIME` con fecha para realizar solo cuenta desde esa fecha — ver "Fecha para realizar y tareas bimestrales/anuales"). DAILY/WEEKLY/MONTHLY: una obligación por día/semana/mes planificado según `TaskPlanningInterval` (altas, bajas, reasignaciones y cambios de frecuencia), nunca fuera de lo planificado. URGENT/ONE_TIME: **una sola** obligación por tarea, si su ventana (desde la planificación hasta la finalización vigente, o hasta el cierre de la planificación si sigue pendiente) se superpone con el rango: completada antes del rango o creada después → no entra; completada durante el rango → entra; completada después del fin del rango → entra como pendiente.
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
| Novedad / respuesta | Su autor (desde 2026-10-30) | — | Nunca físico | Eliminación lógica: su autor o un ADMIN (ver «Edición y eliminación de mensajes en Novedades») |
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

## Conversaciones por novedad (2026-10-30)

- Una novedad conserva su persona reportante, fecha y texto. Puede tener respuestas planas, ordenadas de antigua a nueva; responder no crea otra novedad ni cambia el orden del historial o las tarjetas de Inicio.
- Todo `ADMIN` y `EMPLOYEE` autenticado y activo puede leer y responder en cualquier novedad visible. El autor es siempre el usuario de la sesión, con nombre visible resuelto como `Employee` → `UserProfile` → «Administrador»; no depende de la persona reportante ni de un selector. El alta original de novedades y «¿Quién reporta?» no cambian.
- Cada respuesta es texto plano, no vacío tras recortar extremos y de hasta 1000 caracteres. Conserva saltos de línea, no admite caracteres de control aparte de tabulador y saltos de línea, y React lo muestra como texto (nunca HTML). Edición y eliminación lógica desde el 2026-10-30 (sección siguiente).
- La cita es opcional, plana y debe pertenecer a la misma novedad. El cliente envía solo el ID de la respuesta citada; el backend comprueba la pertenencia y obtiene del servidor el nombre y texto citados. La cita se muestra aunque el mensaje original ya no esté en la página cargada.
- El hilo se carga al abrirlo: 20 respuestas más recientes, presentadas de antigua a nueva. «Ver respuestas anteriores» usa cursor compuesto por fecha e ID para añadir otras 20 al principio sin duplicados y conservar la posición de lectura.
- Las novedades muestran un contador agrupado y, si existe, «Última respuesta…». El listado no incluye cuerpos de respuestas; una respuesta nunca reordena novedades. Las novedades antiguas siguen siendo respondibles.
- Clave de envío estable por intento en `IdempotencyRecord` (actor + endpoint por novedad + clave + huella), reutilizando la utilidad transaccional del backend. La misma clave y cuerpo reproduce la respuesta; la misma clave con otro cuerpo da conflicto; otra clave permite texto repetido. Respuesta, auditoría y finalización idempotente se confirman en una sola transacción.
- Sin conexión no se envía ni se encola; no hay reintentos automáticos. Ante fallo, el compositor conserva texto, cita y clave para un reintento manual. Las conversaciones son independientes; Inicio sigue mostrando solo las novedades originales.
- Sin borrado físico de novedades ni respuestas. La FK restrictiva de la conversación impide cascadas. La eliminación agregada el 2026-10-30 es lógica y, por pedido explícito del usuario, conserva las respuestas de una novedad eliminada (sección siguiente); reemplaza la nota anterior que sugería rechazarla.

## Edición y eliminación de mensajes en Novedades (2026-10-30)

**Cambio funcional autorizado explícitamente por el usuario (2026-10-30).** El prototipo no permitía editar ni borrar novedades (§17). Solo aplica a Novedades: ningún otro módulo cambia de permisos.

- **Mensajes**: la novedad original y cada respuesta. Menú «⋯» en cada uno, solo con las acciones que el backend autoriza para quien mira (`permissions`); sin acciones, no hay menú.
- **Autor**: el usuario de la sesión que cargó el mensaje — `NewsReport.recordedByUserId` (quién REGISTRÓ, no quién reporta) y `NewsReply.authorUserId`. Nunca un nombre, el rol visible ni un `employeeId` enviado; los cuerpos son estrictos y rechazan cualquier campo de autor.
- **Permisos**: cada usuario activo edita y elimina sus propios mensajes (ADMIN y EMPLOYEE). Un ADMIN elimina mensajes ajenos para moderar, pero no edita sus palabras. Una novedad que un ADMIN registró a nombre de una persona es del ADMIN: la persona que reporta no la edita ni la elimina.
- **Novedades antiguas sin autor de carga** (`recorded_by_user_id` nulo: las 2 del seed): no se inventa atribución ni se habilita edición por coincidencia de empleado. Nadie las edita; un ADMIN puede eliminarlas (moderación).
- **Edición**: en el lugar del mensaje, texto multilínea, «Guardar cambios» / «Cancelar». Mismas validaciones que el alta (novedad: texto plano normalizado, ≤ 500; respuesta: texto plano no vacío, ≤ 1000, conserva saltos de línea). Misma fila: conserva ID, autor, persona que reporta, fecha original, cita y relaciones. Muestra «Editado · dd/mm/aaaa HH:mm» (zona de negocio). Sin cambios efectivos no escribe ni audita. Un mensaje eliminado no se edita.
- **Concurrencia**: cada mensaje tiene `version`; editar y eliminar envían la versión vista al abrir. Si cambió (otra pantalla editó o eliminó), 409 y no se pisa nada. La pantalla conserva el borrador, muestra la versión actual y pide elegir «Usar la versión actual» o «Conservar mi texto» antes de volver a guardar. Si el texto enviado ya es el vigente, responde sin escribir.
- **Eliminación lógica**: con confirmación. No se borran filas, respuestas ni auditorías; el texto queda solo en la base (y en la auditoría/idempotencia del backend). Se guardan quién eliminó (`deleted_by_user_id`, sin reemplazar al autor) y cuándo. Repetirla sobre un mensaje ya eliminado devuelve el marcador sin otra auditoría.
  - Respuesta eliminada: queda en su lugar como «Mensaje eliminado» (autor y fecha, sin texto, cita ni acciones; no se responde, edita ni vuelve a eliminar).
  - Novedad eliminada: queda «Novedad eliminada» y conserva sus respuestas, que no se modifican. Si ya tenía respuestas (aunque estén eliminadas), se puede abrir y seguir conversando; sin respuestas queda como marcador, sin ofrecer iniciar una conversación (409 `NEWS_CONVERSATION_CLOSED`).
- **Citas**: muestran el estado actual del mensaje citado — su texto vigente con «(editado)», o «Mensaje eliminado» sin su texto anterior —, también fuera de la página cargada. No se puede citar un mensaje eliminado (409 `NEWS_REPLY_QUOTE_DELETED`); si se elimina mientras alguien redacta, el borrador se conserva y la cita muestra el conflicto para quitarla o elegir otra. La cita sigue perteneciendo a la misma novedad (FK compuesta).
- **Texto eliminado fuera de la API**: listados, respuestas, citas, última respuesta, Inicio y reintentos idempotentes nunca lo devuelven. El reintento de un envío viejo (misma clave) devuelve el estado ACTUAL del mensaje creado (editado o eliminado), no el cuerpo guardado del primer envío.
- **Orden y contadores**: editar o eliminar no mueve novedades ni respuestas (orden por fecha original). Los marcadores conservan su lugar y cuentan en la paginación del historial y del hilo. **«N respuestas» cuenta solo respuestas no eliminadas**; la última respuesta se calcula entre las no eliminadas. Si solo quedan marcadores, la conversación se puede abrir aunque el contador sea 0.
- **Inicio y tarjeta de Más**: Inicio muestra las 3 novedades vigentes más recientes (las eliminadas se excluyen antes del límite, sin huecos) y nunca crea tarjetas por respuestas. La tarjeta de Más cuenta solo novedades vigentes («N hoy» / «N total»).
- **Auditoría** (misma transacción): `news.updated` / `news.reply.updated` con autor de la edición, momento y texto anterior/nuevo; `news.deleted` / `news.reply.deleted` con quien eliminó, el autor original y `moderated` cuando un ADMIN elimina un mensaje ajeno. No hay pantalla pública de auditoría.
- **Sin conexión**: no se envía ni se encola ninguna edición o eliminación; tampoco se repiten solas las de resultado ambiguo. Borradores, citas y formularios se conservan ante errores y al cancelar otras acciones.
- Fuera de alcance: notificaciones, reacciones, adjuntos y funciones de otros módulos.
## Múltiples administradores (Etapa 5U)

- **Función nueva autorizada explícitamente por el usuario (2026-09-28)**: desde Más → Configuración → Usuarios, un ADMIN crea otro ADMIN con «＋ Nuevo administrador» (nombre visible, PIN y confirmación). En el prototipo había un único administrador y el primero de la app nueva se crea con el bootstrap interactivo; esta es la única vía en la app para sumar más.
- El nuevo ADMIN **no es un Employee**: no recibe tareas, no aparece en Desempeño, responsables, recolecciones, Stock, autores ni selectores laborales. Su nombre visible vive en `UserProfile` (lo puede corregir desde Mi perfil).
- La cuenta nace `ACTIVE` y puede ingresar enseguida (selector de identidad + PIN). El rol `ADMIN` y el estado los fija el backend.
- **PIN**: string de exactamente 4 dígitos (conserva ceros iniciales); nunca se sugiere, genera ni usa uno predeterminado; ambos campos se limpian al cerrar, fallar o completar. Nombre: la validación única del nombre visible (5F).
- Después se administra como cualquier cuenta: otro ADMIN le cambia el PIN, lo suspende o deshabilita y lo reactiva, y le corrige el nombre visible desde Usuarios (✏️, solo en cuentas sin Employee; el nombre de una persona del equipo se corrige en Datos del equipo).
- **Un ADMIN nunca se suspende ni se deshabilita a sí mismo** → 409 «No podés desactivar tu propia cuenta.» (antes solo se impedía si era el único activo). **Nunca quedan 0 ADMIN activos**: la regla anterior, más la exigencia de que el actor siga activo cuando se aplica el cambio, garantizan que siempre queda al menos uno. El 409 «No podés desactivar al último administrador activo.» queda como defensa en profundidad.
- **Dos ADMIN desactivándose en simultáneo**: gana uno solo; el otro recibe 409 «Tu cuenta ya no está activa. Volvé a ingresar.» (o 401 si su sesión ya se revocó). Nunca quedan los dos inactivos.

## Tareas quincenales (2026-10-21)

- **Función nueva pedida explícitamente por el usuario**: frecuencia «Quincenal» (`SEMI_MONTHLY`) al crear y editar tareas, con los mismos permisos que las demás frecuencias (crear/editar solo `ADMIN`; completar y revertir según §4/§5). El prototipo no la tenía: no hay datos que migrar ni tareas existentes que convertir.
- **Regla acordada**: dos períodos por mes calendario, del **1 al 15** y del **16 al último día** (28, 29, 30 o 31), inclusive, en `BUSINESS_TIME_ZONE`. No es "cada 15 días" ni "cada 14 días": no depende de la creación ni de la última ejecución y no necesita fecha inicial. Completar el 10 cumple la primera quincena; el 16 vuelve a estar pendiente. Completar el 20 cumple la segunda; el 1 del mes siguiente vuelve a estar pendiente.
- **Una sola ejecución vigente por quincena** (mismo índice único parcial que las demás frecuencias); revertir libera la quincena. Un `EMPLOYEE` deshace lo propio solo dentro de la quincena vigente; un `ADMIN` corrige cualquier quincena con motivo.
- **Tarea creada a mitad de quincena**: esa quincena ya corre (pendiente), igual que una mensual creada a mitad de mes.
- **Cambio de frecuencia o responsable**: nunca reinterpreta ejecuciones anteriores. Una ejecución mensual/diaria/semanal no "cumple" la quincena (claves distintas) y una quincenal tampoco cumple otra frecuencia.
- **Desempeño e Inicio**: cuentan como las mensuales — una obligación por cada quincena planificada que **empieza** (día 1 o 16) dentro del rango (7/14/30 días), con el responsable vigente al cierre o el snapshot de la ejecución. Inicio usa exactamente la misma función.
- **Historial semanal**: igual que las mensuales, aparecen en «Finalizaciones de la semana» por fecha de finalización y **no** suman slots al conteo realizadas/esperadas (ese conteo solo contempla diarias y semanales: una quincena no entra en una grilla de lunes a domingo).
- **Calendario de Configuración** (indicador aproximado, §5): marca las quincenales el primer día de cada quincena (1 y 16), como marca las mensuales el día 1.

## Fecha para realizar y tareas bimestrales/anuales (2026-10-23)

Función nueva pedida explícitamente por el usuario. El prototipo no tenía fecha en las «Una vez» ni estas frecuencias: no hay datos que migrar ni tareas existentes que convertir. Permisos sin cambios: crear, editar, reprogramar y quitar la fecha = solo `ADMIN`; completar y revertir según §4/§5.

**«Fecha para realizar» (solo `ONE_TIME`, opcional)**

- Fecha de calendario sin hora en `BUSINESS_TIME_ZONE`; identifica un día concreto (se muestra con el día de la semana: «Lunes 26/10/2026»). Puede ser pasada, para registrar una pendiente atrasada (años 2000–2100).
- Estado de una tarea con fecha y sin completar, calculado por el backend: **Programada** (fecha futura), **Para hoy** (es hoy) y **Vencida** (ya pasó). Sin fecha: la presentación de siempre.
- Se puede completar **antes** de la fecha. Completada, conserva auditoría e historial y sale del listado operativo como cualquier «Una vez»; revertida, vuelve a pendiente con el estado que corresponda.
- La clave sigue siendo `ONE_TIME`: cambiar la fecha nunca crea otra obligación ni permite completarla otra vez si tiene una ejecución vigente.
- Editar: omitir la fecha la deja igual; `null` la quita; una fecha para otra frecuencia se rechaza (400). Pasar de «Una vez» a otra frecuencia quita la fecha en la misma transacción; queda como antecedente en la planificación cerrada y en la auditoría (valor anterior y nuevo). Cada reprogramación es una versión nueva de la planificación.
- Tareas: el filtro «Una vez» muestra todas (también las programadas para más adelante y las sin fecha) y suma los accesos «Hoy» y «Vencidas», combinables con la persona. La burbuja de pendientes de cada persona no cuenta las programadas para más adelante. Configuración → Calendario marca la tarea en su fecha.

**Bimestral y Anual**

- Bimestres de calendario (ene–feb, mar–abr, may–jun, jul–ago, sep–oct, nov–dic) y año calendario (1/1–31/12), en `BUSINESS_TIME_ZONE`, sin fecha inicial. Una ejecución vigente por tarea y período (mismo índice único parcial), con claves propias (`YYYY-B1…B6`, `YYYY-A`): una ejecución de otra frecuencia nunca "cumple" el bimestre ni el año al cambiar la frecuencia, ni al revés.
- Creada a mitad de bimestre o de año: ese período ya corre (pendiente), igual que una mensual creada a mitad de mes. Un `EMPLOYEE` deshace lo propio solo dentro del período vigente; un `ADMIN` corrige con motivo.
- Ayudas del formulario: «Una vez por bimestre calendario: ene–feb, mar–abr…» y «Una vez por año calendario». Calendario de Configuración: el 1 de cada bimestre y el 1 de enero.

**Inicio y Desempeño** (una sola función, `getPerformance`; el frontend no calcula nada)

- Bimestral y Anual: el criterio de las mensuales — una obligación por cada período planificado que **empieza** (1 de ene/mar/may/jul/sep/nov; 1/1) dentro del rango (7/14/30 días), con el responsable vigente al cierre o el snapshot de la ejecución.
- «Una vez» con fecha: sigue siendo **una** obligación por tarea, pero solo cuenta como pendiente donde ya era exigible según la versión de planificación de cada momento: programada para después → no entra; para hoy o vencida → entra; completada (antes, el día o después de la fecha) → entra en el rango de su finalización. Reprogramar no reescribe lo esperado antes: un rango en que estuvo vencida la sigue contando, con el responsable de entonces. Sin fecha: exactamente la regla anterior.
- KPI operativo de Inicio («Tareas completadas»): no cuenta las «Una vez» programadas para después de hoy.
- Historial semanal: bimestrales, anuales y «Una vez» en «Finalizaciones de la semana», fuera del conteo realizadas/esperadas (solo diarias y semanales).

**Ejemplo con resultado concreto** (rango de Inicio 16–22/10/2026, visto el jueves 22): Juan tiene una «Una vez» para el 30/10 (no cuenta), una para hoy y una vencida el 12/10 (pendientes), una que vencía el 30/10 y completó el 20/10 (propia), una que vencía el 14/10 y el 20/10 se reprogramó al 05/11 y se reasignó a Coke (pendiente de Juan: estuvo vencida del 16 al 20) y una del 18/10 que hizo Coke (cubierta) → 5 asignadas, 1 realizada personalmente, 3 sin completar, 1 cobertura recibida: **20%**. Coke: 1 cobertura realizada. Una semana después (23–29/10) la reprogramada no cuenta para nadie: recién vence el 05/11.

**Mascotas, sin cambios**: vacunas y desparasitaciones siguen con su «Fecha de próxima aplicación o control» y 📅 Vencimientos. Completar una tarea no crea registros clínicos, no hay recurrencias veterinarias automáticas ni vínculos entre Tareas y Mascotas.

## Orden de realización y programación sugerida (2026-10-24)

Función nueva pedida explícitamente por el usuario. Permisos sin cambios: cargar, editar o quitar orden y sugerencia = solo `ADMIN` (como el resto de la edición de tareas). Las tareas existentes quedan sin orden ni sugerencia: no se completa nada automáticamente.

**Orden de realización** (todas las frecuencias, opcional)

- Entero de 1 a 9999; se admiten repetidos; vacío = sin orden (nunca 0). Ayuda: «Los números menores aparecen primero. Es opcional».
- **Orden del listado operativo — fecha antes que número** (correctivo pedido por el usuario el 2026-10-26; reemplaza al criterio inicial, que ponía el número antes que la fecha). Los grupos de frecuencia no cambian ni se mezclan (urgentes primero, como siempre). Dentro de cada grupo:
  - **Diarias y urgentes**: orden de realización ascendente; las sin número, al final.
  - **Semanales, quincenales, mensuales, bimestrales, anuales y «Una vez»**: primero las que tienen fecha, de la más antigua a la más futura; con la misma fecha, por orden de realización ascendente (las sin número, después de las numeradas); después, todas las sin fecha, por orden ascendente y las sin número al final. La fecha de una recurrente es la **fecha sugerida del período vigente** que calcula el backend (una quincenal sin sugerencia para la quincena en curso cuenta como sin fecha); la de una «Una vez», su **fecha para realizar**.
  - Empates (misma fecha y mismo número, o ninguno de los dos): por descripción y, al final, un desempate estable por identificador.
  - Nunca se ordena por estado ni por cumplimiento: completada, pendiente o desactivada (vista administrativa) quedan donde las ubica la regla.
  - Ejemplo dentro de una misma frecuencia: 15 de enero con orden 2 → 19 de enero con orden 1 → 19 de enero con orden 3 → sin fecha con orden 1.
- Se aplica al listado operativo y, por lo tanto, a los filtros por persona y frecuencia (filtran sin reordenar) y a lo que sale de ese listado (tareas de un día en el calendario de Configuración; urgentes de Inicio, cuyo criterio no cambia). No hay paginación en este listado. Agrupación y filtros, sin cambios. No requiere migración ni modifica datos guardados.
- No reordena el historial cronológico ni cambia vencimientos, permisos, períodos, Desempeño, métricas ni reportes. Sin arrastrar ni renumerar.

**Programación sugerida** (solo recurrentes, opcional)

- Semanal: día de la semana. Quincenal: un día del 1 al 15 para la primera quincena y otro del 16 al 31 para la segunda, cada uno opcional. Mensual: día del mes (1–31). Bimestral: primer o segundo mes del bimestre y día. Anual: mes y día. Bimestral y anual necesitan los dos datos o ninguno. Diaria y urgente no tienen; «Una vez» conserva su fecha para realizar.
- Es una SUGERENCIA: no bloquea completar antes o después dentro del período, no cambia cuándo empieza o termina el período, no crea ejecuciones, no cambia estados, vencimientos ni porcentajes y no arrastra pendientes.
- Un día que no existe en el mes se toma como el último: 31 de abril → 30 de abril; 29 de febrero en un año no bisiesto → 28 (lo explica la ayuda del formulario).
- El backend calcula la fecha sugerida del período vigente (zona de negocio) y la tarjeta la muestra como «Sugerida: miércoles 28/10/2026», sin estilo de vencimiento.

**Edición**: campo omitido = se conserva; `null` = se quita; editar otro campo nunca borra orden ni sugerencia. Un dato que no corresponde a la frecuencia se rechaza. Al cambiar de frecuencia se quita SOLO la sugerencia que deja de valer (p. ej. semanal → mensual quita el día de la semana; mensual día 31 → anual conserva el día si se elige el mes) y el orden se conserva; el formulario lo avisa, y todo se guarda en una transacción con auditoría (valor anterior y nuevo).

**Historia**: orden y sugerencia no cambian ningún cálculo, así que no abren una versión de la planificación ni reinterpretan ejecuciones; su historia es la auditoría. Ninguna vista histórica (historial semanal, Desempeño) los muestra, para no atribuirles la configuración actual.

**Calendario de Configuración**: una tarea con sugerencia se ubica solo en sus fechas sugeridas, una por período, desde su período vigente; los días anteriores conservan la marca de siempre. Sin sugerencia, la marca de siempre.

## 🐾 Atenciones de mascotas en Inicio (2026-10-26)

Función nueva pedida explícitamente por el usuario: el Inicio del prototipo no la tenía. Es de solo lectura, con el permiso de lectura de 📅 Vencimientos (todo usuario autenticado; `ADMIN` y `EMPLOYEE` ven lo mismo). No agrega acciones: no se cumple, programa ni corrige nada desde Inicio, y no crea tareas, eventos ni registros.

- **Qué entra**: los pendientes abiertos (regla de §12: registro vigente, con próxima fecha y sin cumplimiento vigente) de mascotas **activas** que estén **vencidos** (cualquier fecha anterior a hoy), **vencen hoy** o son **próximos** (del día siguiente hasta 30 días inclusive), con las fechas de calendario de `BUSINESS_TIME_ZONE`.
- **Qué no entra**: atenciones cumplidas, registros anulados, mascotas inactivas, registros sin próxima fecha y vigentes a más de 30 días. Si se anula la atención que cumplió un pendiente, el pendiente vuelve a aparecer (el estado se calcula, no se guarda).
- **Orden y tope**: el de 📅 Vencimientos — fecha ascendente, así que primero las vencidas (la más antigua arriba), después las de hoy y después las próximas (la más cercana arriba); con la misma fecha, por fecha de la atención original y por identificador (estable). Se muestran a lo sumo **5**; el filtro y el orden se aplican antes de limitar.
- **Totales**: «2 vencidas · 1 hoy · 3 próximas» (el texto del indicador del listado de Mascotas: omite los ceros) cuenta **todas** las atenciones que entran, no solo las 5 filas.
- **Cada fila**: nombre de la mascota; tipo con las etiquetas del módulo (💉 Vacuna, 🪱 Desparasitación, 🩺 Chequeo, 📋 Evento); descripción breve si existe (una línea); «Programada: dd/mm/aaaa»; estado con texto (Vencida, Vence hoy, Próxima); tiempo relativo del módulo («Hace 3 días», «En 4 días»; en las de hoy, el estado «Vence hoy» ya lo dice). Dos atenciones del mismo tipo de una misma mascota son dos filas.
- **Navegación**: «Ver vencimientos» abre 📅 Vencimientos; tocar una atención abre la ficha de esa mascota ubicada en «Próximas atenciones» (desde ahí se registra la aplicación o el control, como siempre).
- **Sin resultados**: «No hay atenciones vencidas ni previstas para los próximos 30 días», con «Ver vencimientos». Si este resumen no se pudo calcular, la tarjeta lo dice y ofrece reintentar; nunca muestra el mensaje vacío por una falla, y las demás tarjetas de Inicio se ven igual.
- **Actualización**: registrar una atención (con o sin próxima fecha), cumplirla, anular un registro, corregir la próxima fecha y activar, desactivar, editar o eliminar una mascota actualizan Inicio. Al empezar un día nuevo, Inicio se revalida con el reloj compartido confirmado por el backend, como el resto de sus tarjetas.

## 🥬 Huerta (2026-10-26)

Módulo NUEVO pedido explícitamente por el usuario: el prototipo no lo tenía. Primera versión con participantes, actividades, historial y Desempeño propios. **Fuera de alcance**: cultivos, cosechas, insumos, inventario, fotos y notificaciones.

**Independencia de ✅ Tareas.** Datos, endpoints y caché propios: una actividad de la Huerta nunca se guarda en Tareas, ninguna tarea se copia, mueve ni clasifica como Huerta, y la Huerta no aparece en los listados, contadores, historial ni Desempeño de Tareas, ni en Inicio. El único acceso global es «🥬 Huerta» en la navegación. Comparte con Tareas solo las reglas: frecuencias, períodos, estados de «Una vez», sugerencias, orden y criterios de Desempeño son exactamente los mismos.

**Participantes**

- Un ADMIN los agrega y desactiva eligiendo **usuarios activos ya existentes** de la app: empleados y administradores, una sola vez por persona (aunque tenga usuario y ficha de empleado). La identidad es el usuario, nunca el nombre. No se crean usuarios ni empleados, y nada viene precargado: el módulo empieza vacío.
- Participar no cambia el rol ni los permisos globales. Un ADMIN sin ficha de empleado puede participar y se muestra con su nombre real (Mi perfil).
- Desactivar la participación conserva actividades e historial. Si tiene actividades activas asignadas, se rechaza con un mensaje claro («tiene N actividades activas asignadas. Reasignalas o desactivalas primero»); nada se reasigna ni se borra solo. Volver a agregar a quien fue desactivado reactiva la misma participación.
- Suspender o deshabilitar la cuenta de una persona no borra su historia en la Huerta; deja de aparecer entre los candidatos.

**Permisos**

| Acción | ADMIN | Participante activo | Otro usuario |
| --- | --- | --- | --- |
| Abrir la Huerta y consultar actividades, historial, participantes | ✔ | ✔ | ✔ |
| Agregar/desactivar participantes; crear, editar, asignar, activar/desactivar actividades | ✔ | — | — |
| Completar | cualquiera, indicando quién la realizó (participante activo) | solo las asignadas a él, a su nombre | — |
| Deshacer | cualquiera vigente, con motivo | lo que completó él, en el período vigente | — |
| Desempeño | todos los participantes y el detalle de cada uno | solo lo suyo | nada (no participa) |

Todo se valida también en el backend.

**Actividades** — las mismas reglas que Tareas (§4–§5, "Tareas quincenales", "Fecha para realizar…", "Orden de realización…"): diaria, semanal (lunes a domingo), quincenal (1–15 y 16–último día), mensual, bimestral (ene–feb, mar–abr…), anual, urgente y «Una vez»; «Una vez» con fecha Programada/Para hoy/Vencida y sin fecha sin estado; cumplimiento anticipado permitido; una «Una vez» completada sale del listado activo y se consulta en el historial; sugerencias por frecuencia (el día que no existe toma el último del mes) que solo orientan; orden fecha → número (diarias y urgentes solo por número). Edición parcial: omitido conserva, `null` quita; cambiar la frecuencia limpia solo lo incompatible y el formulario lo avisa. Sin borrado físico desde la operación: se desactivan.

**Ejecuciones e historial** — cada finalización guarda por separado el responsable esperado, quién la realizó y el usuario que la registró (siempre la sesión). Una sola ejecución vigente por actividad y período (también en la base). Deshacer es lógico y auditado. Reasignar, cambiar la frecuencia o reprogramar abren otra versión de la planificación: el pasado no se reescribe. El historial semanal usa el criterio del de Tareas y se filtra por participante.

**Desempeño de la Huerta** — pestaña propia, sin conexión con el Desempeño general ni con Inicio. Mismos rangos (7, 14 y 30 días), obligaciones y métricas que Tareas → Desempeño, calculados por el backend con la planificación histórica de la Huerta. Una «Una vez» con fecha futura todavía no es exigible. Sin obligaciones, «Sin actividades previstas» (nunca un 0 %).

*Ejemplo* (7 días, del 20 al 26/10/2026, visto el lunes 26 a las 18 h; participantes Pablo y una administradora):
- «Regar almácigos», diaria de Pablo: la hizo él el 20, 21, 22 y 24; el 23 la hizo la administradora (cobertura); el 25 y el 26, sin completar → 7 obligaciones de Pablo: 4 propias, 1 cubierta, 2 pendientes.
- «Ventilar invernadero», diaria reasignada el 24 al mediodía de Pablo a la administradora: del 20 al 23 es de Pablo (hizo el 20 y el 21) y del 24 al 26 de ella (hizo el 24 y el 25). Cada día cuenta una sola vez, para el responsable vigente al cierre de ese día.
- «Desmalezar canteros», semanal de la administradora: la semana del 26 (la del 19 empezó antes del rango) → hecha.
- «Revisar riego por goteo», «Una vez» para el 24, de Pablo, sin completar → pendiente. «Sembrar lechuga», «Una vez» para el 30 → todavía no cuenta.
- Resultado: **Pablo** 12 asignadas, 6 propias, 1 le cubrieron, 5 sin completar → **50 %**. **Administradora** 4 asignadas, 3 propias, 1 sin completar, cubrió 1 → **75 %** (la cobertura no suma a su porcentaje). **Equipo** 16 asignadas, 9 propias → **56,3 %**. Un tercer participante sin actividades: «Sin actividades previstas».

## Tareas realizadas que se olvidaron marcar (2026-10-30)

Función nueva pedida explícitamente por el usuario: la app está en uso y el equipo está aprendiendo a usarla, así que alguien puede hacer una tarea un día, olvidarse de marcarla y querer registrarla al día siguiente. Solo ✅ Tareas generales (🥬 Huerta no cambia). Desempeño, Inicio, el flujo normal de completar y las «Una vez» vencidas siguen con sus reglas.

**Dónde y qué**: en Tareas → 🏆 Desempeño → Detalle, las filas «Sin completar» que el backend marca como elegibles muestran «Marcar como realizada». Registra que esa obligación (tarea + período de la fila) se hizo en una fecha real; **nunca** usa el período vigente como el check de Tareas. Las diarias antiguas no se agregan al listado de Tareas.

- **Elegibles** (lo decide el backend con el mismo cálculo de Desempeño): obligaciones recurrentes (diaria, semanal, quincenal, mensual, bimestral, anual) pendientes cuyo período **empieza** dentro de los últimos 30 días incluido hoy (el rango más largo de Desempeño; los rangos no se amplían). Incluye el período en curso. Sin límite propio de 7 días. Como en Desempeño, una mensual, bimestral o anual solo figura mientras su primer día cae dentro de esos 30 días.
- **No elegibles**: realizadas o cubiertas; «Una vez» y urgentes (no tienen períodos: la fila ofrece «Completar en Tareas» si la tarea sigue activa, con su flujo normal y sin inventarles períodos); obligaciones fuera de la ventana.
- **Diaria**: confirmación sencilla con la fecha fijada por la fila — «¿Confirmás que realizaste “Aspirar planta baja” el 29/10/2026?» (para un ADMIN: «¿Confirmás que “…” se realizó el 29/10/2026?»). No se puede elegir otro día.
- **Períodos más largos**: se muestra el período («26/10/2026 al 01/11/2026») y se pide «Fecha en que la realizaste» (ADMIN: «Fecha en que se realizó»), sin preseleccionar ninguna. Debe estar dentro del período, no puede ser futura y no puede ser anterior al día en que la tarea empezó a tener esa frecuencia dentro del período (creada o cambiada a mitad de período). El inicio de la semana o del mes nunca se usa como fecha de realización.
- **Sin motivo**: es una carga olvidada, no una corrección administrativa.
- Se puede registrar una obligación pasada aunque la del período actual ya esté completada; la de hoy y los demás períodos no cambian.

**Permisos**

| Quién | Puede |
| --- | --- |
| EMPLOYEE activo | Registrar a su nombre una obligación que le correspondía (responsable histórico de ese período). No registra por otra persona ni se atribuye una obligación ajena. |
| ADMIN | Registrar cualquier obligación elegible eligiendo explícitamente quién la realizó, entre los empleados activos (las personas habilitadas de siempre). Si no es el responsable, queda como cobertura. |

El autor de la carga sale siempre de la sesión. Ocultar el botón no reemplaza la validación: el backend rechaza lo que no corresponde.

**Fuente única de obligaciones**: el backend reconstruye la obligación pedida con la misma lectura de planificación y ejecuciones y el mismo calculador que Desempeño. Del cliente solo acepta la identificación (tarea + período de la fila), la fecha real y, para un ADMIN, quién la realizó; nunca el responsable, la frecuencia, el estado pendiente ni un período arbitrario. Si la obligación dejó de ser elegible o ya figura como realizada desde que se abrió la pantalla, responde 409 con un mensaje claro y la pantalla actualiza los datos.

- **Historia**: el responsable y la frecuencia son los de la planificación de ese período (reasignar o cambiar la frecuencia después no cambia la obligación anterior). No se puede registrar un período en que la tarea todavía no existía o no tenía esa obligación. Una desactivación posterior no borra la obligación ni invalida la carga de cuando estaba planificada; completar desde Tareas una tarea desactivada sigue bloqueado.

**Fechas y registro** (separados): período (`periodKey`), responsable histórico (`assignedEmployeeId`), persona que la realizó (`completedByEmployeeId`), usuario que la registró (`recordedByUserId` + auditoría `task.completed_late`), **fecha real de realización** (`performedOn`, solo el día: nunca se inventa una hora) y **momento real del registro** (`completedAt`, el instante en que se cargó; nunca se adelanta para simular otra fecha). Las ejecuciones anteriores y las del flujo normal conservan su significado y sus valores (`performedOn` vacío: se realizó cuando se registró). Fechas en `BUSINESS_TIME_ZONE` con el día del servidor.

**Duplicados y concurrencia**: una sola ejecución vigente por tarea y período (el índice único de siempre). Doble clic, varias solicitudes a la vez o alguien que la registró o cubrió mientras tanto → una sola ejecución; las demás reciben 409 y nunca se reemplaza ni se cambia el período de una ejecución existente.

**Deshacer**: el EMPLOYEE puede deshacer su carga olvidada (la que realizó y registró él) el mismo día de negocio en que la registró — «Deshacer» en la fila del detalle o en el historial —, con motivo opcional. No se habilita deshacer ejecuciones antiguas del flujo normal. El ADMIN conserva sus correcciones administrativas (cualquier ejecución vigente, motivo obligatorio). Deshacer nunca borra: la fila queda revertida y auditada, y el período se puede volver a registrar.

**Desempeño, Inicio e historial**: la fila elegida pasa a realizada (o cubierta, si la hizo otra persona) y se recalculan resumen, detalle, porcentajes e Inicio con las reglas de siempre. El denominador no cambia, una cobertura no suma al porcentaje de quien la tenía asignada ni de quien la cubrió, y ningún otro período o métrica cambia. El historial semanal ubica la ejecución en su período (diarias y semanales por su clave; quincenales, mensuales, bimestrales, anuales, urgentes y únicas por la fecha real de realización) e interpreta cada ejecución con la frecuencia que tenía la tarea cuando se registró, no solo con la actual. Donde corresponde se muestra «Realizada el 29/10 · Registrada el 30/10».

*Ejemplo* (el pedido): Coke tenía la diaria «Aspirar planta baja» el 29/10, la hizo y no la marcó. El 30/10 abre Desempeño → Detalle, toca «Marcar como realizada» en la fila del 29/10 y confirma. Queda completada solo la obligación del 29/10 (realizada por Coke, responsable Coke, `performedOn` 29/10, registrada el 30/10 por el usuario de Coke); la del 30/10 sigue pendiente, en el detalle y en Tareas. Su porcentaje sube una realización personal sin cambiar las asignadas. Ese mismo 30/10 Coke puede deshacerla; desde el 31/10, solo un ADMIN con motivo.

## Detalle de Desempeño: orden, filtros y «Ver más» (2026-10-30)

Pedido explícito del usuario. Solo ✅ Tareas → 🏆 Desempeño → Detalle; 🥬 Huerta conserva su detalle completo. No cambia cómo se generan las obligaciones ni ninguna regla o métrica de Desempeño: es orden, filtro y paginación sobre las obligaciones que ya calcula el backend para el rango elegido (7, 14 o 30 días).

**Orden y agrupación** (los decide el backend):

- Más recientes primero: hoy, ayer y los días anteriores, agrupados con un encabezado por día («Hoy · Viernes 30/10/2026», «Ayer · …», «Miércoles 28/10/2026»).
- Diaria: en su fecha. Semanal, quincenal, mensual, bimestral y anual: en el **primer día de su período**, solo para ubicarla; la fila muestra el período completo («26/10/2026 al 01/11/2026 · Semanal»), nunca su inicio como vencimiento. «Una vez»: en su fecha para realizar (la de la planificación que usó el cálculo). «Una vez» sin fecha y urgentes: sin fecha inventada, en un grupo **«Sin fecha» al final**.
- Con la misma fecha: por descripción y, para desempatar, por tarea y período (orden total y estable: dos obligaciones nunca empatan).

**Filtros** (se combinan; los valida y aplica el backend; nunca generan obligaciones fuera del rango):

- **Fecha**: todas o un día del rango, elegido con un **calendario** que solo permite días del rango (7, 14 o 30 días, nunca futuros) y muestra la fecha con el formato de la app («Miércoles 28/10/2026»); «Todas las fechas» quita la selección. Una recurrente de período largo coincide si su período contiene ese día; una «Una vez» con su fecha para realizar; las sin fecha no coinciden con ningún día. Un día escrito a mano fuera del rango no se aplica y se explica; el backend también lo rechaza (400).
- **Frecuencia**: Todas, Diarias, Semanales, Quincenales, Mensuales, Bimestrales, Anuales, Urgentes y Una vez.
- **Estado**, visto desde la persona del detalle: Todas, **Sin completar**, **Realizadas** (cumplimiento personal: propias hechas por ella), **Cubiertas** (propias hechas por otra persona) y **Cubrió a otros** (ajenas que hizo ella; opción aparte, nunca cumplimiento personal).
- «Limpiar filtros» vuelve a todas. Sin coincidencias: «No hay obligaciones con estos filtros.».
- Si al cambiar el día de negocio el día elegido queda fuera del rango, el filtro vuelve a «Todas las fechas» y se avisa.

**Resumen independiente**: porcentajes, asignadas, realizadas, sin completar y coberturas (tarjetas y lista de personas) siguen siendo las de **todo** el rango; filtros y páginas solo cambian las filas del detalle.

**«Ver más»**: primera carga de 20 obligaciones; «Ver más» agrega las 20 siguientes sin reemplazar las anteriores, con «Mostrando X de Y registros» (Y = total filtrado). Se oculta cuando no quedan, se deshabilita mientras carga y, si falla, conserva lo cargado y ofrece «Reintentar». Cambiar persona, rango o filtros vuelve a la primera página. Un día que cruza dos páginas sigue siendo un solo grupo, sin filas repetidas.

**Marcar como realizada**: sin cambios de reglas (fechas, permisos, concurrencia, reversión). Después de registrar o deshacer se actualizan resumen y detalle, volviendo a pedir las páginas en orden desde la primera; se conservan persona y filtros (con «Sin completar», la fila registrada deja de aparecer).

**Permisos**: los de siempre, en el backend: EMPLOYEE solo su detalle; ADMIN el de cualquier persona.

### Acciones compactas y «Deshacer» desde el detalle (2026-10-30)

Ajuste pedido explícitamente por el usuario. Solo ✅ Tareas; 🥬 Huerta sin cambios.

- **Acciones compactas**: «Marcar realizada» (botón secundario chico) y «Deshacer» (fantasma), a la derecha del estado y en la misma línea; en móvil bajan juntos a una línea propia sin pisar descripción, fecha ni estado. Área táctil de 44 px. El nombre accesible agrega la tarea y el período («Marcar realizada: Aspirar planta baja, 29/10/2026 · Diaria»). Confirmaciones y protección contra doble envío, sin cambios.
- **«Deshacer»** aparece en toda obligación realizada o cubierta cuya ejecución vigente el backend permite revertir a quien mira (el detalle informa la ejecución y ese permiso, calculado con la misma regla que la reversión). Usa la reversión de siempre (`POST /tasks/:id/revert`, su diálogo y su auditoría), que sigue siendo la autoridad. **Límites que se conservan**:
  - EMPLOYEE: solo lo que realizó él, y solo en el período vigente de la tarea (flujo normal) o, si fue una carga olvidada que registró él, el mismo día de negocio en que la registró. Una ejecución anterior del flujo normal (p. ej. la diaria de ayer) no muestra «Deshacer» y el backend la rechaza (403). Tampoco deshace lo que otra persona realizó por él ni lo que registró un ADMIN a su nombre fuera del período vigente.
  - ADMIN: corrige cualquier ejecución vigente con motivo obligatorio.
  - Nunca se borra nada: la ejecución queda revertida (quién, cuándo, motivo) y auditada (`task.completion_reverted`).
  - Dos reversiones a la vez o una pantalla desactualizada: una sola aplica; la otra recibe un mensaje claro (409 «Esta finalización ya fue revertida.» o 403) y la pantalla se actualiza.
- **Después de deshacer**: la obligación exacta vuelve a «Sin completar»; se actualizan resumen, porcentajes, detalle, historial, Inicio y el listado de Tareas (las mismas invalidaciones de siempre). Se conservan persona y filtros, y las páginas se vuelven a pedir desde la primera (con «Realizadas» la fila deja de aparecer; con «Todas», aparece pendiente). En Tareas: una «Una vez» completada reaparece pendiente si sigue activa; una urgente vuelve a pendiente; una recurrente del período vigente vuelve a pendiente en su única fila; deshacer un período anterior **no** cambia el período actual (si hoy está completada, sigue completada); no aparecen filas históricas ni duplicadas; y deshacer no reactiva una tarea desactivada.

## Urgentes completadas fuera del listado de Tareas (2026-10-30)

Pedido explícito del usuario. Una urgente con su finalización vigente **sale del listado operativo de Tareas** («Todas» y «Urgentes»), igual que una «Una vez» completada; la pendiente se ve como siempre. Ocultar no borra ni desactiva: tarea, ejecución, planificación y auditoría se conservan; la finalización sigue en el historial semanal y en Desempeño (con «Deshacer» donde el backend lo autoriza), y un `ADMIN` la ve y administra con «Incluir desactivadas y completadas («Una vez» y urgentes)». Si se deshace, vuelve pendiente (una sola fila) siempre que la tarea siga activa: deshacer no reactiva una desactivada. «Una vez» y recurrentes no cambian (las recurrentes completadas siguen tachadas durante su período), ni el orden de las que quedan. Con «Urgentes» y ninguna pendiente: «No hay urgentes pendientes.». Las métricas no cambian: Desempeño e Inicio siguen contando las urgentes como antes (el KPI «Tareas completadas» de Inicio incluye las urgentes completadas).
