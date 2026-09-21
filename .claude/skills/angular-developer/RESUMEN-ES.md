---
skill: angular-developer
idioma_original: en
---

# angular-developer

Este skill genera código Angular y ofrece guía arquitectónica para todo tipo de trabajo dentro de un proyecto Angular. Se activa al crear o generar proyectos, componentes, servicios, directivas, pipes, guards o resolvers, así como al trabajar con reactividad (Signals, `linkedSignal`, `resource`), formularios, inyección de dependencias, routing, SSR, accesibilidad (ARIA), animaciones, estilos (incluyendo Tailwind CSS), testing o herramientas de la CLI de Angular.

Principios de funcionamiento clave:
1. Siempre hay que analizar primero la versión de Angular del proyecto, ya que las mejores prácticas y funcionalidades disponibles varían mucho entre versiones. Al crear un proyecto nuevo con la CLI no debe fijarse una versión salvo que el usuario la pida explícitamente.
2. El código generado debe seguir la guía de estilo oficial de Angular y usar la Angular CLI para scaffolding de componentes, servicios, directivas, pipes y rutas, buscando consistencia.
3. Tras generar código es obligatorio correr `ng build` para verificar que no haya errores de compilación, y corregirlos antes de continuar; este paso no puede omitirse.

Para creación de proyectos nuevos, si el usuario no da lineamientos propios, se usa por defecto la última versión estable de Angular, y se prefieren los Signal Forms (si la versión los soporta). Define reglas estrictas de ejecución para `ng new` según el caso:
- Si el usuario pide una versión específica: usar `npx @angular/cli@<version> new <proyecto>`.
- Si no se pide versión y hay CLI instalada localmente (verificable con `ng version`): usar `ng new <proyecto>`.
- Si no se pide versión y no hay CLI instalada: usar `npx @angular/cli@latest new <proyecto>`.

El skill organiza su conocimiento en referencias temáticas (archivos en `references/`) que hay que consultar según la tarea:
- **Componentes**: fundamentos (anatomía, metadata, control de flujo @if/@for/@switch), inputs basados en signals, outputs basados en signals, y host elements/bindings. Si falta profundidad, remite a la documentación oficial en angular.dev/guide/components.
- **Reactividad**: signals (`signal`, `computed`, contextos reactivos, `untracked`), `linkedSignal` para estado derivado editable, `resource` para datos asíncronos, y `effect` (con criterios de cuándo NO usarlo).
- **Formularios**: en general se prefieren los Signal Forms para apps nuevas si la versión lo soporta; para formularios existentes o apps más viejas hay que respetar la estrategia ya usada (template-driven o reactive forms).
- **Inyección de dependencias**: fundamentos e `inject()`, creación de servicios y `providedIn: 'root'`, definición de providers (`useClass`, `useValue`, `useFactory`, `InjectionToken`), contexto de inyección (`runInInjectionContext`), e inyectores jerárquicos (`EnvironmentInjector` vs `ElementInjector`, `providers` vs `viewProviders`).
- **Angular Aria**: para construir componentes accesibles headless tipo Accordion, Listbox, Combobox, Menu, Tabs, Toolbar, Tree, Grid.
- **Routing**: definición de rutas, estrategias de carga (eager/lazy), router-outlet, navegación declarativa/programática, guards de acceso, resolvers de datos, ciclo de vida del router, estrategias de renderizado (CSR/SSG/SSR con hidratación) y animaciones de transición de rutas (View Transitions API).
- **Estilos y animaciones**: integración de Tailwind CSS, animaciones nativas con CSS (recomendado) o el DSL legacy, y buenas prácticas de encapsulación de estilos por componente.
- **Testing**: fundamentos con `TestBed` y patrones async, component harnesses, testing de router con `RouterTestingHarness`, y testing E2E con Cypress o Playwright.
- **Tooling**: uso de la Angular CLI (crear apps, generar código, servir, compilar) y del servidor MCP de Angular (herramientas disponibles, configuración, features experimentales).

El documento también lista anti-patrones explícitos a evitar: usar `null`/`undefined` como valor inicial en campos de signal forms (usar `''`, `0` o `[]`); acceder a flags de estado de un campo sin invocarlo primero (`form.field.valid()` es incorrecto, debe ser `form.field().valid()`); iniciar formularios nuevos con APIs viejas cuando la versión soporta Signal Forms; fijar atributos HTML como `min`, `max`, `value`, `disabled` o `readonly` directamente en inputs `[formField]` en vez de definirlos como reglas de schema; llamar a `inject()` fuera de un contexto de inyección; usar `effect()` para estado derivado que debería resolverse con `computed()`; y referenciar `$parent.$index` en `@for` anidados (Angular no soporta `$parent`, hay que usar `let outerIdx = $index`).

Finalmente, señala skills relacionados con los que se complementa: `tdd-workflow` (flujo de desarrollo guiado por tests aplicable a componentes/servicios Angular), `security-review` (checklist de seguridad para apps web, incluyendo aspectos específicos de Angular), y `frontend-patterns` (patrones generales de frontend, útil como contexto sobre enfoques React/Next.js).
