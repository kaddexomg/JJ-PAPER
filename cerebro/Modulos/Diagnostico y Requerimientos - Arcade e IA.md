# Diagnóstico y Requerimientos: Banner Arcade e IA Comercial B2B

> Documentado: 31 de Octubre de 2026.
> Referencia operativa para el módulo de correo, marketing y copiloto IA de JJ Paper C.A.

---

## 1. Incidencia: Animación Arcade del Correo Electrónico

### Problemas Detectados:
1. **Bucle con saltos (Loop no continuo):** Al terminar la secuencia actual de cuadros, la animación experimenta un corte visible que rompe la ilusión de desplazamiento fluido.
2. **Dimensiones reducidas:** La barra de 48px deja los personajes en un tamaño de visualización muy reducido (~16px), perdiendo impacto visual.
3. **Falta de definición e identidad de los personajes:** Se requiere un enfoque específico y protagónico a la identidad de JJ Paper.

### Requerimientos de Corrección:
- **Altura recomendada:** Incrementar a **64px** de alto.
- **Los 3 Personajes Oficiales en Pixel Art:**
  1. **Lápiz Corredor:** Grafito afilado, borrador rosado, cuerpo amarillo clásico y zapatillas pixeladas.
  2. **Sacapuntas Saltarín:** Cuerpo prismático metálico/translúcido, cuchilla plateada y animación de rebote dinámico.
  3. **Logo JJ Paper Arcade:** Monograma "JJ" en pixel art neón verde esmeralda y cian con efecto de flotación/propulsión.
- **Bucle Infinito (Seamless Loop):** Calibración matemática exacta de frames (18 a 24 cuadros a 12 FPS) para que el final del ciclo empalme con el inicio sin ningún salto o parpadeo.

---

## 2. Incidencia: Brecha en las Respuestas Automáticas de la IA

### Problema Detectado:
Actualmente, las respuestas automáticas generadas por la IA del sistema se emiten en **texto plano y pasivo**, sin aplicar la fuerza comercial B2B de JJ Paper:
- No hacen preguntas de calificación al cliente.
- No invitan a utilizar el **Catálogo Interactivo** para cotizar en línea.
- No destacan los beneficios diferenciales:
  - Precios directos por bulto cerrado de importador.
  - Factura fiscal SENIAT calculada a la **Tasa Oficial BCV**.
  - Procura Abierta ("le conseguimos cualquier artículo o maquinaria aunque no esté en lista").

### Requerimiento de Configuración:
Ajustar los prompts de IA (`inbound-agent.js` / `email.js`) para que cada respuesta contenga de forma obligatoria la siguiente estructura:

1. **Apertura empática y personalizada** (sin sonar a bot).
2. **Propuesta de valor comercial** (Tasa BCV, bulto cerrado, entrega rápida en Caracas/nacional).
3. **Llamado de acción al Catálogo Interactivo** con enlace directo para armar cotización en tiempo real.
4. **Cláusula de Procura Abierta** para productos o maquinarias especiales fuera de lista.
5. **Pregunta de cierre B2B adaptada al tipo de cliente**:
   - *Comercios / Revendedores:* Indagar sobre los productos de mayor rotación de mostrador para cotizar margen por bulto.
   - *Empresas / Clínicas / Industrias:* Indagar sobre los insumos de mayor concurrencia operativa para enviar cotización comparativa a Tasa BCV.
