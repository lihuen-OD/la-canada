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

- **Riesgo de integridad/escala**: guardar imágenes como base64 en una columna de texto crece la tabla sin límite y no es el modelo previsto para el futuro (Google Drive vía backend). Al migrar, `src` debería convertirse en una referencia (ID/URL de Drive), no en el contenido de la imagen.

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

## Propuesta preliminar de modelo Prisma (borrador — NO ejecutar, solo referencia para la etapa de diseño de Prisma)

```prisma
// PRELIMINAR — a validar y ajustar en la etapa "Diseñar Prisma" de docs/MIGRATION_PLAN.md
// No representa un schema final ni debe aplicarse todavía.

enum Role {
  ADMIN
  EMPLOYEE
}

enum TaskFrequency {
  DIARIA
  SEMANAL
  MENSUAL
  URGENTE
  UNICA
}

enum StockArea {
  CASA
  JARDIN
}

enum EventType {
  VISITA
  CUMPLE
  MANT
  OTRO
}

enum MovementType {
  CONSUMO
  INGRESO
  AJUSTE
}

model Person {
  id            Int       @id @default(autoincrement())
  name          String
  role          String
  color         String
  active        Boolean   @default(true)
  tasks         Task[]
  // ...resto de relaciones inversas
}

model Task {
  id          Int             @id @default(autoincrement())
  description String
  personId    Int
  person      Person          @relation(fields: [personId], references: [id])
  frequency   TaskFrequency
  active      Boolean         @default(true) // decisión pendiente: ¿se agrega?
  executions  TaskExecution[]
}

model TaskExecution {
  id            Int      @id @default(autoincrement())
  taskId        Int
  task          Task     @relation(fields: [taskId], references: [id])
  periodDate    DateTime? // null para urgente/unica
  periodKind    String    // 'diaria' | 'semanal' | 'mensual' | 'urgente' | 'unica' — a revisar
  done          Boolean   @default(false)
  doneAt        DateTime?
  completedById Int?
  note          String?

  @@unique([taskId, periodDate, periodKind])
}

// ... modelos StockItem, StockCategory, Movement (con `type: MovementType`),
// Destination, Event, Photo, Note, Pet, PetType, PetRecord, CoopConfig,
// EggCollection, EmployeeProfile, Child, PinCredential — a completar en la
// etapa de diseño de Prisma, con las columnas ya listadas arriba en este documento.
```

Este borrador es intencionalmente incompleto: sirve como punto de partida para la etapa dedicada de diseño de Prisma (`docs/MIGRATION_PLAN.md`, etapa 3), donde se decidirán los puntos marcados como duda (FKs reales vs. texto libre, modelo de `periodo`, soft-delete uniforme, etc.) junto con el usuario.
