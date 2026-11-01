---
name: estudio-ia-orquestador
description: Runbook para el agente principal que coordina a los 3 subagentes del Estudio IA de Fotos de JJ Paper (Motor, Interfaz, Integración). Usar cuando el usuario pida "ejecutar el plan del estudio IA" o "lanzar los subagentes del estudio".
---

# Orquestador — Plan Estudio IA de Fotos v4

## Antes de lanzar
1. Lee `estudio-ia-contexto` completo.
2. Confirma con el usuario (si no lo ha hecho ya):
   - Autorización para la **subida de prueba** `_diag_test_<ts>.webp` al Storage del VPS (se borra después).
   - Que **no** se aprueba/publica ninguna foto real sin su clic.
3. `git status` y anota los cambios sin commit previos (de la sesión del 31-10: `assets/js/product-detail.js`, `functions/api/search-images.js`, `tools/ai-catalog-studio/*`). No los descartes.

## Lanzamiento (Fase 1 en paralelo)
Lanza con `invoke_subagent` (TypeName `self`, Workspace `inherit` — trabajan sobre archivos distintos):

| Subagente | Rol (Role) | Prompt |
|---|---|---|
| 1 | `Motor Busqueda Vision` | "Eres el Subagente 1 del Estudio IA de JJ Paper. Lee y sigue al pie de la letra `.agents/skills/estudio-ia-contexto/SKILL.md` y luego `.agents/skills/estudio-ia-agente-motor/SKILL.md`. Edita solo tus archivos asignados. Al terminar, envíame el informe de entrega." |
| 2 | `Interfaz Estudio IA` | Igual, con `estudio-ia-agente-interfaz/SKILL.md`. |
| 3 | `Integracion QR LAN` | Igual, con `estudio-ia-agente-integracion/SKILL.md`, indicando: "Haz T1–T3 ahora; espera mi mensaje para T4 (E2E)". |

## Coordinación
- Si Interfaz o Integración reportan un endpoint que no cumple el contrato, reenvía el detalle al Subagente 1 con `send_message`.
- Cuando el Subagente 1 entregue, avisa a los otros dos que el motor está listo para probar contra él.
- Cuando 1 y 2 terminen, envía al Subagente 3: "Ejecuta T4 (E2E) ahora".
- Conflicto de archivo: el dueño es quien figura en "Archivos que te pertenecen"; los demás piden el cambio.

## Cierre
1. Revisa el informe E2E (`scratch/e2e_estudio_ia_resultado.md`) y verifica tú mismo 1 caso (pizarra acrílica) antes de declarar éxito.
2. `python -m py_compile` y `node --check` de todo lo tocado.
3. Presenta al usuario: qué funciona ahora, evidencia, pasos manuales (arrancar `iniciar-estudio-ia.bat`, reiniciar wa-server con `start-hidden.vbs`, desplegar `bash build.sh` + `git push origin main` **solo con su permiso**).
4. Propón commit con mensaje convencional (`feat(estudio-ia): motor de búsqueda con navegador real ...`) y espera aprobación.
