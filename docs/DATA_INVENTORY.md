# DATA_INVENTORY.md — Inventario exhaustivo de datos declarados en `index.html`

> Todos los datos listados en este documento provienen de literales JavaScript embebidos en `index.html`. Ninguno se llama "mock": son información inicial real del negocio (personas, tareas, stock, catálogos, configuración) tal como la declaró quien construyó el prototipo. Cuando un dato existe en el código pero **no llega efectivamente a persistirse** por la lógica actual (ver columna "¿Se siembra hoy?"), se aclara explícitamente — es una falla de la función de siembra (`seedData()`), no una razón para descartar el dato como no-real.
>
> **Nota (Etapa 2.3)**: `index.html` fue retirado del repositorio (contenía credenciales reales de Supabase — ver `docs/SECURITY.md`). Todo el inventario de este documento ya está migrado a `backend/prisma/seed-data/` (ver `docs/SEED_MANIFEST.md`); las citas de línea quedan como registro histórico de la auditoría.

## Cómo leer las tablas

- **Ubicación**: línea aproximada en `index.html`.
- **Tabla futura sugerida**: nombre de tabla ya usado por el propio código contra Supabase (columna "Tabla Supabase actual"), que se traslada 1:1 como punto de partida para Prisma/Postgres (ver `docs/DATABASE.md`).
- **¿Se siembra hoy?**: si `seedData()` (línea 1828) efectivamente inserta este dato en Supabase la primera vez que la app corre con `personas` vacío. La mayoría de los catálogos **no** se siembran automáticamente — solo personas, tareas y stock.
- **¿Incluir en seed de Neon?**: recomendación para la migración. Por defecto **sí**, salvo que se indique lo contrario con motivo.

---

## 1. Personas (equipo de trabajo)

Ubicación: `index.html` línea 928-933 (literal) y línea 1830-1835 (repetido dentro de `seedData()`).

| id | Nombre | Rol | Color | Activa |
|---|---|---|---|---|
| 1 | Coke | Doméstica | `#4a7c59` | true |
| 2 | Cami | Doméstica | `#8b5e3c` | true |
| 3 | Ruth | Doméstica | `#6b7c8b` | true |
| 4 | Pablo | Parque | `#2c5364` | true |

- Entidad: `personas`. Relaciones: referenciada por `pid`/`persona_id` en tareas, novedades, fotos, recolecciones, registros clínicos, empleados_datos, hijos, consumos.
- Tabla Supabase actual: `personas`. Tabla futura sugerida: `personas` (Prisma: `Person`).
- ¿Se siembra hoy? **Sí**, vía `seedData()`.
- ¿Incluir en seed de Neon? Sí.
- Nota: el catálogo de roles (`Doméstica`, `Parque`, `Otro`) es un `<select>` de texto libre en el modal de alta (línea 882), no una tabla de catálogo separada — es texto, no un ID foráneo.

## 2. Tareas

Ubicación: `index.html` línea 934-945 (literal) y línea 1839-1850 (repetido en `seedData()`).

| id | Descripción | Persona (id) | Frecuencia |
|---|---|---|---|
| 1 | Limpiar baños | 1 (Coke) | diaria |
| 2 | Aspirar planta baja | 1 (Coke) | diaria |
| 3 | Cambiar ropa de cama | 2 (Cami) | semanal |
| 4 | Limpiar cocina a fondo | 2 (Cami) | semanal |
| 5 | Planchar ropa | 3 (Ruth) | diaria |
| 6 | Limpiar ventanas exteriores | 3 (Ruth) | mensual |
| 7 | Cortar el pasto — zona principal | 4 (Pablo) | semanal |
| 8 | Regar jardines | 4 (Pablo) | diaria |
| 9 | Revisar sistema de riego | 4 (Pablo) | mensual |
| 10 | Fumigar perímetro | 4 (Pablo) | urgente |

- Entidad: `tareas`. Relaciones: `pid` → personas; cada tarea genera filas en `ejecuciones` (cumplimiento por período).
- Tabla Supabase actual: `tareas`. Tabla futura sugerida: `tareas` (Prisma: `Task`).
- ¿Se siembra hoy? **Sí**.
- ¿Incluir en seed de Neon? Sí.
- Ver `docs/BUSINESS_RULES.md` sección 6 sobre el campo `activa` que el código de Desempeño espera pero que **no existe** en ningún registro de tareas — al migrar, decidir si se agrega el campo con `true` por defecto o si se elimina esa lógica.

## 3. Stock — Casa

Ubicación: `index.html` línea 949-957 (literal) y línea 1852-1859 (`seedData()`, `area:'casa'`).

| id | Producto | Stock | Mínimo | Unidad | Categoría |
|---|---|---|---|---|---|
| 1 | Detergente | 2 | 3 | litros | Limpieza |
| 2 | Lavandina | 5 | 3 | litros | Limpieza |
| 3 | Desinfectante pisos | 1 | 2 | litros | Limpieza |
| 4 | Papel higiénico | 24 | 12 | rollos | Baño |
| 5 | Bolsas de basura | 30 | 20 | unidades | Limpieza |
| 6 | Trapos de piso | 3 | 4 | unidades | Limpieza |
| 7 | Esponjas | 6 | 5 | unidades | Limpieza |

## 4. Stock — Jardín

Ubicación: `index.html` línea 958-966 (literal) y línea 1859-1865 (`seedData()`, `area:'jardin'`).

| id | Producto | Stock | Mínimo | Unidad | Categoría |
|---|---|---|---|---|---|
| 1 | Fertilizante NPK | 5 | 10 | kg | Fertilizantes |
| 2 | Herbicida glifosato | 3 | 2 | litros | Fitosanitarios |
| 3 | Insecticida | 1 | 2 | litros | Fitosanitarios |
| 4 | Combustible motosierra | 8 | 5 | litros | Combustibles |
| 5 | Combustible cortadora | 4 | 5 | litros | Combustibles |
| 6 | Mangueras de repuesto | 2 | 1 | metros | Herramientas |
| 7 | Guantes de trabajo | 1 | 2 | pares | Herramientas |

- Entidad de 3 y 4: `stock` (con campo `area` = `casa`/`jardin`). Relaciones: cada ítem referenciado por `stockId`/`stock_id` en `consumos`.
- Tabla Supabase actual: `stock`. Tabla futura sugerida: `stock_items` (Prisma: `StockItem`), con `area` como enum.
- ¿Se siembra hoy? **Sí** (ambas áreas, en el mismo `sbPost('stock', seedStock)`).
- ¿Incluir en seed de Neon? Sí.
- Con estos valores iniciales, **11 de los 14 ítems ya nacen en estado "bajo" o "crítico"** según `sStatus()` (todos salvo Lavandina, Papel higiénico y Bolsas de basura) — dato de negocio real a tener en cuenta al migrar (no es casualidad ni placeholder, refleja el estado real del inventario al momento de construir el prototipo).

## 5. Catálogo de categorías de stock (fallback en código)

Ubicación: línea 913-914.

- Casa (`CATS_CASA`): Limpieza, Alimentos, Baño, Ropa/Textil, Medicamentos, Varios.
- Jardín (`CATS_JARDIN`): Fertilizantes, Combustibles, Herramientas, Fitosanitarios, Alimentos, Pileta, Varios.
- Entidad: catálogo, futura tabla `categorias_stock` (área `casa`/`jardin`/`ambas`).
- Tabla Supabase actual: `categorias_stock` — **existe como tabla** (el código la lee/escribe vía `loadCategorias()`/`guardarCategoria()`), pero estos 13 nombres (6+7) son solo el *fallback en JS* usado si la tabla viene vacía; no hay ninguna función que los inserte automáticamente en Supabase.
- ¿Se siembra hoy? **No.**
- ¿Incluir en seed de Neon? **Sí, recomendado** — son las categorías reales usadas por los ítems de stock iniciales (secciones 3 y 4) y deben preexistir para que esos ítems tengan categoría válida.

## 6. Novedades

Ubicación: línea 967-970.

| id | Persona (id) | Texto | Fecha (relativa al momento de carga) |
|---|---|---|---|
| 1 | 4 (Pablo) | "La bomba de riego hace un ruido raro al arrancar." | `Date.now() - 86400000` (≈ 1 día antes de abrir la app) |
| 2 | 1 (Coke) | "Falta jabón líquido en el baño de la planta baja." | `Date.now() - 10800000` (≈ 3 horas antes) |

- Entidad: `novedades`. Relación: `pid` → personas.
- Tabla Supabase actual: `novedades`. Tabla futura sugerida: `novedades` (Prisma: `Note`/`Update`).
- ¿Se siembra hoy? **No** — `seedData()` no incluye novedades; son datos reales declarados en el código pero que nunca llegan a Supabase salvo carga manual.
- ¿Incluir en seed de Neon? **Sí, con fecha fija** (no relativa a "ahora") — al migrar, reemplazar el timestamp relativo por una fecha absoluta real si se conoce, o consultar al usuario la fecha real de estos dos avisos.

## 7. Eventos (array literal inicial)

Ubicación: línea 995-999.

| id | Título | Fecha | Tipo | Nota |
|---|---|---|---|---|
| 1 | Cumpleaños de Benjamín | 2026-02-19 | cumple | (vacía) |
| 2 | Revisión bomba de agua | 2026-05-20 | mant | "Llamar al técnico antes" |
| 3 | Visita familia O'Dwyer | 2026-06-15 | visita | "Preparar asado" |

- Entidad: `eventos`. Tabla Supabase actual: `eventos`. Tabla futura sugerida: `eventos` (Prisma: `Event`).
- ¿Se siembra hoy? **No.** Este array se sobreescribe inmediatamente por `loadAll()` (que trae `eventos` desde Supabase) antes de que la app renderice nada, y `seedData()` tampoco lo inserta. Es decir: **estos 3 eventos son datos reales intencionales que hoy no tienen ningún camino de código que los persista** — o ya fueron cargados manualmente en Supabase por fuera del código auditado (no verificable desde el HTML), o se perdieron.
- ⚠️ Ver `docs/BUSINESS_RULES.md` sección 14: el evento "Cumpleaños de Benjamín" de esta lista (19/02) **contradice** la fecha de cumpleaños de Benjamín calculada por `addFamilyBirthdays()` (16/09, sección 8 de este documento). Requiere decisión humana sobre cuál es la fecha correcta antes de sembrar cualquiera de las dos en Neon.
- ¿Incluir en seed de Neon? Sí, pero **resolver la inconsistencia de fecha de Benjamín primero**, y confirmar con el usuario si "Revisión bomba de agua" y "Visita familia O'Dwyer" siguen siendo vigentes (son fechas 2026, futuras respecto al prototipo).

## 8. Cumpleaños familiares (hardcodeados en función)

Ubicación: línea 1759-1778 (`addFamilyBirthdays`).

| Nombre | Mes | Día |
|---|---|---|
| Benjamín | 9 | 16 |
| Vicky | 3 | 10 |
| Felicitas | 6 | 1 |

- Entidad: se traducen a filas de `eventos` (tipo `cumple`, nota `'familia'`), recalculando la próxima fecha cada vez que corre la función (dedupe por título exacto `'🎂 Cumpleaños de <Nombre>'`).
- ¿Se siembra hoy? **Sí, de forma indirecta** — `addFamilyBirthdays()` se ejecuta en cada `initUI()` y llama a `dbAddEvento()` si el evento no existe todavía, por lo que Vicky y Felicitas sí quedan en Supabase; Benjamín también, pero con el conflicto de fecha ya señalado en la sección 7.
- ¿Incluir en seed de Neon? Sí, para Vicky (10/03) y Felicitas (01/06) sin dudas. Para Benjamín, resolver primero la inconsistencia de fecha.

## 9. Tipos de mascota (catálogo inicial)

Ubicación: línea 986 (array inicial) y línea 2638 (lista `builtin` duplicada dentro de `pobModalTipos`).

`Perro, Gato, Caballo, Burro, Guinea, Pato, Pavo real, Gallina, Faisán` (9 tipos).

- Entidad: catálogo, futura tabla `tipos_mascota`.
- Tabla Supabase actual: `tipos_mascota` — existe y se lee/escribe (`loadMascotas()`, `guardarTipoMascota()`, `eliminarTipo()`).
- ¿Se siembra hoy? **No** — y además, `loadMascotas()` (línea 2770) **sobreescribe** el array inicial con el resultado de `sbGet('tipos_mascota')` sin importar si viene vacío. Si la tabla en Supabase está vacía, el catálogo visible en la app queda vacío tras la carga, pese a que el código "parece" arrancar con 9 tipos precargados.
- ¿Incluir en seed de Neon? **Sí, recomendado** — son el catálogo base real de animales de la propiedad; conviene sembrarlos explícitamente para no depender de que ya existan en Supabase (dato no verificable desde el HTML).

## 10. Mapeo de íconos por tipo de animal

Ubicación: línea 2371-2377 (`TIPO_ICONS`) y línea 2379-2387 (`ANIMAL_EMOJIS`, picker más amplio con 25 opciones incluyendo tipos que no están en el catálogo inicial: Ternero, Vaca, Toro, Cerdo, Oveja, Cabra, Conejo, Pavo, Ganso, Avestruz, Llama, Alpaca, Loro, Perdiz, Pez, Tortuga, Lagarto, Abeja, Otro).

- Es configuración de presentación (emoji por nombre de tipo), no un dato de negocio a migrar como fila de tabla — se traslada como diccionario estático o campo `icono` en la tabla de tipos.
- ¿Incluir en seed de Neon? Si el modelo de datos define un campo `icono`/`emoji` por tipo de mascota, sí completar con estos valores; si no, se preserva como constante de frontend.

## 11. Configuración de gallinero

Ubicación: línea 973-977.

- `gallinasActivas = 0` (valor inicial en memoria, antes de cargar de Supabase).
- No hay cantidad "real" de gallinas hardcodeada como dato de negocio — el valor real vive en la tabla `gallinero` de Supabase y no es observable desde el HTML.
- ¿Incluir en seed de Neon? **No aplica** como literal — se debe consultar al usuario la cantidad real de gallinas activas al momento de la migración (dato vivo, no declarado en el código).

## 12. Destinos de consumo

- No hay destinos hardcodeados como literal de datos (a diferencia de personas/tareas/stock). El único destino que el código genera automáticamente es **"Ajuste de inventario"** (tipo `sector`, activo), creado la primera vez que hace falta vía `ensureAjusteDestino()` (línea 1749).
- Entidad: `destinos_consumo` (tipo `vehiculo` o `sector`).
- ¿Se siembra hoy? Solo "Ajuste de inventario", de forma perezosa (la primera vez que se necesita, no en `seedData()`).
- ¿Incluir en seed de Neon? Sí, incluir "Ajuste de inventario" como fila fija del seed (es un dato estructural del sistema, no del negocio); los demás destinos (vehículos/sectores reales de la propiedad) deben pedirse al usuario — no están en el HTML.

## 13. Empleados — datos personales, hijos, registros clínicos, mascotas, recolecciones, consumos, PINs

Ninguno de estos tiene literales de datos reales precargados en `index.html`: los arrays iniciales están **vacíos** en el código (`empleadosDatos = []`, `hijosData = []`, `registrosClinicos = []`, `mascotas = []`, `recolecciones = []`, `consumos = []`, `USER_PINS = {}`). Toda esta información, si existe, vive únicamente en Supabase y **no es recuperable desde el HTML auditado**.

- ¿Incluir en seed de Neon? No hay nada que sembrar desde el código para estas entidades; si existen datos reales cargados en el Supabase actual, deben exportarse de ahí (fuera del alcance de esta auditoría, que es solo sobre `index.html`) antes de poder incluirlos en el seed de Neon.

## 14. Configuraciones / constantes de interfaz (no son datos de negocio a migrar como filas)

| Constante | Valor | Uso |
|---|---|---|
| `MESC` / `MESL` | Meses abreviados/completos en español | Formato de fechas en UI |
| `DIAS` / `DIAS2` / `DIAS3` | Días de la semana en 3 formatos | Formato de fechas en UI |
| `WD` / `WI` | Mapeo código-clima (Open-Meteo) → descripción/ícono | Pantalla Clima |
| Coordenadas clima | lat `-32.15`, lon `-58.40` (Villa Elisa, Entre Ríos) | Llamada a Open-Meteo |
| `ADMIN_PIN` inicial | `'1234'` | Fallback si Supabase no responde con un PIN de admin — ver `docs/SECURITY.md` |
| Colores de rol por defecto en modal de persona | `#4a7c59` | Valor por defecto del `<input type=color>` al crear persona |

Estas constantes son configuración de interfaz/presentación, no catálogos de negocio — se trasladan como constantes del nuevo frontend, no como tablas.

## 15. Resumen — qué se siembra automáticamente hoy y qué no

| Dato | ¿`seedData()` lo inserta? |
|---|---|
| Personas (4) | ✅ Sí |
| Tareas (10) | ✅ Sí |
| Stock Casa + Jardín (14 ítems) | ✅ Sí |
| Novedades (2) | ❌ No |
| Eventos literales (3) | ❌ No |
| Cumpleaños familiares (3, vía `addFamilyBirthdays`) | ✅ Sí, pero fuera de `seedData()` (corre en cada `initUI()`) |
| Tipos de mascota (9) | ❌ No |
| Categorías de stock (13) | ❌ No |
| Destino "Ajuste de inventario" | ✅ Sí, pero de forma perezosa (`ensureAjusteDestino()`, fuera de `seedData()`) |
| Todo lo demás (mascotas, empleados, hijos, clínicos, recolecciones, consumos, PINs, destinos reales) | No hay literales — dato vivo solo en Supabase actual, no observable desde el HTML |

Esta tabla es clave para `docs/MIGRATION_PLAN.md`: el futuro seed de Neon debe cubrir explícitamente todo lo marcado ❌, porque el prototipo nunca lo hizo por sí solo.

## 16. Actualización — Etapa 2: estado del nuevo seed (`backend/prisma/seed.ts`)

El seed escrito en la Etapa 2 (Prisma, **no ejecutado todavía** — ver `docs/SEED_MANIFEST.md` para el manifiesto exacto) cubre explícitamente todo lo que `seedData()` dejaba afuera:

| Dato | ¿El seed de la Etapa 2 lo cubre? |
|---|---|
| Personas → `Employee` + `User` (4) | ✅ Sí (más una cuenta `User` `PENDING_ACTIVATION` por cada una, no solo el empleado) |
| Tareas → `Task` (10) | ✅ Sí |
| Stock → `StockItem` (14) + saldo inicial vía `StockMovement` | ✅ Sí |
| Categorías de stock → `StockCategory` (13) | ✅ Sí — corrige la omisión del prototipo |
| Novedades → `NewsReport` (2) | ✅ Sí — corrige la omisión del prototipo (con la salvedad de la fecha, ver abajo) |
| Eventos literales → `Event` (2 de 3) | ✅ Sí para "Revisión bomba de agua" y "Visita familia O'Dwyer"; el evento de cumpleaños de Benjamín **no se siembra** (fecha contradictoria, ver `docs/BUSINESS_RULES.md` §14) |
| Cumpleaños familiares → `RecurringBirthday` (2 de 3) | ✅ Sí para Vicky y Felicitas (con recurrencia calculada dinámicamente, no una fecha fija); Benjamín omitido por la misma razón |
| Tipos de mascota → `AnimalType` (9) | ✅ Sí — corrige la omisión del prototipo |
| Destino "Ajuste de inventario" | ❌ No se siembra — ya no hace falta: `StockMovementType` (enum) reemplaza estructuralmente ese pseudo-destino, ver `docs/DATABASE.md` |
| Cantidad de gallinas → `ChickenCoop` | ❌ No se siembra a propósito — sin valor comprobado, ver `docs/SEED_MANIFEST.md` |
| Todo lo demás (mascotas, datos de empleados, hijos, registros clínicos, recolecciones, consumos no-apertura, PINs) | ❌ No se siembra — sigue sin haber literales reales en el HTML para estas entidades |

Diferencia de fondo respecto a la tabla anterior: el prototipo nunca tuvo código que sembrara novedades/eventos/tipos de mascota/categorías en Supabase (columna ❌ arriba). El seed de la Etapa 2 sí los cubre — pero **todavía no se ejecutó contra ninguna base** (Etapa 2 es solo diseño + escritura del seed, no su ejecución).

**Corrección — conteo exacto (revisión correctiva de la Etapa 2).** La entrega original de la Etapa 2 resumía el seed como "61 filas" sin distinguir que ese número ya excluía los movimientos de apertura de stock, generando una lectura ambigua. Conteo correcto, documentado con detalle en `docs/SEED_MANIFEST.md`: **61 entidades maestras** (la suma de la columna "Dato" de arriba, contando cada fila de catálogo/registro una sola vez) **+ 14 `StockMovement` de apertura** (una por cada `StockItem`, no son una entidad maestra nueva, son una fila hija) **= 75 filas potenciales en total** si el seed se ejecutara contra una base vacía. Verificado con tests (`backend/src/test/seed-data.test.ts`, describe "Conteo total del seed").
