---
skill: android-clean-architecture
idioma_original: en
---

# android-clean-architecture

Este skill provee patrones de Clean Architecture para proyectos Android y Kotlin Multiplatform (KMP). Su objetivo es guiar la estructura de módulos, las reglas de dependencia entre capas, y el diseño de UseCases, Repositories y la capa de datos, cubriendo tecnologías como Room, SQLDelight, Ktor, Koin y Hilt.

Se activa cuando se está estructurando un proyecto Android o KMP en módulos, al implementar UseCases, Repositories o DataSources, al diseñar el flujo de datos entre las capas dominio/datos/presentación, al configurar inyección de dependencias con Koin o Hilt, o al trabajar con Room, SQLDelight o Ktor dentro de una arquitectura en capas.

**Estructura de módulos recomendada**: app (punto de entrada, wiring de DI), core (utilidades compartidas, clases base, tipos de error), domain (UseCases, modelos de dominio, interfaces de repositorio, en Kotlin puro), data (implementaciones de repositorio, DataSources, DB, red), presentation (pantallas, ViewModels, navegación), design-system (componentes Compose reutilizables) y feature (módulos por feature, opcional). La regla de dependencias es estricta: app depende de presentation/domain/data/core; presentation depende de domain/design-system/core; data depende de domain/core; domain solo depende de core (o de nada); core no depende de nada. La regla crítica es que domain NUNCA debe depender de data, presentation ni de ningún framework — debe ser Kotlin puro.

**Capa de dominio**: cada UseCase representa una única operación de negocio, implementado con `operator fun invoke` para tener un call-site limpio (soporta versiones suspend y basadas en Flow para streams reactivos). Los modelos de dominio son data classes de Kotlin plano, sin anotaciones de framework. Las interfaces de Repository se definen en domain y se implementan en data.

**Capa de datos**: las implementaciones de Repository coordinan entre datasources locales y remotos (patrón típico: traer del remoto, insertar en local, devolver desde local). Se recomienda el patrón Mapper como extension functions cercanas a los modelos de datos (`toDomain()`, `toEntity()`). Incluye ejemplos concretos de Room (Entity + Dao con @Query, @Upsert, Flow) para Android, SQLDelight (archivo .sq con CREATE TABLE y queries) para KMP, y un cliente Ktor (HttpClient con ContentNegotiation y Logging) también para KMP.

**Inyección de dependencias**: se muestran ejemplos con Koin (recomendado para KMP, usando módulos domain/data/presentation con factory, single y viewModelOf) y con Hilt (solo Android, usando @Module, @InstallIn, @Binds y @HiltViewModel).

**Manejo de errores**: recomienda usar `Result<T>` o un tipo sellado propio (ejemplo: interfaz `Try<T>` con Success/Failure y un `AppError` sellado con variantes Network, Database, Unauthorized) para propagar errores, mapeándolos a estado de UI dentro del ViewModel.

**Convention Plugins de Gradle**: para proyectos KMP se recomienda usar convention plugins (por ejemplo un plugin `kmp-library` en `build-logic`) para reducir la duplicación de configuración de build entre módulos.

**Anti-patrones a evitar**: importar clases del framework Android dentro de `domain`; exponer entidades de base de datos o DTOs directamente a la capa de UI (siempre mapear a modelos de dominio); poner lógica de negocio en los ViewModels en vez de extraerla a UseCases; usar `GlobalScope` o coroutines no estructuradas en lugar de `viewModelScope` o concurrencia estructurada; repositorios "gordos" que deberían dividirse en DataSources más enfocados; y dependencias circulares entre módulos (si A depende de B, B no debe depender de A).

El skill referencia otros dos skills relacionados: `compose-multiplatform-patterns` para patrones de UI, y `kotlin-coroutines-flows` para patrones asíncronos.
