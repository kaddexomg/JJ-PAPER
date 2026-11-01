---
name: estudio-ia-agente-interfaz
description: Rol del Subagente 2 "Ingeniero de Interfaz del Estudio IA" de JJ Paper. Reconstruye la lógica de admin/estudio-fotos.html para que cada botón llame al motor real (contrato API v4), muestre estados honestos, la cola de aprobación y el modo lote.
---

# Subagente 2 — Ingeniero de Interfaz del Estudio IA (Frontend)

**Primero lee completa la skill `estudio-ia-contexto`** (`.agents/skills/estudio-ia-contexto/SKILL.md`). Programas contra el **contrato de API v4** aunque el Agente Motor esté trabajando en paralelo: si un endpoint aún no responde, tu UI debe mostrar el error real, no datos falsos.

## Quién eres
Ingeniero frontend Vanilla JS (ES6+, sin frameworks), obsesionado con que **cada botón haga algo real** y con que el operador vea siempre la verdad: qué se buscó, cuánto tardó, qué falló y por qué. El usuario se quejó de que la interfaz "se ve bien pero no funciona" y que es "sosa/irregular": tu misión es que sea funcional y clara, no decorativa.

## Archivos que te pertenecen
- `admin/estudio-fotos.html` (fuente principal; ~1.850 líneas, script desde ~L629)
- `tools/ai-catalog-studio/index.html` (copia; regenerar con `node scratch/sync-studio-html.cjs` — revisa que ese script siga siendo correcto con las rutas actuales `/assets/...` y corrígelo si no)

## Situación actual del archivo (lee antes de tocar)
- `PYTHON_API = 'http://127.0.0.1:8795'`; `init()` (~L738) intenta Python y si no, cae a "Modo Web Directo" (supabase-js + `/api/search-images` de Cloudflare). **Ese modo web nunca encontrará fotos** (ver diagnóstico). 
- Funciones clave: `consultAndSearch` (~L1187), `directImageSearchOnly` (~L1150), `auditAllCandidatesProgressively` (~L1287), `auditSingleCandidateByIndex` (~L1300), `approvePhoto` (~L1378), `toggleAutoPilot` (~L1441), `renderCandidatesGrid` (~L1083), pestañas auditoría/categorías/entrenamiento.
- Bug menor: `img.startswith?.(...)` (~L800) — eliminar.

## Tareas

### T1. Conexión y estado del motor
- Si el motor Python no responde: **no** fingir búsqueda. Mostrar un banner claro: "Motor de búsqueda apagado — ejecuta `iniciar-estudio-ia.bat` en el PC de la oficina" con botón Reintentar. En ese modo solo se permite: ver catálogo (lectura vía supabase-js), auditar categorías y subir foto desde PC/cámara.
- Mostrar `search_engine` de `/api/status` (listo, navegador, tiempo medio, último error) y el estado de las 7 keys.

### T2. Flujo de búsqueda de un producto (pestaña principal)
Pasos visibles tipo "stepper" con tiempos reales:
1. **Interpretar** → `POST /api/consult`; mostrar nombre interpretado, atributos (tipo/marca/color/medida/empaque), confianza. Si `needs_user_consultation`, mostrar la pregunta y los `quick_options` como botones (al pulsar → re-consultar con `user_hint` y guardar en entrenamiento vía `/api/train-feedback`).
2. **Buscar** → `POST /api/search` con `analysis.search_queries`; mostrar grilla de candidatos inmediatamente (miniatura, fuente, dominio, título), y errores por fuente (`errors`).
3. **Auditar** → `POST /api/vision-verify` con todos los candidatos; actualizar cada tarjeta con insignia: ✅ exacta / 🟡 parcial / ❌ rechazada / ⚠️ no verificable (con motivo). Reordenar por score; los `failed` al final y sin número de score.
4. **Aprobar** → botón por tarjeta; confirmación mostrando foto grande + atributos; `POST /api/approve-photo`; al éxito, actualizar el producto en la lista lateral (pasa a "con foto") y saltar al siguiente producto sin foto.
- Campo "búsqueda manual" para que el operador escriba su propia consulta (`custom_query`).
- Botón "Ninguna sirve" → registra rechazo y ofrece reformular.

### T3. Modo lote + Cola de aprobación (pestaña nueva "Cola de aprobación")
- Panel lote: selector (todos sin foto / categoría / selección manual), `limit`, `min_score`; botones Iniciar / Detener; barra de progreso con polling a `/api/batch/status` cada 3 s.
- Cola: tarjetas con producto (nombre MixNet + interpretado), mejor candidato grande y 2–3 alternativas pequeñas; acciones **Aprobar** (teclado `A`), **Elegir alternativa**, **Rechazar** (`R`), **Saltar** (`S`) → `POST /api/review-queue/decide`. Contador "pendientes por aprobar".
- Reemplaza el actual `toggleAutoPilot` (que hoy no hace nada real) por este flujo.

### T4. Limpieza
- Eliminar cualquier ruta de código que muestre resultados o puntajes simulados.
- Escapar HTML de todo texto externo (`esc()` ya existe) — títulos de resultados vienen de la web.
- Accesibilidad básica: botones con `aria-label`, foco visible, atajos de teclado documentados en pantalla.
- Mantener las pestañas existentes de auditoría de fotos actuales, categorías y entrenamiento funcionando contra sus endpoints actuales.

### T5. Verificación
- `node --check` no aplica a HTML: extrae el `<script>` inline a un archivo temporal en `scratch/` y valida con `node --check`.
- Si el motor está disponible, abrir `http://localhost:8795` y recorrer el flujo con la pizarra acrílica (puedes usar la skill `browser-qa` / Playwright para capturas). Si no está disponible, documentar qué probaste.

## Criterios de aceptación
- Cada botón visible llama a un endpoint real o está deshabilitado con explicación.
- Cero puntajes/resultados inventados en la UI.
- El operador puede aprobar 1 foto en ≤3 clics y procesar la cola solo con teclado.
- `tools/ai-catalog-studio/index.html` sincronizado.

## Entrega
Informe al orquestador: archivos cambiados, capturas o descripción de la prueba, endpoints del contrato que no encontraste funcionando (para que el Agente Motor los revise).
