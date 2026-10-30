# La Cañada — Contexto visual y sistema de interfaz

## Propósito

Este documento conserva la identidad visual útil del prototipo original para reconstruir la aplicación en React sin reutilizar su código, sus credenciales, su acceso directo a datos ni sus decisiones inseguras.

Es la referencia visual del proyecto. Las reglas de negocio, contratos API, seguridad y permisos continúan definidos en el resto de `docs/` y en el backend.

## Dirección visual

La Cañada debe sentirse cálida, rural, ordenada y cercana. No es un panel corporativo frío ni una aplicación agrícola industrial. La interfaz combina:

- verde bosque como identidad principal;
- crema y blanco cálido como superficies;
- marrón tierra como acento secundario;
- tipografía editorial suave en títulos;
- tipografía sans-serif clara para operación diaria;
- tarjetas redondeadas, sombras discretas y densidad moderada;
- iconografía sencilla y reconocible;
- experiencia mobile-first.

El resultado debe conservar la personalidad doméstica y de campo del prototipo, mejorando accesibilidad, consistencia y calidad profesional.

## Tipografía

- Títulos, marca, cifras destacadas y encabezados importantes: `Fraunces`, serif.
- Navegación, botones, formularios, etiquetas y texto general: `Karla`, sans-serif.
- Cargar ambas fuentes explícitamente y definir fallbacks apropiados.
- Evitar sustituirlas por una estética genérica de dashboard SaaS.

Escala orientativa:

- marca: 20–32 px según contexto;
- título de página: 21–26 px;
- título de sección: 17–19 px;
- cuerpo principal: 14–15 px;
- texto auxiliar: 11–13 px;
- etiquetas pequeñas: 10–11 px.

## Paleta original

### Identidad verde

| Token semántico | Valor | Uso |
| --- | --- | --- |
| `forest-950` | `#1a2e1e` | Header, navegación, fondo del login |
| `forest-700` | `#2d5a35` | Botones principales, acciones activas |
| `forest-600` | `#4a7c59` | Progreso, estados positivos, avatares |
| `forest-400` | `#7ab587` | Acentos sobre fondo oscuro |
| `forest-100` | `#e8f2ea` | Fondos suaves y chips positivos |

### Neutros cálidos

| Token semántico | Valor | Uso |
| --- | --- | --- |
| `cream-50` | `#f7f3ed` | Fondo general |
| `cream-100` | `#ede7dd` | Superficies secundarias |
| `border-warm` | `#d8cfc4` | Bordes y separadores |
| `ink-950` | `#1e1a16` | Texto principal |
| `ink-500` | `#7a6e62` | Texto secundario |
| `earth-600` | `#8b5e3c` | Acento tierra |
| `earth-100` | `#f2ece5` | Fondo del acento tierra |

### Estados

| Estado | Principal | Fondo suave |
| --- | --- | --- |
| Error/crítico | `#c0392b` | `#fdecea` |
| Advertencia | `#c89a0a` | `#fef9e7` |
| Información | `#2c6e8b` | `#e8f4f8` |
| Positivo | `#4a7c59` | `#e8f2ea` |

No usar únicamente color para comunicar estados. Acompañar con texto, icono o etiqueta.

### Aclaraciones de contraste (Etapa 3E)

Medido al implementar los tokens (`frontend/src/styles/tokens.css`). La paleta de arriba se conserva exacta; solo se agregan variantes derivadas donde un valor original no alcanza WCAG AA en el uso concreto:

| Uso | Valor original | Ratio medido | Variante usada |
| --- | --- | --- | --- |
| Texto secundario sobre `cream-50` / `cream-100` | `#7a6e62` | 4.49:1 / 4.03:1 | `#6f6458` (5.22:1 / 4.69:1). `#7a6e62` se mantiene para iconos y el avatar neutro. |
| Texto de advertencia sobre `#fef9e7` | `#c89a0a` | 2.46:1 | `#7a5b00` (5.99:1). `#c89a0a` queda como acento (borde del aviso). |
| Borde de inputs (componente de interfaz, 3:1) | `#d8cfc4` | 1.54:1 | `#958676` (3.53:1 sobre blanco). `#d8cfc4` sigue siendo el borde de tarjetas y separadores. |
| Texto de error sobre verde bosque (login) | `#c0392b` | 2.6:1 aprox. | `#f4b4ab` (8.2:1). |

El resto de los pares usados cumple AA sin cambios (p. ej. blanco sobre `#2d5a35` 8.0:1, `#7ab587` sobre `#1a2e1e` 6.05:1, `#c0392b` sobre `#fdecea` 4.76:1, `#2c6e8b` sobre `#e8f4f8` 5.05:1, `#8b5e3c` sobre `#f2ece5` 4.76:1).

## Fundamentos de componentes

- Radio de tarjeta principal: 16 px.
- Radio de controles y elementos pequeños: 10 px.
- Radio de modal móvil: 22 px en esquinas superiores.
- Sombra base: `0 1px 4px rgba(30, 26, 22, 0.08)`.
- Bordes: 1 px con neutro cálido.
- Altura táctil mínima: 44 px.
- Animaciones breves, entre 150 y 250 ms.
- Respetar `prefers-reduced-motion`.
- Fondo general crema; tarjetas principalmente blancas.

## Estructura de la aplicación

### Móvil

- Header fijo de aproximadamente 54 px.
- Marca a la izquierda y contexto breve a la derecha.
- Navegación fija inferior de aproximadamente 66 px.
- Cada destino combina icono y etiqueta corta.
- Contenido con 14–18 px de padding lateral.
- Acción primaria contextual mediante FAB solamente cuando resulte útil.
- Modales como bottom sheet.

### Escritorio

- Header superior fijo.
- Navegación lateral izquierda de aproximadamente 210 px.
- Destino activo con acento verde claro, fondo sutil y borde izquierdo.
- Contenido con ancho legible y máximo cercano a 1200 px.
- Padding general aproximado de 26 px vertical y 34 px horizontal.
- Modales centrados, con ancho aproximado de 460 px.
- Ocultar el FAB y usar acciones explícitas en encabezados.

La navegación final debe ajustarse a los módulos realmente implementados. No mostrar destinos vacíos o simulados.

## Header y marca

- Fondo verde bosque oscuro.
- Marca `La Cañada` en Fraunces y color crema.
- Se puede destacar una parte de la marca en verde claro e itálica.
- Mantener alta legibilidad y contraste.
- El header puede mostrar fecha, identidad o contexto breve, pero no debe saturarse.

## Tarjetas

- Fondo blanco.
- Borde cálido fino.
- Radio de 16 px.
- Sombra muy discreta.
- Encabezado interno con borde inferior cuando la tarjeta tiene título y acciones.
- Cuerpo con 12–16 px de padding.
- Evitar tarjetas anidadas en exceso.
- En móvil, preferir listas compactas; en escritorio, aprovechar grillas de dos columnas cuando mejore la lectura.

## Botones

### Primario

- Fondo `#2d5a35`.
- Texto blanco.
- Hover hacia `#1a2e1e`.
- Radio de 10 px.
- Peso semibold.

### Secundario

- Fondo crema secundario.
- Texto oscuro.
- Borde cálido.

### Destructivo

- Fondo rojo suave.
- Texto rojo oscuro.
- Siempre requiere confirmación para acciones irreversibles.

### Fantasma

- Fondo transparente.
- Texto secundario.
- Usar para volver, cancelar o acciones de baja jerarquía.

## Chips, filtros y etiquetas

- Chips en forma de píldora.
- Estado inactivo blanco con borde cálido.
- Estado activo verde principal con texto blanco.
- En móvil pueden desplazarse horizontalmente sin mostrar scrollbar invasiva.
- Las etiquetas de frecuencia, estado o tipo utilizan fondos suaves y texto contrastante.
- Mantener vocabulario consistente en español.

## Avatares e identidades

- Avatares circulares con inicial.
- Color proveniente del perfil cuando exista y haya sido validado.
- Fallback neutro si el color es inválido o inexistente.
- Tamaño pequeño cercano a 26 px; tamaño estándar cercano a 36 px.
- Nunca depender solo del color para identificar personas.

## Formularios

- Fondo crema muy claro en reposo y blanco en foco.
- Borde de 1–1.5 px.
- Foco verde claramente visible.
- Labels pequeños, semibold, con espaciado de letras moderado.
- Inputs de aproximadamente 44 px de alto como mínimo.
- Dos columnas solamente cuando el ancho lo permite; una columna en móvil.
- Errores próximos al campo y resumen cuando corresponda.
- No usar placeholders como reemplazo de labels.

## Modales

- Móvil: bottom sheet con esquinas superiores redondeadas y tirador visual.
- Escritorio: diálogo centrado.
- Overlay oscuro cálido y semitransparente.
- Foco contenido, cierre por Escape cuando sea seguro y restauración del foco al cerrar.
- Pie con acción secundaria y primaria de jerarquía clara.
- Confirmaciones destructivas deben explicar el efecto concreto.

## Login por PIN

El diseño original usaba un fondo verde bosque completo, marca centrada y una tarjeta translúcida. Esa identidad debe conservarse, pero con el flujo seguro actual:

- lista real de identidades activas obtenida del backend;
- tarjeta de administrador y tarjetas de empleados;
- teclado numérico de tres columnas;
- cuatro indicadores visuales del PIN;
- botón para borrar y volver;
- mensajes genéricos de error;
- navegación completa mediante teclado;
- PIN nunca visible ni persistido.

La implementación React actual debe reconciliarse visualmente con esta referencia sin debilitar su arquitectura de seguridad.

## Administración de usuarios

- Conservar el lenguaje visual de Configuración del prototipo: tarjetas claras, encabezados simples y acciones visibles.
- En móvil, mostrar usuarios como tarjetas.
- En escritorio, usar presentación tipo tabla sin perder calidez visual.
- Estado y rol mediante etiquetas.
- Activar, cambiar PIN, suspender y reactivar mediante diálogos seguros.
- No mostrar hashes, intentos internos ni información técnica innecesaria.

## Patrones por módulo

### Inicio

- Grilla de KPI: dos columnas en móvil y cuatro en escritorio.
- Tarjetas (2026-10-26): una sola secuencia en orden de lectura (Urgentes, Desempeño, Stock crítico, Atenciones de mascotas, Próximos eventos, Novedades). En móvil y tablet (< 900 px), una columna. En escritorio, dos columnas que se llenan de arriba abajo y que el navegador equilibra (multi-columna CSS, `break-inside: avoid`): ninguna queda vacía mientras la otra acumula tarjetas, sin alturas fijas ni tarjetas estiradas, y el orden visual (columna por columna) coincide con el del DOM y el teclado.
- Cifras en Fraunces.
- Bloques resumidos para tareas urgentes, progreso del equipo, alertas de stock, próximos eventos y novedades.
- «🐾 Atenciones de mascotas» (pedido del usuario, 2026-10-26), entre «⚠️ Stock crítico» y «📅 Próximos eventos»: la misma tarjeta (`DashboardCard`) con «Ver vencimientos»; resumen de totales en texto secundario; hasta 5 filas tocables (nombre en negrita, tipo · descripción en una línea con elipsis, «Programada: dd/mm/aaaa · Hace N días» con el tono de 📅 Vencimientos) y la etiqueta de estado (`Badge`) a la derecha. Los enlaces de las tarjetas no se cortan en dos líneas: el título se ajusta.
- Cada resumen debe provenir de datos reales; no mostrar métricas mock.

### 🥬 Huerta

- Misma estética que 📋 Tareas (filas, chips de persona y frecuencia, «Hoy»/«Vencidas», diálogos, historial y Desempeño), con el título «🥬 Huerta» y pestañas `pill-nav`: 🌱 Actividades, 📅 Historial, 🏆 Desempeño y 👥 Participantes.
- Participantes: fila con avatar, nombre, puesto (o «Administrador»), etiquetas de estado con texto («Activo», «Inactivo», «Cuenta suspendida») y la acción del ADMIN.
- Estados vacíos con el botón real debajo («Agregar participante», «Crear actividad»), nunca dentro de `EmptyState`.
- Barra inferior con 7 destinos: debajo de 390 px el relleno lateral de cada enlace baja a `--space-1` para que entren todos sin cortarse.

### Tareas

Desempeño se integra mediante navegación secundaria en chips `📋 Tareas | 🏆 Desempeño` (emojis exactos del prototipo; el destino principal también usa 📋), sin destino principal nuevo. Reutiliza tarjetas blancas, cifras Fraunces, avatares, chips desplazables y barras; apila a 360 px y usa grilla desde 768 px.

- Filtro horizontal por persona con avatar y cantidad pendiente.
- Filtros por frecuencia mediante chips (Bimestrales y Anuales después de Mensuales). Dentro de «Una vez», una segunda fila de chips con los accesos «Hoy» y «Vencidas» (con su cantidad, combinables con la persona; tocar el elegido vuelve a todas).
- «Una vez» con fecha para realizar: después de la etiqueta de frecuencia, una etiqueta de estado con punto (`Programada` neutral, `Para hoy` warning, `Vencida` danger) y la fecha con el día de la semana («📅 Lunes 26/10/2026») como metadato secundario. Sin fecha: sin cambios. Bimestral y Anual usan el tono `warning` de la mensual.
- Orden de realización y programación sugerida: en los metadatos, texto secundario sin color de estado («Sugerida: miércoles 28/10/2026», «Orden 2»). En el formulario, el orden (número) va al final para todas las frecuencias y la sugerencia solo con los campos de la frecuencia elegida (pares en dos columnas con `.field-row`).
- Lista de tareas dentro de tarjetas.
- Casilla cuadrada del prototipo (`.tck`, 22 px visibles dentro de 44 px táctiles); ✏️/✕ del ADMIN como botones de icono a la derecha.
- Frecuencia y responsable como metadatos secundarios.
- Historial semanal separado de la operación actual.
- Urgentes y «Una vez» completadas salen del listado (se consultan en el historial y en Desempeño); con «Urgentes» y ninguna pendiente, el vacío «No hay urgentes pendientes.».
- Desempeño → Detalle (solo Tareas): cada fila conserva su rótulo de estado a la derecha y, debajo, su acción si el backend la habilita — «Marcar realizada» (botón secundario chico), «Completar en Tareas» (enlace fantasma) o «Deshacer» (fantasma; para el ADMIN abre la corrección con motivo). En pantallas angostas la acción baja a su línea sin desbordar. El diálogo «✅ Marcar como realizada» usa el modal de siempre (hoja inferior en móvil): diaria = una pregunta de confirmación; períodos largos = «Período» como rango y «Fecha en que la realizaste» vacía con el día de la semana debajo; ADMIN = lista de personas como en «Registrar tarea completada». Una carga olvidada se lee «Realizada el 29/10 · Registrada el 30/10» como metadato secundario.
- Desempeño → Detalle (solo Tareas): arriba, «Fecha» (calendario nativo limitado al rango, con la fecha en formato de la app debajo y «Todas las fechas» para quitarla), chips desplazables de frecuencia y de estado (Todas, Sin completar, Realizadas, Cubiertas, Cubrió a otros) y «Limpiar filtros» (fantasma) cuando hay alguno; debajo, grupos por día con un encabezado chico en texto atenuado y línea divisoria, «Sin fecha» al final; al pie, «Mostrando X de Y registros» y «Ver más» (secundario, a lo ancho). Las acciones de las filas son compactas («Marcar realizada» secundario chico, «Deshacer» fantasma; 44 px táctiles) y van en la misma línea que el estado.
- Acciones administrativas claras y no disponibles para empleados sin permiso.

### Stock

- Separación entre Casa y Jardín.
- Estado de cantidad mediante barra de progreso, valor numérico y etiqueta textual.
- Estados con las etiquetas del prototipo: OK, Bajo y Crítico (siempre texto, nunca solo color).
- Fila compacta (`.si`): nombre, barra + «actual / mínimo unidad», etiqueta de nivel y acciones de icono (📤 movimiento, ⚙️ ajuste ADMIN, 📋 historial); barra ⚠️ «N ítems bajo mínimo» cuando el filtro está completo.
- Agrupación por categoría.
- Movimientos y saldos deben provenir del backend transaccional.

### Novedades

- Avatar, autor, tiempo relativo y contenido.
- Separadores suaves.
- Lectura rápida y cronología clara.

#### Conversaciones — ajuste visual en `demo` (2026-10-30)

- Historial en una sola columna, sin alturas rígidas ni scroll interno. La novedad conserva avatar, autor, fecha y texto; su barra reúne «Responder», abrir/cerrar con contador y última respuesta. (Distribución actualizada el 2026-10-30, ver «Distribución adaptable».)
- Comentarios sobre blanco, separados por una línea suave; avatar compartido pequeño con el color neutro existente (el contrato de respuestas solo ofrece nombre), nombre destacado y fecha junto al nombre. Texto de 15 px con saltos de línea y corte de palabras largas; sangría solo en escritorio.
- Orden de lectura: encabezado del autor → cita → texto nuevo → «Responder». La cita usa fondo suave y borde verde; la vista previa se limita a dos líneas con CSS, conservando todo el texto en el DOM.
- Compositor separado por una línea: «Tu respuesta», textarea de tres filas ampliable, botón «Enviar» compacto a la derecha, cita con cancelación accesible y errores asociados al campo. Controles de al menos 44 × 44 px y foco visible.
- La primera apertura sigue montando y cargando el hilo en diferido. Después se oculta sin desmontar el formulario para conservar borrador, cita, error e intento idempotente; la consulta queda deshabilitada mientras está cerrado. Sin storage, nuevas claves, cambios de permisos ni cambios del envío. Al anteponer respuestas se conserva la coordenada de la primera fila existente en el scroll de la página.
- Archivos de implementación: `frontend/src/features/more/NewsScreen.tsx`, `frontend/src/styles/more.css`; regresiones en `frontend/src/features/more/MoreModule.test.tsx`. Inicio, alta de novedades, contratos, backend, migraciones y datos sin cambios.
- Validación local: Chrome headless con API interceptada y datos identificados como sintéticos, sin backend ni base de datos. Revisadas capturas en 360, 390, 768 y 1366 px: vacío, varias respuestas, nombres/textos largos y sin espacios, citas, compositor normal/citando, error y envío. Sin overflow horizontal ni scroll interno; controles ≥ 44 px, previews ≤ 2 líneas. Carga anterior: desplazamiento de la fila de lectura de 0 px en los cuatro tamaños. Borrador/cita conservados al cerrar; cancelación conserva texto; doble clic durante envío produce un solo POST. Navegación Más → Novedades sin nuevo refresh ni `/auth/me`.
- Validaciones de frontend: typecheck, lint, build y las 68 pruebas de `MoreModule.test.tsx` + `navigationPerformance.test.tsx` en verde. El test de reintento comprueba que cerrar/abrir conserva la clave; el de citas comprueba texto completo de más de 180 caracteres, borrador y cancelación. No se ejecutaron pruebas de backend ni integraciones.
- Rendimiento: 0 requests adicionales, caché operativa de 30 s y actualización tras envío sin cambios, sin dependencias nuevas ni impacto en consultas/índices de Render/Neon. Bundle principal: 513,40 kB (139,81 kB gzip); sigue el aviso preexistente de Vite por superar 500 kB. Sin PR, merge ni deploy en este alcance; no quedan pendientes de implementación visual.

#### Distribución adaptable (2026-10-30)

- Encabezado, formulario «Registrar novedad» e historial comparten un contenedor (`.news-page`) con el mismo ancho y borde izquierdo. Máximo en escritorio: el del layout (`--content-max-width`, 1200 px); en móvil, todo el ancho con el margen habitual de la página. Antes el historial quedaba centrado y más angosto que el formulario.
- El ancho de lectura (72 `ch`, `--news-reading-width`) se acota solo en los textos dentro de las tarjetas: texto de la novedad, de cada respuesta y de las citas. Encabezados, barras de acciones y campos ocupan el ancho de la tarjeta.
- Sin columnas nuevas, alturas fijas, scrolls internos ni dependencias; solo reglas con prefijo `news-` en `more.css` (ningún estilo global).
- Revisión con API interceptada y datos sintéticos en 360, 390, 768 y 1366 px: encabezado, formulario e historial con el mismo borde y ancho en los cuatro tamaños, sin desborde horizontal.

#### Acciones sobre mensajes (2026-10-30)

- Menú «⋯» (botón fantasma de 44 × 44 px, alineado a la derecha del encabezado de la novedad o de la respuesta; margen vertical negativo para no agrandar la fila). Despliega «Editar» y/o «Eliminar» (este en rojo) según los permisos del backend; sin permisos no hay botón. Panel blanco con borde suave y sombra elevada, anclado a la derecha (no desborda en 360 px).
- Edición en el lugar del texto: textarea de tres filas (ancho de lectura), «Cancelar» y «Guardar cambios» a la derecha. Si el mensaje cambió en otra pantalla: aviso ámbar con la versión actual y «Usar la versión actual» / «Conservar mi texto»; si se eliminó: aviso ámbar y solo «Cancelar».
- «Editado · dd/mm/aaaa HH:mm» en texto pequeño y apagado debajo del texto. En citas, «(editado)».
- Marcadores en cursiva apagada: «Novedad eliminada» (conserva avatar, persona y fecha; con conversación sigue mostrando «Responder» y «Ver respuestas»; sin ella, ningún botón) y «Mensaje eliminado» (autor y fecha, sin cita ni botones). La cita de un eliminado muestra «Mensaje eliminado».
- Confirmación con la hoja/diálogo existente (`ConfirmDialog`, tono peligro). Cita eliminada mientras se redacta: el bloque de cita del compositor pasa a ámbar con «El mensaje que citabas fue eliminado.» y «Quitar cita»; «Enviar» queda deshabilitado hasta resolverlo; el borrador no se toca.
- Revisión con API interceptada y datos sintéticos en 360, 390, 768 y 1366 px (EMPLOYEE y ADMIN): menú abierto con mouse y con teclado (foco visible), edición, confirmación, conflicto de versión, conflicto de cita, marcadores y nombres/textos largos. Sin desborde horizontal; todos los botones visibles ≥ 44 px.

### Eventos

- Bloque compacto de día y mes en verde oscuro.
- Título, tipo, proximidad y nota.
- Calendario cuando aporte valor real.

### Clima

- Temperatura principal grande en Fraunces.
- Descripción, ubicación y métricas secundarias.
- Pronóstico compacto.
- Alertas con color informativo.

### Fotografías

- Grilla cuadrada: tres columnas en móvil y cinco en escritorio.
- Imágenes con `object-fit: cover`.
- Etiquetas de categoría.
- Visor sobre fondo oscuro.
- Zona de subida con borde discontinuo.
- En la aplicación nueva, los archivos se administran mediante Object Storage desde el backend.

### Mascotas

- Tarjetas o listas por animal con tipo, datos principales y acceso al detalle.
- Historial clínico claramente separado de la ficha general.
- Foto opcional proveniente del sistema de archivos seguro.

### Gallinero

- Cantidad actual destacada en Fraunces.
- Registro simple de huevos buenos y rotos.
- Persona, fecha y observaciones.
- Análisis por período mediante chips.
- Historial legible y verificable.

### Jardín

- El plano se ve **completo y centrado**, nunca recortado: `object-fit: contain` sobre una superficie clara (a diferencia de `cover` en la galería de Fotos, que es un mosaico de recuerdos).
- Versión vigente destacada (número y "Vigente") y autor/fecha en texto secundario.
- Historial en lista vertical con miniatura cuadrada, número, autor y fecha; la miniatura se pide recién al acercarse a la pantalla.
- Visor sobre fondo oscuro, como en Fotografías, con la versión y su autor a la vista.
- Zona de publicación con borde discontinuo (misma gramática que Fotos), **solo para `ADMIN`**, con vista previa antes de confirmar.
- Etiqueta accesible junto al emoji, como en el resto de la aplicación.

### Más y Configuración

- Grilla de accesos de dos columnas en móvil.
- Icono grande, título y descripción breve.
- Mostrar opciones según permisos reales.
- Configuración separada en tarjetas temáticas.

## Estados vacíos, carga y errores

- Vacíos centrados con icono, título breve y siguiente acción cuando exista.
- Skeletons discretos para carga; evitar saltos bruscos de layout.
- Errores de red con mensaje claro y botón de reintento.
- No mostrar errores técnicos o respuestas crudas.
- Distinguir ausencia real de datos de una falla de carga.

## Arranque en frío y conexión (Etapa 5R)

- **"🌿 Preparando La Cañada"**: pantalla verde bosque (mismo splash que la restauración de sesión) cuando el backend no responde pasada una demora de 1,5 s; con una respuesta rápida nunca aparece. Incluye el spinner compartido, "Reintentando automáticamente…", el tiempo real transcurrido y el próximo intento, y "Reintentar ahora" (44 px). Nunca un porcentaje ni "unos minutos" antes de tiempo. A los 60 s: "El servidor está tardando más de lo habitual. Podés seguir esperando o reintentar ahora." Sin Internet: "Sin conexión a Internet. Volveremos a intentar cuando se restablezca." (sin botón).
- En el login, el mismo aviso va dentro de la tarjeta, en lugar de "Cargando identidades…".
- **Dentro de la app**: aviso flotante (fijo sobre la navegación inferior en móvil; a la derecha del sidebar en escritorio), fondo verde bosque, radio de tarjeta, sin mover el layout ni reemplazar los datos: "Reconectando con el servidor… Tus datos siguen visibles.", "Sin conexión a Internet. Cuando vuelva la conexión, intentaremos actualizar automáticamente." y "Conexión restablecida." (se retira solo a los 4 s).
- Sesión en duda: "No pudimos confirmar tu sesión." con **Reintentar** (primario) y **Volver a ingresar** (secundario), en la pantalla de arranque y en el aviso flotante (`role="alert"`).
- Escritura sin conexión: dentro del formulario, "Sin conexión a Internet: no se guardó ningún cambio. Cuando vuelva la conexión, volvé a intentarlo." — los campos conservan lo cargado. En el login: "Sin conexión a Internet: tu PIN no se envió. Volvé a ingresarlo cuando vuelva la conexión."
- Accesibilidad: el mensaje va en una región `aria-live="polite"`/`role="status"`; el contador de segundos queda fuera para no anunciarse cada medio segundo. Sin animaciones propias: con `prefers-reduced-motion` el spinner queda estático. Alturas reservadas y cifras tabulares evitan saltos.

## Accesibilidad

- Contraste WCAG AA como mínimo.
- Foco visible en todos los controles.
- Navegación completa con teclado.
- `aria-live` para resultados y errores importantes.
- Labels accesibles en iconos y botones.
- Objetivos táctiles de al menos 44 × 44 px.
- No usar emojis como único nombre accesible.
- No comunicar estados únicamente con color.
- Respetar zoom del navegador; no bloquear escalado del usuario.

## Reglas de modernización

Se conserva:

- personalidad visual;
- paleta;
- tipografías;
- navegación responsive;
- tarjetas, chips y modales;
- jerarquía de información por módulo;
- experiencia sencilla y móvil.

Se reemplaza:

- HTML monolítico por componentes React;
- estilos inline por tokens y componentes mantenibles;
- emojis aislados por un sistema de iconos coherente cuando convenga;
- manipulación directa del DOM por estado declarativo;
- datos embebidos por API real;
- autorización visual por autorización real en backend;
- PIN en cliente por autenticación segura;
- `innerHTML` por render seguro;
- confirmaciones nativas por diálogos accesibles;
- URLs de imágenes externas por el flujo seguro de Object Storage.

## Aplicación al frontend existente

Antes de implementar Tareas:

1. Auditar visualmente Login, Home autenticado y Administración de usuarios contra esta guía.
2. Centralizar tokens de color, tipografía, radios, sombras y espaciado.
3. Cargar Fraunces y Karla de forma controlada.
4. Unificar botones, tarjetas, chips, inputs, etiquetas, modales y estados.
5. Corregir inconsistencias sin reescribir la autenticación ni cambiar contratos.
6. Validar en 360 px, 768 px y 1366 px.
7. Mantener todos los tests funcionales y agregar pruebas de regresión visual/estructural cuando sea viable.

## Fuente y seguridad

Esta guía fue derivada únicamente de la apariencia y estructura funcional del prototipo original. No contiene:

- credenciales;
- URLs de servicios;
- claves;
- PIN;
- datos personales del equipo;
- código JavaScript heredado;
- conexiones a la base anterior.

El archivo original no debe volver al repositorio.
