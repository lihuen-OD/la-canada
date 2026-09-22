# DATABASE.md — Modelo de datos reconstruido a partir de `index.html`

> El HTML no incluye ningún schema SQL ni definición de tablas — todo lo aquí descrito se **infiere** de cómo el JavaScript lee y escribe contra la API REST de Supabase (`sbGet`/`sbPost`/`sbFetch`, y los mapeos de fila a objeto en `loadAll()` y cada `loadX()`). Cada tabla indica qué está **comprobado** (nombre de columna usado literalmente en el código) versus **inferido** (tipo de dato, nulabilidad, restricciones) versus **pendiente de definición** (no hay evidencia en el HTML). No se accedió al proyecto Supabase real para confirmar nada de esto.

## Tablas identificadas (18)

Todas confirmadas por uso directo en el código: `personas`, `tareas`, `ejecuciones`, `stock`, `novedades`, `eventos`, `fotos`, `pines`, `gallinero`, `recolecciones`, `mascotas`, `registros_clinicos`, `tipos_mascota`, `empleados_datos`, `hijos`, `consumos`, `destinos_consumo`, `categorias_stock`.

---

### `personas`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | usado como `p.id` |
| `nombre` | text | — |
| `rol` | text | valores observados: "Doméstica", "Parque"; el `<select>` del modal también ofrece "Otro" — es texto libre, no enum en el código |
| `color` | text | hex color, ej. `#4a7c59` |
| `activa` | boolean | baja lógica (`togPers`) |

- Restricciones inferidas: `nombre` requerido (validado en JS antes de enviar). Sin unicidad de nombre observable en el código (dos personas podrían llamarse igual).
- Riesgo de integridad: ninguna tabla relacionada usa `ON DELETE` observable — las personas nunca se borran (solo baja lógica), por lo que no hay riesgo de huérfanos por borrado, pero si en algún momento se agrega un borrado físico, romperá múltiples FKs (`tareas.persona_id`, `novedades.persona_id`, `fotos.persona_id`, `recolecciones.persona_id`, `registros_clinicos.persona_id`, `empleados_datos.persona_id`, `hijos.persona_id`, `consumos.persona_id`, `ejecuciones.completado_por`, `pines.persona_id`).

### `tareas`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `descripcion` | text | |
| `persona_id` | int, FK → `personas.id` | |
| `frecuencia` | text | valores: `diaria`, `semanal`, `mensual`, `urgente`, `unica` — **candidato a enum en Postgres** |

- Pendiente de definición: no hay columna `activa`/`activo` en la tabla real (el JS que la espera está roto, ver `docs/BUSINESS_RULES.md` §6) — decidir si se agrega en el nuevo modelo.
- Riesgo de integridad: `dbDelTarea` borra físicamente la tarea Y sus `ejecuciones` asociadas (borrado en cascada hecho a mano en JS, no a nivel de base) — en Postgres esto debería ser `ON DELETE CASCADE` explícito o borrado lógico.

### `ejecuciones`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `tarea_id` | int, FK → `tareas.id` | |
| `periodo` | text | `YYYY-MM-DD` para diaria/semanal/mensual, o el string literal `'urgente'`/`'unica'` — **mezcla fechas con literales en la misma columna de texto**, ver riesgo abajo |
| `done` | boolean | |
| `fecha_done` | timestamp, nullable | ISO string |
| `completado_por` | int, FK → `personas.id`, nullable | persona que efectivamente completó la tarea, si difiere del asignado |
| `nota` | text, nullable | |

- Restricción inferida: única combinación (`tarea_id`, `periodo`) — el código usa `resolution=merge-duplicates` al hacer upsert (línea 1907), lo que sugiere una **unique constraint compuesta** `(tarea_id, periodo)` del lado de Supabase, no verificable directamente pero fuertemente implícita por ese uso de la API.
- Riesgo de integridad: mezclar fechas reales con literales (`'urgente'`, `'unica'`) en una columna de texto impide usar tipo `date` nativo y dificulta reportes por fecha — en el rediseño, considerar separar en `periodo_fecha (date, nullable)` + `periodo_tipo (enum)`, o un modelo distinto para tareas no recurrentes.

### `stock`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `nombre` | text | |
| `stock` | numeric | usa `parseFloat`, admite decimales |
| `minimo` | numeric | ídem |
| `unidad` | text | texto libre (litros, kg, unidades, rollos, pares, metros, ...) |
| `categoria` | text | texto libre, no FK — ver duda abajo |
| `area` | text | `casa` \| `jardin` — **candidato a enum** |

- ⚠️ **Duda de integridad real**: `categoria` se guarda como texto libre en `stock`, mientras que existe una tabla separada `categorias_stock` con sus propios nombres. No hay FK entre ambas en el código — si se renombra o elimina una categoría en `categorias_stock`, los ítems de `stock` que ya tenían ese texto **no se actualizan** (`eliminarCategoria` explícitamente dice "Los ítems que la usan no se borran", línea 3497, confirmando que quedan con el nombre viejo suelto). Al migrar a Prisma, evaluar si conviene una FK real `categoria_id` (con la contra de forzar la categoría a preexistir) o mantener texto libre desnormalizado a propósito.
- Riesgo de integridad: sin control de concurrencia (ver `docs/ARCHITECTURE.md` §2.11).

### `novedades`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `persona_id` | int, FK → `personas.id` | |
| `texto` | text | |
| `created_at` | timestamp | usado como fecha de creación, probablemente `default now()` del lado de Supabase (el INSERT del código no envía esta columna) |

- Sin operaciones de update/delete en el código (ver `docs/BUSINESS_RULES.md` §17) — tabla de solo-inserción desde la app actual.

### `eventos`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `titulo` | text | |
| `fecha` | date | `YYYY-MM-DD` |
| `tipo` | text | `visita` \| `cumple` \| `mant` \| `otro` — candidato a enum |
| `nota` | text, nullable | también usada como "marcador de origen" (`'familia'`, `'empleado'`, `'Mascota'`) para deduplicar altas automáticas de cumpleaños — **uso mixto de un campo de texto libre como si fuera un tipo/origen**, señalarlo para el rediseño (podría convertirse en columna `origen` explícita) |

### `fotos`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `titulo` | text | |
| `tipo` | text | `tarea` \| `recuerdo` |
| `persona_id` | int, FK → `personas.id`, nullable | |
| `src` | text (probablemente `text`/sin límite, no `varchar` corto) | contiene el `data:` URL base64 completo de la imagen — ver riesgo abajo |
| `created_at` | timestamp | igual que novedades, no enviado en el INSERT |

- **Riesgo de integridad/escala**: guardar imágenes como base64 en una columna de texto crece la tabla sin límite y no es el modelo previsto para el futuro (Neon Object Storage vía backend — ver "Object Storage reemplaza Google Drive" más abajo). Al migrar, `src` debería convertirse en una referencia (`bucket` + `objectKey`), no en el contenido de la imagen.

### `pines`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK (inferido, no usado explícitamente por el JS) | |
| `tipo` | text | `admin` \| `persona` |
| `persona_id` | int, FK → `personas.id`, nullable (null para el registro `admin`) | |
| `pin` | text | **texto plano de 4 dígitos, sin hash** — ver `docs/SECURITY.md` |

- Restricción inferida: unicidad por `(tipo, persona_id)`, dado el uso de `resolution=merge-duplicates` al guardar (línea 3722, 3731) — un PIN de admin único y un PIN por persona.

### `gallinero`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `gallinas_activas` | int | |
| `updated_at` | timestamp | enviado explícitamente en el PATCH (línea 2307) |

- ⚠️ **Duda de diseño**: el código asume una única fila "singleton" en esta tabla (usa `gRows[0]`, línea 2360) pero no hay ninguna restricción ni lógica que garantice que exista exactamente una fila, ni que impida crear una segunda. Si la tabla está vacía, `ajustarGallinas()` no persiste el cambio (ver `docs/BUSINESS_RULES.md` §9). Al migrar, considerar modelarlo distinto: por ejemplo, una fila de configuración con `id` fijo, o directamente un campo agregado en una tabla de configuración general.

### `recolecciones`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `fecha` | date | |
| `huevos_buenos` | int | |
| `huevos_rotos` | int | |
| `persona_id` | int, FK → `personas.id`, nullable | |
| `observaciones` | text, nullable | |

### `mascotas`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `nombre` | text | |
| `tipo` | text | referencia por nombre a `tipos_mascota.nombre` — **no hay FK real, es texto libre comparado por igualdad** (mismo patrón de desnormalización que `stock.categoria`) |
| `raza` | text, nullable | |
| `fecha_nac` | date, nullable | |
| `foto` | text, nullable | URL externa (no upload — a diferencia de `fotos`) |
| `activa` | boolean | usado para filtrar la lista, sin función de baja visible en el código auditado (no se encontró un `togMascota` o similar — **posible funcionalidad faltante en la UI**, ⚠️ duda) |

### `registros_clinicos`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `mascota_id` | int, FK → `mascotas.id` | |
| `tipo` | text | `vacuna` \| `peso` \| `desparasitacion` \| `chequeo` \| `evento` |
| `fecha` | date | |
| `descripcion` | text, nullable | |
| `valor` | numeric, nullable | solo poblado cuando `tipo==='peso'` |
| `persona_id` | int, FK → `personas.id`, nullable | quién cargó el registro |

- Riesgo de integridad: `valor` es nullable y solo tiene sentido de negocio para `tipo==='peso'` — sin `CHECK` constraint observable; al migrar, evaluar si conviene separar "registro de peso" del resto o mantener el modelo polimórfico con constraint condicional.

### `tipos_mascota`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `nombre` | text | usado como identificador funcional (comparado por igualdad en `mascotas.tipo`) |

- Sin columna de ícono/emoji en la base — el mapeo emoji↔nombre vive solo en el frontend (`TIPO_ICONS`, `ANIMAL_EMOJIS`).

### `empleados_datos`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `persona_id` | int, FK → `personas.id` | única constraint inferida por `resolution=merge-duplicates` (línea 2952) — un registro por persona |
| `nombre_completo` | text, nullable | |
| `fecha_nac` | date, nullable | |
| `estado_civil` | text, nullable | valores del `<select>`: Soltero/a, Casado/a, Divorciado/a, Viudo/a, Unión de hecho — texto libre en la base, enum solo en la UI |
| `telefono` | text, nullable | |
| `cuil` | text, nullable | sin formato validado en el código |
| `obra_social` | text, nullable | |
| `contacto_emergencia_nombre` | text, nullable | |
| `contacto_emergencia_tel` | text, nullable | |
| `updated_at` | timestamp | enviado explícitamente en cada guardado |

- Dato personal sensible — ver `docs/SECURITY.md`.

### `hijos`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `persona_id` | int, FK → `personas.id` | (el empleado padre/madre) |
| `nombre` | text | |
| `fecha_nac` | date, nullable | |

### `consumos`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `stock_id` | int, FK → `stock.id` | |
| `cantidad` | numeric | siempre positiva; el signo (consumo vs ingreso) se codifica en el texto de `motivo` (prefijo `[Ingreso] `), **no en una columna estructurada** — ver riesgo abajo |
| `persona_id` | int, FK → `personas.id`, nullable | |
| `destino_id` | int, FK → `destinos_consumo.id`, nullable | |
| `motivo` | text, nullable | texto libre, además usado para codificar tipo de movimiento y origen ("Ajuste...", "[Admin] ", "[Ingreso] ") |
| `fecha` | date | |
| `created_at` | timestamp | |

- **Riesgo de integridad/reporting**: no hay columna `tipo_movimiento` (consumo/ingreso/ajuste) — todo vive como prefijos de texto dentro de `motivo`. Cualquier reporte que necesite distinguir ingresos de consumos de forma confiable debe parsear texto libre, lo cual es frágil (si alguien escribe manualmente un motivo que empiece con "[Ingreso]" sin serlo, se contabiliza mal). **Recomendación fuerte para el nuevo modelo**: columna `tipo` (enum: `consumo`, `ingreso`, `ajuste`) explícita.

### `destinos_consumo`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `nombre` | text | |
| `tipo` | text | `vehiculo` \| `sector` |
| `activo` | boolean | baja lógica; también permite borrado físico desde la UI (con confirmación doble) |

### `categorias_stock`

| Columna (comprobada) | Tipo inferido | Notas |
|---|---|---|
| `id` | int, PK | |
| `nombre` | text | |
| `area` | text | `casa` \| `jardin` \| `ambas` |
| `activa` | boolean | |

---

## Relaciones (diagrama textual)

```
personas 1───* tareas
personas 1───* ejecuciones (completado_por)
tareas   1───* ejecuciones
personas 1───* novedades
personas 1───* fotos
personas 1───* recolecciones
personas 1───* registros_clinicos
personas 1───* empleados_datos (1:1 en la práctica)
personas 1───* hijos
personas 1───* consumos
personas 1───* pines (tipo='persona')
stock    1───* consumos
mascotas 1───* registros_clinicos
destinos_consumo 1───* consumos
categorias_stock ···(sin FK real)··· stock.categoria   [texto libre, no garantizado]
tipos_mascota    ···(sin FK real)··· mascotas.tipo      [texto libre, no garantizado]
```

## Riesgos de integridad — resumen

1. `stock.categoria` y `mascotas.tipo` son texto libre sin FK contra sus catálogos (`categorias_stock`, `tipos_mascota`) — desincronización posible si se renombra/borra una categoría o tipo.
2. `ejecuciones.periodo` mezcla fechas y literales en una sola columna de texto.
3. `consumos` no distingue estructuralmente ingreso vs. consumo vs. ajuste — todo vía prefijos de texto en `motivo`.
4. `gallinero` asume fila única sin mecanismo que lo garantice.
5. `pines.pin` en texto plano, sin hash (ver `docs/SECURITY.md`).
6. Sin columna `tareas.activa` pese a que la lógica de desempeño la espera.
7. Ninguna tabla observada tiene soft-delete uniforme: algunas usan `activa`/`activo` (personas, mascotas, destinos, categorías), otras hacen borrado físico directo (tareas, eventos, fotos, registros clínicos, hijos, destinos en su variante "definitiva").

## Modelo definitivo (Etapa 2) — `backend/prisma/schema.prisma`

> Todo lo de esta sección describe el schema **ya escrito** en `backend/prisma/schema.prisma`, validado estáticamente (`prisma validate`, `prisma format`, `prisma generate`) pero **nunca migrado contra ninguna base** (no se ejecutó `prisma migrate`, `prisma db push` ni `prisma db seed`). Las secciones anteriores de este documento (tablas 1-18) siguen vigentes como registro de lo que el **prototipo** hace — esta sección documenta lo que el **nuevo sistema** hace, y en qué difiere.

### Por qué difiere de la propuesta preliminar de la Etapa 0/1

La propuesta preliminar usaba IDs `Int autoincrement()` y nombres 1:1 con las dudas ya identificadas sin resolver. El modelo definitivo:

- Usa **UUID** (`String @id @default(uuid()) @db.Uuid`) en todas las entidades nuevas — decisión confirmada por el usuario en la Etapa 2, no depende de IDs autoincrementales heredados de Supabase.
- Resuelve a favor de **FK real** las dos dudas de desnormalización que la propuesta preliminar dejaba abiertas: `stock.categoria` → `StockItem.categoryId → StockCategory`, y `mascotas.tipo` → `Animal.animalTypeId → AnimalType`.
- Separa `User` (cuenta de acceso) de `Employee` (identidad operativa) y de `EmployeeProfile` (datos personales sensibles) — el prototipo no distinguía estos tres conceptos.
- Reemplaza el campo `periodo` de texto mixto (`ejecuciones`) por `TaskExecution.periodKey`, con la misma estrategia pero documentada explícitamente (ver "Estrategia de recurrencia" más abajo).
- Reemplaza el prefijo de texto en `consumos.motivo` por `StockMovement.type` (enum `StockMovementType`), eliminando la ambigüedad ya señalada como riesgo.
- Agrega `Task.active` (el campo que el prototipo esperaba pero nunca tuvo, causando el bug de Desempeño documentado en `docs/BUSINESS_RULES.md` §6).
- Agrega entidades que no existían en el prototipo pero se pidieron explícitamente: `Session`, `AuditLog`, `FileAsset`, `RecurringBirthday`, `PropertyLocation`.

### Mapeo Postgres

Todos los modelos usan `@@map`/`@map` para nombres de tabla/columna en snake_case (ej. `model Employee` → tabla `employees`, `displayName` → columna `display_name`) — convención Postgres idiomática, independiente de que los nombres del lado de Prisma/TypeScript estén en inglés y PascalCase/camelCase.

### Enums

| Enum | Valores | Reemplaza / origen |
|---|---|---|
| `SystemRole` | `ADMIN`, `EMPLOYEE` | Roles actuales del prototipo |
| `UserStatus` | `PENDING_ACTIVATION`, `ACTIVE`, `SUSPENDED`, `DEACTIVATED` | Nuevo — ciclo de vida de `User` |
| `TaskFrequency` | `DAILY`, `WEEKLY`, `MONTHLY`, `URGENT`, `ONE_TIME` | `tareas.frecuencia` (diaria/semanal/mensual/urgente/unica) |
| `StockArea` | `HOUSE`, `GARDEN`, `BOTH` | `stock.area` / `categorias_stock.area` (casa/jardin/ambas) |
| `StockMovementType` | `OPENING_BALANCE`, `INCOME`, `CONSUMPTION`, `ADJUSTMENT_INCREASE`, `ADJUSTMENT_DECREASE` | Reemplaza los prefijos de texto en `consumos.motivo` |
| `DestinationType` | `VEHICLE`, `SECTOR` | `destinos_consumo.tipo` |
| `EventType` | `VISIT`, `BIRTHDAY`, `MAINTENANCE`, `OTHER` | `eventos.tipo` |
| `MedicalRecordType` | `VACCINE`, `WEIGHT`, `DEWORMING`, `CHECKUP`, `CLINICAL_EVENT` | `registros_clinicos.tipo` |
| `PhotoCategory` | `TASK_EVIDENCE`, `MEMORY` | `fotos.tipo` (tarea/recuerdo) |
| `FileProvider` | `NEON_OBJECT_STORAGE` | Nuevo — único proveedor previsto, no se inventan otros. Reemplaza a `GOOGLE_DRIVE` (revertido antes de conectar Neon — ver "Object Storage reemplaza Google Drive" más abajo) |
| `FileStatus` | `ACTIVE`, `DELETED` | Nuevo — soporta eliminación lógica de archivos |

`AuditLog.action` es deliberadamente **`String`, no enum**: el catálogo de acciones auditables va a crecer con cada módulo futuro (Etapa 5 en adelante), y un enum obligaría a migrar el schema cada vez que se audite una acción nueva. Se documenta acá porque el pedido de la Etapa 2 dejaba esto como "si corresponde".

### Modelos por área

**Identidad y seguridad**: `User`, `Employee`, `EmployeeProfile`, `EmployeeChild`, `Session`, `AuditLog`.
**Tareas**: `Task`, `TaskExecution`.
**Inventario**: `StockCategory`, `StockItem`, `StockMovement`, `ConsumptionDestination`.
**Novedades y eventos**: `NewsReport`, `Event`, `RecurringBirthday`.
**Archivos**: `FileAsset`.
**Gallinero**: `ChickenCoop`, `EggCollection`.
**Mascotas**: `AnimalType`, `Animal`, `AnimalMedicalRecord`.
**Configuración**: `PropertyLocation`.

El detalle campo por campo de cada modelo está comentado directamente en `backend/prisma/schema.prisma` (comentarios `///` sobre cada modelo/campo no trivial) — no se duplica acá para evitar que la documentación y el schema se desincronicen; esta sección resume las decisiones que no son obvias leyendo el schema solo.

### Separación User / Employee

Un `Employee` es la identidad operativa liviana (nombre a mostrar, rol funcional, color de avatar) — existe independientemente de si esa persona tiene o no acceso al sistema. Un `User` es una cuenta de acceso — puede o no estar vinculada a un `Employee` (`User.employeeId` nullable), porque un admin futuro podría no corresponder a ningún empleado doméstico. La unicidad vive en `User.employeeId @unique`: un empleado nunca puede tener más de una cuenta. Los datos personales sensibles (fecha de nacimiento, CUIL, obra social, contacto de emergencia) viven en `EmployeeProfile`, separados del registro básico — ver `docs/SECURITY.md` §6 sobre por qué esto importa.

### Usuarios pendientes de activación

Los 4 `User` que sembraría el seed nacen con `status: PENDING_ACTIVATION` y `passwordHash: null`. Ningún flujo de autenticación existe todavía (Etapa 3) — este estado es exclusivamente un lugar reservado.

Semántica confirmada de cada campo, explícita para que la Etapa 3 no tenga ambigüedad:

- **`passwordHash`** puede almacenar **únicamente un hash criptográfico** (ej. bcrypt/argon2), **nunca la credencial en texto plano**. El nombre se mantiene tal cual (no se renombra): es consistente con la estrategia futura y ya deja claro, por sí mismo, que ahí no va texto plano.
- Es nullable **solo** para representar el estado `PENDING_ACTIVATION` — un usuario sin contraseña todavía definida. La invariante "no puede quedar `ACTIVE` con `passwordHash` nulo" **sí es expresable como `CHECK` de Postgres de una sola tabla** (`CHECK (status != 'ACTIVE' OR password_hash IS NOT NULL)`) — ver la matriz de invariantes más abajo; se aplicará en la futura migración, no en este schema todavía.
- La aplicación (Etapa 3) usará una credencial inicial configurada mediante un proceso de activación — nunca un valor generado o inventado en el seed.
- `Session` (ver más arriba) es **persistencia de sesión segura** tras una autenticación real — su existencia en el modelo **no** implica ni habilita ningún tipo de omisión de autenticación; sin lógica de emisión/validación implementada todavía.

### Historial de asignación de tareas — asignado vs. completador

**Corrección de esta revisión.** `TaskExecution` distingue dos conceptos que antes se confundían en un solo campo:

- **`assignedEmployeeId`** (`String`, obligatorio) — snapshot de `Task.employeeId` copiado en el momento de **crear** la ejecución. Responde "¿a quién estaba asignada la tarea en este período?" y **nunca se recalcula**: si más adelante un admin reasigna la tarea a otro empleado, las ejecuciones ya existentes conservan su `assignedEmployeeId` original.
- **`completedByEmployeeId`** (`String?`, nullable) — quién efectivamente completó la tarea (puede ser el asignado u otro, ver docs/BUSINESS_RULES.md §4). Sigue siendo nullable: no tiene valor hasta que la tarea se completa.

Sin este snapshot, una consulta que solo mirara `Task.employeeId` reinterpretaría mal el historial después de cada reasignación (mostraría "Ruth" como responsable de ejecuciones que en realidad ocurrieron cuando la tarea era de Coke). El servicio futuro (Etapa 5) debe copiar `Task.employeeId` a `assignedEmployeeId` exactamente una vez, al crear la fila — nunca actualizarlo después. El seed de esta etapa no crea ninguna `TaskExecution` (sin evidencia real de ejecuciones en el prototipo).

### Estrategia de recurrencia de tareas

`TaskExecution.periodKey` (String) representa el período al que corresponde una ejecución:

- `DAILY` → fecha del día, `'YYYY-MM-DD'`.
- `WEEKLY` → fecha del lunes de esa semana, `'YYYY-MM-DD'`.
- `MONTHLY` → primer día del mes, `'YYYY-MM-01'`.
- `URGENT` / `ONE_TIME` → el string fijo `'URGENT'` / `'ONE_TIME'` (no recurren; solo puede existir una ejecución en toda la vida de la tarea).

`@@unique([taskId, periodKey])` impide duplicar una ejecución del mismo período, y para urgente/única impide más de una ejecución en total (porque `periodKey` es constante).

### Estrategia de inventario (transaccional)

1. Se crea el movimiento (`StockMovement`, con `type` explícito).
2. Se valida la operación (cantidad positiva, ítem existente — a nivel de aplicación en la etapa de servicios).
3. Se actualiza `StockItem.currentQuantity` (saldo desnormalizado, mantenido a propósito para no tener que sumar todo el historial en cada lectura).
4. Ambas escrituras (movimiento + saldo) se confirman juntas o ninguna — en el seed, esto ya está implementado con `stockItem.create({ data: { ..., movements: { create: {...} } } })` (escritura anidada de Prisma, atómica); en los servicios de la Etapa 5, el mismo principio se implementa con `prisma.$transaction(...)`.

Los 14 `StockItem` del seed cargan su cantidad inicial como un `StockMovement` de tipo `OPENING_BALANCE` — nunca como un valor "de la nada" en el propio `StockItem` — así el historial de movimientos siempre explica de dónde sale el saldo actual, incluido el saldo con el que arrancó el sistema.

**Idempotencia del movimiento de apertura (corrección de esta revisión).** `StockMovement.reference` (`String?`, `@unique`) es una clave natural que el seed setea únicamente en los movimientos `OPENING_BALANCE` (`"<área>::<nombre>::OPENING_BALANCE"`, derivada de la clave natural del propio `StockItem`). Postgres permite múltiples `NULL` en una columna `@unique` (no se consideran iguales entre sí), así que el resto de los movimientos —que no necesitan esta protección— dejan `reference` en `null` sin conflicto, mientras que nunca puede existir más de un `OPENING_BALANCE` para el mismo producto: lo garantiza una restricción real de base, no solo el texto de `reason` (que es descriptivo y frágil como única protección).

### Decisión de polimorfismo — `FileAsset`

Se pidió explícitamente evaluar una relación polimórfica genérica (`attachableType`/`attachableId`) contra FKs explícitas para vincular archivos con otras entidades. Se documenta acá la comparación (repetida como comentario en el schema, junto al modelo):

- **Rechazada — polimorfismo genérico**: sin FK real, Postgres/Prisma no pueden validar que `attachableId` exista en la tabla indicada por `attachableType`; un `ON DELETE CASCADE` real es imposible de expresar; Prisma Client no puede tipar la relación de forma segura.
- **Elegida — FKs nullable explícitas** (`taskId`, `animalId`, más `employeeId`/`taggedEmployeeId`): mantiene integridad referencial real. Desventaja aceptada: cada tipo de entidad nuevo al que algún día haga falta adjuntar un archivo requiere agregar una columna nullable nueva. Se acepta porque un archivo se adjunta a lo sumo a una entidad a la vez.

**Auditoría de `newsReportId` (corrección de esta revisión).** La primera versión de esta etapa agregó `FileAsset.newsReportId` por anticipación (lo pedía el modelo mínimo original). Al auditar el HTML: `fotos` (id, titulo, tipo, persona_id, src, created_at) **no tiene ningún campo que vincule una foto a una novedad**, y la pantalla de Novedades nunca muestra ni permite adjuntar fotos — cero evidencia funcional. Se **eliminó** `newsReportId`/`newsReport` del modelo y de `NewsReport`. `taskId`/`animalId` se conservan: tienen respaldo real (`fotos.tipo='tarea'` como categoría ya existente en el prototipo, y el pedido explícito de esta corrección de soportar "fotografía de animal").

Capacidades confirmadas de `FileAsset` contra el HTML: fotografía general o recuerdo (`category: MEMORY`, sin `taskId`/`animalId`) ✅ · evidencia de tarea (`category: TASK_EVIDENCE`, `taskId` opcional) ✅ · fotografía de animal (`animalId` opcional) ✅ · persona etiquetada (`taggedEmployeeId`) ✅ · usuario/empleado que subió (`uploadedByEmployeeId`) ✅ · eliminación lógica (`status`, `deletedAt`) ✅ · proveedor Neon Object Storage identificado por `bucket` + `objectKey` (no por `provider` + `externalId` como en el diseño anterior con Google Drive) ✅ · metadatos (`originalFilename`, `mimeType`, `sizeBytes`, `checksum`, `etag` opcional) ✅.

### Object Storage reemplaza Google Drive (revisión previa a conectar Neon)

**Decisión definitiva**: Neon Object Storage privado (interfaz compatible con S3) reemplaza a Google Drive como almacenamiento de fotografías y archivos. El proyecto de Neon aloja Postgres y Object Storage en el mismo lugar, con ramas `demo` (desarrollo) y `production`, cada una con su propio bucket privado `la-canada-uploads` y credenciales propias — ver `docs/ARCHITECTURE.md`, sección 9, para el detalle completo de buckets, ambientes, estrategia de object keys y los flujos de escritura/lectura futuros.

Cambios concretos en `FileAsset` respecto al diseño anterior (Google Drive):

- **Identificación técnica**: `externalId` (ID de archivo de Drive) se **reemplaza** por `bucket` + `objectKey`. La restricción única compuesta pasa de `@@unique([provider, externalId])` a **`@@unique([bucket, objectKey])`** — impide registrar dos veces el mismo objeto dentro del mismo bucket.
- **Campo nuevo `etag`** (`String?`): ETag devuelto por el proveedor S3-compatible al confirmar la subida — nullable porque no está disponible mientras el archivo sigue `PENDING_UPLOAD`.
- **`FileProvider` pasa de `GOOGLE_DRIVE` a `NEON_OBJECT_STORAGE`** (único valor, sin proveedores adicionales no solicitados). Se prefiere este nombre explícito a uno genérico `S3` porque el proyecto usa exactamente un proveedor S3-compatible concreto — un valor genérico sugeriría soporte multi-proveedor que no existe.
- **`FileStatus` se amplía de 2 a 5 valores** (`ACTIVE`/`DELETED` → `PENDING_UPLOAD`, `AVAILABLE`, `UPLOAD_FAILED`, `PENDING_DELETION`, `DELETED`) para poder representar el ciclo de vida completo de una subida futura (carga pendiente, disponible, fallo, eliminación pendiente, eliminado) — el enum anterior solo cubría 2 de esos 5 estados. El default pasa de `ACTIVE` a `PENDING_UPLOAD`, consistente con el flujo futuro (el backend crea la fila con `bucket`/`objectKey` ya generados antes de confirmar la subida). Ningún workflow que use estos estados está implementado todavía — el enum solo declara los estados posibles, igual que el resto del modelo en esta etapa.
- Lo que **nunca** se persiste (sin cambios respecto al diseño anterior, reafirmado explícitamente): URL pública, URL temporal firmada, credenciales del proveedor, contenido base64, binarios, rutas locales. Las URLs de acceso se generan en el backend bajo demanda, recién en la etapa del módulo de fotografías.

No se ejecutó ninguna migración por este cambio (sigue sin haber conexión a Neon) — es un ajuste al schema en la misma etapa de diseño, antes de la primera migración real.

Un archivo puede no vincularse a ninguna entidad (`taskId` y `animalId` ambos `null` — foto general) y de todas formas conservar `category` y `taggedEmployeeId`. Invariante para el servicio futuro: un `FileAsset` no debe tener `taskId` y `animalId` simultáneamente no nulos — ver matriz de invariantes.

### Singletons reforzados — `ChickenCoop` y `PropertyLocation`

**Corrección de esta revisión.** La primera versión dejaba estas dos tablas como singleton "por convención operativa" únicamente — fue señalado como frágil (exactamente el patrón que causó el bug de fila-inexistente del prototipo, ver sección de riesgos de este documento). Ahora ambos modelos tienen `code String @unique`, obligatorio:

- `PropertyLocation.code = "main"` — sembrado por el seed de esta etapa.
- `ChickenCoop.code = "main"` — **no sembrado** (sin cantidad de gallinas comprobada), pero el servicio futuro debe crear/buscar la fila siempre con `findUnique({ where: { code: "main" } })`, nunca `findFirst()`.

Ambos modelos admitirían técnicamente varios establecimientos en el futuro (otro `code` = otra fila) — la restricción de "uno solo" es una decisión de negocio de hoy, no una limitación del schema.

## Matriz de invariantes y nivel de enforcement

Invariantes de negocio que Prisma **no** puede expresar de forma completamente declarativa en `schema.prisma`, clasificadas por dónde se aplican (una misma fila puede necesitar más de un nivel — defensa en profundidad):

| # | Invariante | 1. Expresable en Prisma | 2. Constraint SQL (futura migración) | 3. Transacción/validación de servicio | 4. Configuración operativa | Nota |
|---|---|:-:|:-:|:-:|:-:|---|
| 1 | `StockItem.area` nunca `BOTH` | — | ✅ `CHECK (area != 'BOTH')` | ✅ (mensaje de error amigable antes de tocar la base) | — | Columna única, `CHECK` de una sola tabla — directo |
| 2 | Área de `StockItem` consistente con la de su `StockCategory` (igual o categoría `BOTH`) | — | — | ✅ | — | Cruza dos tablas — un `CHECK` estático no puede verlo; requeriría un trigger (no recomendado); validación de servicio es la vía razonable |
| 3 | `User.status = ACTIVE` ⇒ `passwordHash` no nulo | — | ✅ `CHECK (status != 'ACTIVE' OR password_hash IS NOT NULL)` | ✅ (Etapa 3, al activar) | — | Columnas de la misma fila — `CHECK` de una sola tabla |
| 4 | `FileAsset` no vinculado simultáneamente a `taskId` y `animalId` | — | ✅ `CHECK (NOT (task_id IS NOT NULL AND animal_id IS NOT NULL))` | ✅ | — | Columnas de la misma fila — `CHECK` de una sola tabla |
| 5 | `StockMovement.quantity` siempre positiva | — | ✅ `CHECK (quantity > 0)` | ✅ | — | Ya casi garantizado por `@db.Decimal` + validación de formulario, pero conviene el `CHECK` como defensa final |
| 6 | El saldo (`StockItem.currentQuantity`) nunca queda negativo tras `CONSUMPTION`/`ADJUSTMENT_DECREASE` | — | — | ✅ | — | Depende del estado de **otra fila** en el momento de escribir — no expresable como `CHECK` estático; exige leer el saldo actual dentro de la misma transacción antes de escribir |
| 7 | Un `StockMovement` `OPENING_BALANCE` como máximo por `StockItem` | ✅ `StockMovement.reference @unique` | (ya cubierto por 1) | — | — | Resuelto en este schema — ver "Idempotencia del movimiento de apertura" arriba |
| 8 | Singleton de `ChickenCoop`/`PropertyLocation` identificado por clave única | ✅ `code @unique` | — | — | — | Resuelto en este schema — ver "Singletons reforzados" arriba |
| 9 | `TaskExecution.assignedEmployeeId` = snapshot inmutable, nunca se reescribe tras reasignar `Task.employeeId` | — | — | ✅ | — | Prisma no puede "congelar" un valor tras la creación; el servicio simplemente nunca debe incluir ese campo en un `update()` |
| 10 | `TaskExecution` única por `(taskId, periodKey)` | ✅ `@@unique([taskId, periodKey])` | (ya cubierto) | — | — | Resuelto en este schema |
| 11 | `AuditLog`/`Session` — nunca editados, solo creados (inmutabilidad) | — | — | ✅ | — | Prisma permite `.update()` técnicamente; la disciplina de no llamarlo es de servicio, reforzada por no tener `updatedAt` (ver `docs/DATABASE.md`, "Timestamps") |
| 12 | `FileAsset` único por `(bucket, objectKey)` — no se registra dos veces el mismo objeto dentro del mismo bucket | ✅ `@@unique([bucket, objectKey])` | (ya cubierto) | — | — | Resuelto en este schema — ver "Object Storage reemplaza Google Drive" arriba |
| 13 | `FileAsset.sizeBytes` nunca negativo | — | ✅ `CHECK (size_bytes >= 0)` | ✅ (validación de formulario/backend antes de escribir) | — | Columna única, `CHECK` de una sola tabla — directo |
| 14 | Un `FileAsset` con `status = AVAILABLE` requiere `objectKey` válida (no vacía, con formato esperado) | — | — | ✅ | — | `objectKey` es `String` no nulo a nivel de tipo, pero "válida" (formato, no vacía) es una regla de negocio que Prisma no puede expresar — se valida al confirmar la subida |
| 15 | Un `FileAsset` con `status = DELETED` (o `PENDING_DELETION`) no debe recibir nuevas URLs firmadas | — | — | ✅ | — | El servicio que genere URLs firmadas debe rechazar explícitamente cualquier `FileAsset` que no esté `AVAILABLE` — no es una restricción que la base de datos pueda aplicar por sí sola |
| 16 | Solo el backend tiene credenciales de Object Storage | — | — | — | ✅ | El frontend (Netlify) nunca recibe `OBJECT_STORAGE_*`; verificado por convención de `.env`/despliegue, no por el schema — ver `docs/ARCHITECTURE.md`, sección 9.3 |
| 17 | El bucket de `production` y el de `demo` nunca se mezclan (aunque compartan nombre) | — | — | — | ✅ | Cada rama de Neon usa credenciales propias configuradas por entorno (Render vs. backend local) — decisión operativa, no expresable en el schema ni en una migración |

Ninguna de estas se implementa todavía (no hay migración ni servicios en esta etapa) — la tabla es la referencia para cuando corresponda.

## Revisión estática final del modelo (esta revisión correctiva)

Chequeo explícito de los puntos pedidos, con resultado:

- **Relaciones sin lado inverso**: ninguna — `prisma validate` falla si falta un lado inverso, y el schema actual valida limpio.
- **`onDelete` peligrosos / cascadas que borren historial**: ninguna relación declara `onDelete` explícito. El comportamiento por defecto de Prisma con `relationMode="foreignKeys"` (el default para `postgresql`) es la acción por defecto de Postgres — sin una cláusula `ON DELETE` explícita, Postgres rechaza (`NO ACTION`) el borrado de una fila referenciada mientras existan dependientes. Efecto práctico: **no puede borrarse físicamente por accidente** un `Employee`/`Task`/`StockItem`/etc. que tenga historial dependiente — consistente con la decisión de "no debe utilizarse borrado físico" para esas entidades. No se agregó ningún `Cascade`.
- **Campos nullable sin justificación**: todos los `String?`/`DateTime?`/relaciones opcionales tienen un comentario `///` explicando por qué (dato no siempre presente, relación 0-o-1, etc.) — revisados uno por uno al escribir cada modelo.
- **Índices faltantes**: se agregó `@@index([assignedEmployeeId])` en `TaskExecution` en esta revisión (faltaba desde que se agregó el campo). El resto de las FKs consultables ya tenían índice.
- **Restricciones únicas demasiado agresivas / claves naturales que impedirían casos legítimos**: revisadas — `@@unique([employeeId, description])` en `Task`, `@@unique([title, date, type])` en `Event`, etc., se consideran razonables para el volumen y la naturaleza de estos datos; sin cambios.
- **Datos personales en modelos incorrectos**: no — siguen separados en `EmployeeProfile`/`EmployeeChild`, nunca en `Employee`.
- **Enums insuficientes o excesivamente rígidos**: sin cambios — `AuditLog.action` sigue siendo `String` a propósito (ver arriba).
- **Uso accidental de `Float` para cantidades**: **cero** — verificado explícitamente, el schema no declara ningún campo `Float` (test dedicado en `backend/src/test/schema-static.test.ts`).
- **Timestamps faltantes**: `AuditLog` y `Session` tienen solo `createdAt` — **decisión deliberada, no un olvido**: ambos representan un hecho puntual e inmutable (un log no se edita; una sesión se revoca seteando `revokedAt`, no se "actualiza"). El resto de los modelos de negocio mutables tiene `createdAt` + `updatedAt`.
- **Soft delete inconsistente**: la mayoría usa `active: Boolean`; `FileAsset` usa `status: FileStatus` + `deletedAt` en su lugar — deliberado, no inconsistente: un archivo tiene un ciclo de vida de eliminación real (con fecha), distinto de "activo/inactivo" en el sentido de las demás entidades.

### Qué queda pendiente para la Etapa 3 en adelante

- Migración real contra Neon (`prisma migrate dev`) — no ejecutada.
- Los `CHECK` constraints de la matriz de invariantes (filas 1, 3, 4, 5, 13) — se agregan a mano en la migración SQL generada, Prisma no los declara en `schema.prisma`.
- Enforcement a nivel de servicio de las filas 2, 6, 9, 11, 14, 15 de la matriz.
- Configuración operativa de las filas 16, 17 (credenciales de Object Storage exclusivas del backend, sin mezclar `demo`/`production`) — se confirma al configurar cada entorno, no en el schema.
- Diseño de índices adicionales según patrones de consulta reales (los `@@index` actuales cubren las FKs más obvias, no un análisis de performance con datos reales).
- Política de retención/expiración de `Session` y `AuditLog`.
