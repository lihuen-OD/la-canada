# SEED_MANIFEST.md — Manifiesto exacto del seed (Etapa 2)

> Este documento lista, entidad por entidad, exactamente qué carga `backend/prisma/seed.ts` (vía los módulos de `backend/prisma/seed-data/`) y qué **no** carga. El seed **no se ejecutó** en esta etapa — este manifiesto describe lo que el código haría si se corriera, verificado por lectura del código y por los tests de `backend/src/test/seed-data.test.ts` / `seed-source-guards.test.ts` (que sí corren, sin base de datos).

## Resumen

| Entidad | Filas sembradas | Fuente |
|---|---|---|
| `Employee` | 4 | index.html líneas 928-933 |
| `User` | 4 (PENDING_ACTIVATION) | Derivado 1:1 de `Employee` |
| `EmployeeProfile` | 0 | Sin datos reales declarados (`empleadosDatos = []`) |
| `EmployeeChild` | 0 | Sin datos reales declarados |
| `Task` | 10 | index.html líneas 934-945 |
| `TaskExecution` | 0 | Sin ejecuciones reales declaradas (`ejecuciones = []`) |
| `StockCategory` | 13 | index.html línea 913-914 (`CATS_CASA` + `CATS_JARDIN`) |
| `StockItem` | 14 | index.html líneas 949-966 |
| `StockMovement` | 14 (una por `StockItem`, tipo `OPENING_BALANCE`) | Derivado de la cantidad inicial de cada producto |
| `ConsumptionDestination` | 0 | Sin destinos reales declarados |
| `NewsReport` | 2 | index.html líneas 967-970 |
| `Event` | 2 | index.html líneas 995-999 (de 3 originales — ver omisiones) |
| `RecurringBirthday` | 2 | `addFamilyBirthdays()`, index.html línea 1760-1764 (de 3 originales — ver omisiones) |
| `AnimalType` | 9 | index.html línea 986 + íconos de línea 2371-2377 |
| `Animal` | 0 | Sin animales reales declarados (`mascotas = []`) |
| `AnimalMedicalRecord` | 0 | Sin registros reales declarados |
| `ChickenCoop` | 0 | Sin cantidad de gallinas comprobada — omitido a propósito |
| `EggCollection` | 0 | Sin recolecciones reales declaradas |
| `FileAsset` | 0 | Sin fotos reales declaradas (`fotos = []`) |
| `Session` | 0 | No corresponde sembrar sesiones |
| `AuditLog` | 0 | No corresponde sembrar auditoría |
| `PropertyLocation` | 1 | Coordenadas de Villa Elisa, `fetchClima()` línea 1647 |

**Conteo exacto — corregido en la revisión correctiva de la Etapa 2** (la primera versión de este documento sumaba mal y decía "61" incluyendo, sin decirlo, los movimientos de apertura en esa misma cifra):

| Concepto | Cantidad | Cálculo |
|---|---|---|
| **Entidades maestras/principales** | **61** | 4 `Employee` + 4 `User` + 10 `Task` + 13 `StockCategory` + 14 `StockItem` + 2 `NewsReport` + 2 `Event` + 2 `RecurringBirthday` + 9 `AnimalType` + 1 `PropertyLocation` |
| **Movimientos de apertura** (`StockMovement`, tipo `OPENING_BALANCE`) | **14** | Uno por cada `StockItem` — no es una "entidad maestra" nueva, es una fila hija generada junto con cada producto |
| **Total potencial de filas persistidas en una base vacía** | **75** | 61 + 14 |

Todas las demás entidades del modelo (`EmployeeProfile`, `EmployeeChild`, `TaskExecution`, `ConsumptionDestination`, `Animal`, `AnimalMedicalRecord`, `ChickenCoop`, `EggCollection`, `FileAsset`, `Session`, `AuditLog`) quedan en **0** filas — ver la tabla de arriba y "Datos deliberadamente omitidos" más abajo. Verificado con tests dedicados (`backend/src/test/seed-data.test.ts`, sección "Conteo total del seed").

## Detalle por entidad

### Employee (4)

| code | displayName | role | colorHex |
|---|---|---|---|
| coke | Coke | Doméstica | #4a7c59 |
| cami | Cami | Doméstica | #8b5e3c |
| ruth | Ruth | Doméstica | #6b7c8b |
| pablo | Pablo | Parque | #2c5364 |

`code` es una clave natural nueva (no existía en el prototipo) para poder sembrar de forma idempotente. `active` queda en `true` (default del schema).

### User (4)

| username | employeeCode | role | status | passwordHash |
|---|---|---|---|---|
| coke | coke | EMPLOYEE | PENDING_ACTIVATION | `null` |
| cami | cami | EMPLOYEE | PENDING_ACTIVATION | `null` |
| ruth | ruth | EMPLOYEE | PENDING_ACTIVATION | `null` |
| pablo | pablo | EMPLOYEE | PENDING_ACTIVATION | `null` |

Ningún usuario puede autenticarse hasta que un proceso de activación futuro (Etapa 3) les asigne una credencial real. **Cero administradores sembrados.**

### Task (10)

| employeeCode | description | frequency |
|---|---|---|
| coke | Limpiar baños | DAILY |
| coke | Aspirar planta baja | DAILY |
| cami | Cambiar ropa de cama | WEEKLY |
| cami | Limpiar cocina a fondo | WEEKLY |
| ruth | Planchar ropa | DAILY |
| ruth | Limpiar ventanas exteriores | MONTHLY |
| pablo | Cortar el pasto — zona principal | WEEKLY |
| pablo | Regar jardines | DAILY |
| pablo | Revisar sistema de riego | MONTHLY |
| pablo | Fumigar perímetro | URGENT |

### StockCategory (13)

Casa (HOUSE, 6): Limpieza, Alimentos, Baño, Ropa/Textil, Medicamentos, Varios.
Jardín (GARDEN, 7): Fertilizantes, Combustibles, Herramientas, Fitosanitarios, Alimentos, Pileta, Varios.

("Alimentos" y "Varios" aparecen una vez por área — así los declara el prototipo, sin deduplicar entre áreas.)

### StockItem (14) + StockMovement de apertura (14)

| area | name | category | unit | minimumQuantity | openingQuantity |
|---|---|---|---|---|---|
| HOUSE | Detergente | Limpieza | litros | 3 | 2 |
| HOUSE | Lavandina | Limpieza | litros | 3 | 5 |
| HOUSE | Desinfectante pisos | Limpieza | litros | 2 | 1 |
| HOUSE | Papel higiénico | Baño | rollos | 12 | 24 |
| HOUSE | Bolsas de basura | Limpieza | unidades | 20 | 30 |
| HOUSE | Trapos de piso | Limpieza | unidades | 4 | 3 |
| HOUSE | Esponjas | Limpieza | unidades | 5 | 6 |
| GARDEN | Fertilizante NPK | Fertilizantes | kg | 10 | 5 |
| GARDEN | Herbicida glifosato | Fitosanitarios | litros | 2 | 3 |
| GARDEN | Insecticida | Fitosanitarios | litros | 2 | 1 |
| GARDEN | Combustible motosierra | Combustibles | litros | 5 | 8 |
| GARDEN | Combustible cortadora | Combustibles | litros | 5 | 4 |
| GARDEN | Mangueras de repuesto | Herramientas | metros | 1 | 2 |
| GARDEN | Guantes de trabajo | Herramientas | pares | 2 | 1 |

Cada fila genera además exactamente un `StockMovement` con `type: OPENING_BALANCE`, `quantity` = `openingQuantity`, `employeeId: null`, `destinationId: null` (sin evidencia de quién cargó el saldo original), `reason: "Saldo inicial migrado desde el inventario auditado de index.html (Etapa 2)."`, `effectiveDate` = fecha de ejecución del seed (no hay fecha histórica real que preservar), y **`reference: "<area>::<name>::OPENING_BALANCE"`** — clave natural única (`StockMovement.reference @unique`) que garantiza con una restricción real de base, no solo con texto descriptivo, que nunca pueda existir más de un movimiento de apertura para el mismo producto (ver "Idempotencia" más abajo).

### NewsReport (2)

| employeeCode | text |
|---|---|
| pablo | La bomba de riego hace un ruido raro al arrancar. |
| coke | Falta jabón líquido en el baño de la planta baja. |

`createdAt` queda en la fecha de ejecución del seed (`now()` — ver "Datos deliberadamente omitidos").

### Event (2 de 3 originales)

| title | date | type | note |
|---|---|---|---|
| Revisión bomba de agua | 2026-05-20 | MAINTENANCE | Llamar al técnico antes |
| Visita familia O'Dwyer | 2026-06-15 | VISIT | Preparar asado |

El tercer evento original ("Cumpleaños de Benjamín", 2026-02-19) **no se siembra** — ver "Datos deliberadamente omitidos".

### RecurringBirthday (2 de 3 originales)

| slug | personLabel | month | day | relationship |
|---|---|---|---|---|
| vicky | Vicky | 3 | 10 | familia |
| felicitas | Felicitas | 6 | 1 | familia |

Benjamín **no se siembra** — ver "Datos deliberadamente omitidos".

### AnimalType (9)

Perro 🐕, Gato 🐈, Caballo 🐴, Burro 🫏, Guinea 🐖, Pato 🦆, Pavo real 🦚, Gallina 🐔, Faisán 🦃.

### PropertyLocation (1)

| code | label | latitude | longitude |
|---|---|---|---|
| main | Villa Elisa, Entre Ríos | -32.15 | -58.40 |

`code: "main"` es la clave natural del singleton (ver "Singletons reforzados" más abajo) — el seed busca/crea por `code`, no por `label`.

## Singletons reforzados (revisión correctiva)

`PropertyLocation` y `ChickenCoop` ya no dependen de la convención "una sola fila, tomar la primera" (frágil, y la causa exacta del bug de `gallinero` en el prototipo). Ambos modelos tienen ahora un campo `code String @unique`, obligatorio:

- `PropertyLocation.code = "main"` — sembrado por esta etapa (ver arriba).
- `ChickenCoop.code = "main"` — **no sembrado** (sigue sin cantidad de gallinas comprobada), pero cuando el servicio futuro cree la primera fila real, debe usar `code: "main"`, y buscarla siempre con `findUnique({ where: { code: "main" } })` — nunca `findFirst()`.

El modelo admite técnicamente varios establecimientos en el futuro (otro `code` = otra fila) — la restricción de "uno solo" es una decisión de negocio de hoy, no una limitación del schema.

## Historial de asignación de tareas (revisión correctiva)

`TaskExecution` ahora separa explícitamente dos conceptos que antes se confundían:

- `assignedEmployeeId` (**obligatorio**) — snapshot de `Task.employeeId` en el momento de crear la ejecución. Si la tarea se reasigna después, las ejecuciones ya creadas **no cambian**: siguen mostrando quién tenía la tarea asignada en ese momento.
- `completedByEmployeeId` (**nullable**) — quién la completó realmente, que puede coincidir o no con el asignado.

El seed de esta etapa **no crea ninguna `TaskExecution`** (sin evidencia real de ejecuciones en el prototipo — `ejecuciones = []`), así que este campo nuevo no afecta el conteo de filas sembradas; es un cambio de modelo, verificado con un test estático sobre el propio schema (`backend/src/test/schema-static.test.ts`), no con datos.

## Idempotencia — cómo se garantiza que una segunda corrida no duplique ni pise nada

| Entidad | Clave natural usada para "crear si no existe" | Nunca actualiza si ya existe |
|---|---|---|
| `Employee` | `code` | ✅ (`createIfMissing`, sin `.update()`) |
| `User` | `username` | ✅ |
| `Task` | `[employeeId, description]` | ✅ |
| `StockCategory` | `[name, area]` | ✅ |
| `StockItem` | `[area, name]` | ✅ — y si ya existe, **tampoco vuelve a crear su movimiento de apertura** (el `continue` en `seedStockItems` salta el bloque entero) |
| `StockMovement` (apertura) | `reference` (`@unique`, ver arriba) — protección de base real, no solo el `continue` a nivel de ítem | ✅ |
| `NewsReport` | `[employeeId, text]` | ✅ |
| `Event` | `[title, date, type]` | ✅ |
| `RecurringBirthday` | `slug` | ✅ |
| `AnimalType` | `name` | ✅ |
| `PropertyLocation` | `code` | ✅ |

Ninguna clave depende de un UUID adivinado ni hardcodeado — todas son datos ya conocidos por el propio seed antes de escribir. `createIfMissing` (ver `backend/prisma/seed-lib/createIfMissing.ts`) nunca llama a `.update()`: si el registro ya existe, se devuelve tal cual está, sin tocarlo — por lo que una segunda corrida tampoco puede reactivar un registro que un administrador haya desactivado (`active: false`) después de la carga inicial, ni pisar un nombre/cantidad/asignación que se haya modificado.

## Datos deliberadamente omitidos

| Dato | Por qué se omite |
|---|---|
| Cumpleaños de Benjamín (cualquier fecha) | El prototipo declara dos fechas contradictorias (19/02 en `eventos`, 16/09 en `addFamilyBirthdays`). Ninguna de las dos se elige — se documenta la contradicción (`OMITTED_BENJAMIN_BIRTHDAY` en `seed-data/recurringBirthdays.ts`) y se espera confirmación humana. |
| Cantidad inicial de gallinas (`ChickenCoop`) | No hay un valor comprobado en el HTML (`gallinasActivas = 0` es solo el estado inicial en memoria del cliente antes de cargar de Supabase, no un dato de negocio real — ver docs/DATA_INVENTORY.md §11). No se siembra `0` ni ningún otro valor; la tabla queda vacía hasta una configuración real. |
| `TaskExecution`, `StockMovement` (no-apertura), `EggCollection`, `Animal`, `AnimalMedicalRecord`, `FileAsset`, `Session`, `AuditLog` | El prototipo no declara ninguna fila real para estas entidades (arrays vacíos: `ejecuciones=[]`, `consumos=[]`, `recolecciones=[]`, `mascotas=[]`, `registrosClinicos=[]`, `fotos=[]`); no existe "Supabase actual" al que consultar en esta auditoría. Sembrar cualquier valor acá sería inventar historial operativo falso. |
| Administrador inicial | Se crea en una etapa futura mediante un proceso seguro (variable de entorno o comando administrativo), nunca con datos inventados en el seed. |
| `ConsumptionDestination` reales (vehículos/sectores) | El prototipo no declara ninguno; el único "destino" que generaba (el pseudo-destino técnico "Ajuste de inventario") ya no es necesario porque `StockMovementType` lo reemplaza estructuralmente — ver docs/DATABASE.md. |
| Fecha real de las 2 `NewsReport` | El prototipo las calculaba con `Date.now() - N` (relativo al momento de abrir la app, no una fecha capturada) — no hay una fecha histórica real que reconstruir. `createdAt` queda en la fecha de ejecución del seed. |

## Inconsistencias encontradas entre los arrays estáticos y `seedData()`

Comparación explícita (index.html líneas 928-1002 contra líneas 1828-1874):

- **Personas, tareas y stock**: contenido **idéntico** entre el array literal (`personas`, `tareas`, `sCasa`+`sJardin`) y lo que `seedData()` inserta (`seedPersonas`, `seedTareas`, `seedStock`). Solo cambian los nombres de campo (`n`→`nombre`, `d`→`descripcion`, etc.), no los valores.
- **Novedades, eventos, tipos de mascota, categorías de stock**: el prototipo los declara como arrays/catálogos reales, pero **`seedData()` nunca los inserta** — solo corre para personas/tareas/stock. Esta etapa (2) sí los siembra explícitamente, corrigiendo esa omisión del prototipo original (ver docs/DATA_INVENTORY.md §15, tabla ya existente desde la Etapa 0).

## Validación sin PostgreSQL

Todo lo listado en este manifiesto está cubierto por tests que corren sin base de datos:
`backend/src/test/seed-data.test.ts` (conteos, relaciones, valores exactos) y `backend/src/test/seed-source-guards.test.ts` (ausencia de `deleteMany`, secretos, admin inventado, gallinero inventado, historial falso).
