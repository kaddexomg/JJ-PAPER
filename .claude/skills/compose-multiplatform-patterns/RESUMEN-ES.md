---
skill: compose-multiplatform-patterns
idioma_original: en
---

# compose-multiplatform-patterns

Este skill reúne patrones de diseño y buenas prácticas para construir interfaces de usuario compartidas entre Android, iOS, Desktop y Web usando Compose Multiplatform y Jetpack Compose, dentro de proyectos KMP (Kotlin Multiplatform). Se activa cuando se está construyendo UI con Compose, manejando estado con ViewModels, implementando navegación en proyectos KMP o Android, diseñando composables reutilizables o design systems, u optimizando recomposición y rendimiento.

En cuanto a gestión de estado, recomienda usar un único data class por pantalla expuesto como `StateFlow` y consumido en Compose con `collectAsStateWithLifecycle()`, separando composables "stateless" (fáciles de previsualizar y testear) de los que sostienen el ViewModel. Para pantallas complejas propone el patrón "event sink": una interfaz sellada (`sealed interface`) que agrupa todos los eventos posibles en un único método `onEvent`, en lugar de múltiples lambdas de callback sueltas.

Para navegación, muestra el enfoque type-safe de Compose Navigation 2.8+, definiendo rutas como objetos `@Serializable` y usando `composable<Route>` con `toRoute<Route>()` para extraer argumentos. También cubre navegación de diálogos y bottom sheets mediante `dialog()` en vez de mostrar/ocultar de forma imperativa.

Sobre diseño de composables, aconseja usar APIs basadas en "slots" (parámetros `@Composable` para header, content, actions) para dar flexibilidad, y respetar el orden correcto de los modificadores: primero layout (padding, tamaño), luego forma (clip), luego dibujo (background, borde) y por último interacción (clickable).

Para UI específica de plataforma en KMP, documenta el patrón `expect`/`actual`, con ejemplo de una función `PlatformStatusBar` declarada en `commonMain` e implementada de forma distinta en `androidMain` e `iosMain`.

La sección de rendimiento es central: recomienda marcar clases como `@Stable` o `@Immutable` cuando todas sus propiedades son estables para permitir recomposición "skippable"; usar `key()` con claves estables en `LazyColumn`/listas para reutilización de ítems y animaciones; diferir lecturas costosas con `derivedStateOf` (ejemplo: detectar si mostrar un botón "volver arriba" según el scroll); y evitar asignaciones (allocations) innecesarias dentro de la recomposición, mostrando un ejemplo "malo" (crear lista y lambdas nuevas en cada recomposición) versus uno "bueno" (usar `remember` con clave y envolver cada ítem en `key()`).

En theming, da un ejemplo de tema Material 3 con soporte de color dinámico (`dynamicColorScheme`) condicionado a la versión de Android (SDK ≥ S), con fallback a esquemas claro/oscuro estáticos.

Finalmente, enumera anti-patrones a evitar: usar `mutableStateOf` en ViewModels en vez de `MutableStateFlow` con `collectAsStateWithLifecycle` (más seguro respecto al ciclo de vida); pasar el `NavController` en profundidad dentro de composables en lugar de lambdas de callback; hacer cómputo pesado dentro de funciones `@Composable` (debería ir en el ViewModel o en `remember {}`); usar `LaunchedEffect(Unit)` como sustituto de la inicialización del ViewModel (puede re-ejecutarse en cambios de configuración); y crear nuevas instancias de objetos como parámetros de composables, lo que provoca recomposición innecesaria.

El documento cierra remitiendo a otros dos skills relacionados: `android-clean-architecture` para estructura de módulos y capas, y `kotlin-coroutines-flows` para patrones de corrutinas y Flow.
