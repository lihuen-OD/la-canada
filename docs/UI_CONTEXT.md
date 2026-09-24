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
- Cifras en Fraunces.
- Bloques resumidos para tareas urgentes, progreso del equipo, alertas de stock, próximos eventos y novedades.
- Cada resumen debe provenir de datos reales; no mostrar métricas mock.

### Tareas

Desempeño se integra mediante navegación secundaria `✅ Tareas | 📊 Desempeño`, sin destino principal nuevo. Reutiliza tarjetas blancas, cifras Fraunces, avatares, chips desplazables y barras; apila a 360 px y usa grilla desde 768 px.

- Filtro horizontal por persona con avatar y cantidad pendiente.
- Filtros por frecuencia mediante chips.
- Lista de tareas dentro de tarjetas.
- Check visual redondeado.
- Frecuencia y responsable como metadatos secundarios.
- Historial semanal separado de la operación actual.
- Acciones administrativas claras y no disponibles para empleados sin permiso.

### Stock

- Separación entre Casa y Jardín.
- Estado de cantidad mediante barra de progreso, valor numérico y etiqueta textual.
- Estados: normal, bajo y crítico.
- Agrupación por categoría.
- Movimientos y saldos deben provenir del backend transaccional.

### Novedades

- Avatar, autor, tiempo relativo y contenido.
- Separadores suaves.
- Lectura rápida y cronología clara.

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
