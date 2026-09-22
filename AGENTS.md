# AGENTS.md — Reglas obligatorias del proyecto "La Cañada"

Este documento rige el comportamiento de cualquier agente (humano o IA) que trabaje en este repositorio, en todas las etapas del proyecto. Es de cumplimiento obligatorio.

## Contexto del proyecto

"La Cañada" está en transición desde un prototipo funcional de un único archivo (`index.html`, HTML + CSS + JS embebido, conectado directamente a Supabase) hacia una aplicación profesional full stack:

- **Frontend:** React + TypeScript + Vite, desplegado en Netlify.
- **Backend:** Node.js + TypeScript + Express, desplegado en Render.
- **ORM:** Prisma.
- **Base de datos:** PostgreSQL en Neon.
- **Fotografías:** Google Drive, integrado a través del backend (nunca directo desde el frontend).

El detalle completo está en `docs/`. Este archivo no repite ese contenido: define **reglas de trabajo**.

## Reglas obligatorias

1. **Leer antes de tocar código.** Antes de modificar o crear código en cualquier etapa, leer los documentos relevantes en `docs/` (como mínimo `PROJECT_CONTEXT.md`, `BUSINESS_RULES.md` y `ARCHITECTURE.md`). No asumir comportamiento: verificar contra `index.html` y contra la base de datos real cuando exista.

2. **Etapas pequeñas y verificables.** El trabajo se divide en etapas chicas, cada una con un objetivo único y comprobable (ver `docs/MIGRATION_PLAN.md`). No mezclar objetivos de etapas distintas en un mismo cambio.

3. **No avanzar sin autorización.** Ninguna etapa siguiente del plan de migración se inicia sin que una persona humana la autorice explícitamente. Terminar una etapa y reportar es obligatorio; continuar a la siguiente no lo es.

4. **No introducir datos mock.** Todo dato de persona, tarea, producto, categoría, evento, configuración o similar debe salir de `index.html` (datos iniciales reales) o ser provisto explícitamente por el usuario. No inventar nombres, cantidades, fechas ni registros de ejemplo para "rellenar" pantallas o pruebas, salvo que se lo pida el usuario y se etiquete como tal.

5. **No eliminar datos reales.** Los datos reales extraídos de `index.html` (documentados en `docs/DATA_INVENTORY.md`) no se descartan. Si un dato parece inconsistente o duplicado, se documenta la duda — no se borra silenciosamente.

6. **No modificar el diseño sin pedido explícito.** El diseño visual actual (paleta de colores, tipografías Fraunces/Karla, layout mobile-first con navegación inferior y sidebar de escritorio, componentes como cards/chips/modales) se preserva al reconstruir el frontend. Cambios visuales requieren solicitud explícita del usuario.

7. **El frontend nunca habla directo con la base de datos.** Toda lectura y escritura de datos pasa por el backend (Express + Prisma). Está prohibido repetir el patrón actual de `index.html` (fetch directo a Supabase con URL y API key embebidas en el cliente).

8. **Cero secretos en el código.** PIN, contraseñas, API keys, tokens o credenciales de cualquier tipo no se hardcodean ni se commitean. Van en variables de entorno (`.env`, no versionado) y se gestionan según `docs/ARCHITECTURE.md` / `docs/SECURITY.md`.

9. **Preservar `index.html` como referencia.** El archivo original no se modifica, mueve ni elimina durante la etapa de documentación ni en las etapas siguientes de reconstrucción, salvo pedido explícito del usuario. Es la fuente de verdad del diseño y comportamiento original.

10. **Validar antes de cerrar una etapa.** Antes de dar por cerrada una etapa: correr las validaciones que correspondan (lint, typecheck, build, tests, revisión manual), confirmar que no se rompió nada de lo ya construido, y confirmar que el alcance ejecutado coincide con el alcance autorizado.

11. **Reportar siempre al cerrar una etapa.** Todo cierre de etapa incluye: archivos creados/modificados, decisiones tomadas (y por qué), validaciones ejecutadas y su resultado, y pendientes u dudas que quedan abiertas para la siguiente etapa.

12. **Dudas se preguntan, no se asumen.** Ante una regla de negocio ambigua, un dato inconsistente, o una decisión de arquitectura no cubierta por `docs/`, preguntar al usuario en vez de asumir. `docs/BUSINESS_RULES.md` y `docs/DATA_INVENTORY.md` marcan explícitamente las dudas detectadas hasta ahora.

## Estado actual

Ver `docs/MIGRATION_PLAN.md` para la etapa vigente. A la fecha de creación de este documento, el proyecto está en la **Etapa 0 — Documentación**, y no se ha escrito código funcional nuevo ni se ha tocado `index.html`.
