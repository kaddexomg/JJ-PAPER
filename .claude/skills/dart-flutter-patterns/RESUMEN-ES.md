---
skill: dart-flutter-patterns
idioma_original: en
---

# dart-flutter-patterns

Este skill provee patrones de código Dart y Flutter listos para producción, pensados para copiar y pegar, cubriendo desde null safety hasta arquitectura limpia. Sirve como referencia práctica al escribir o revisar código Flutter, sin atarse a una única librería (aunque cubre explícitamente las más usadas del ecosistema).

Conviene usarlo cuando: se inicia una nueva feature de Flutter y hace falta un patrón idiomático de gestión de estado, navegación o acceso a datos; se está revisando o escribiendo código Dart y surgen dudas sobre null safety, sealed classes o composición async; se arranca un proyecto nuevo y hay que elegir entre BLoC, Riverpod o Provider; se implementan clientes HTTP seguros, integración de WebView o almacenamiento local; se escriben tests de widgets, Cubits o providers de Riverpod; o se configura GoRouter con guards de autenticación.

El contenido está organizado en bloques temáticos, cada uno con ejemplos de código concretos (BAD vs GOOD):

1. **Null safety**: evitar el operador `!` (bang) que puede provocar crashes en runtime, preferir `?.`/`??` o pattern matching de Dart 3, usar guard clauses con retorno temprano, y evitar el abuso de `late` (solo usarlo cuando la inicialización está garantizada antes del primer acceso, como en `initState()`).

2. **Estado inmutable**: uso de sealed classes para jerarquías de estado (permiten switches exhaustivos verificados por el compilador) y de Freezed para generar clases inmutables sin boilerplate, con `copyWith`, `toJson`/`fromJson`.

3. **Composición async**: concurrencia estructurada con `Future.wait` y destructuring de records de Dart 3 para evitar awaits secuenciales innecesarios; patrones con `StreamBuilder` para datos reactivos; y una regla crítica: siempre verificar `mounted` después de un `await` dentro de un `StatefulWidget` antes de usar el `BuildContext`, para evitar errores cuando el widget ya fue desmontado.

4. **Arquitectura de widgets**: extraer partes de la UI a clases separadas en vez de métodos privados que devuelven Widget (esto habilita `const` y reuso de elementos); propagar `const` para evitar reconstrucciones innecesarias; y aislar los rebuilds a la porción mínima del árbol que realmente cambia (scoped rebuilds), dejando el resto de la UI como `const`.

5. **Gestión de estado con BLoC/Cubit**: ejemplo de un `Cubit` de autenticación con estados sellados (loading, authenticated, error) y su consumo con `BlocBuilder` usando pattern matching.

6. **Gestión de estado con Riverpod**: providers async con auto-dispose, un `Notifier` con mutaciones complejas (agregar/quitar items de un carrito), y providers derivados (patrón selector) como `cartCount` y `cartTotal`, usando `firstWhereOrNull` del paquete `collection` para evitar `StateError`.

7. **Navegación con GoRouter**: configuración con `refreshListenable` (reevalúa el redirect cuando cambia el estado de auth), lógica de `redirect` para proteger rutas según login, y uso de `ShellRoute` para layouts persistentes.

8. **Networking con Dio**: configuración base con timeouts, interceptor de autenticación que inyecta el token desde secure storage, y un interceptor de manejo de errores que reintenta una sola vez tras un 401 (usando una bandera `_isRetry` en `extra` para evitar loops infinitos de refresh de token).

9. **Arquitectura de manejo de errores**: captura global de errores Flutter (`FlutterError.onError`) y de la plataforma (`PlatformDispatcher.instance.onError`) configurada en `main()`, integración con Crashlytics, y un `ErrorWidget.builder` personalizado para producción.

10. **Testing**: ejemplos rápidos de test unitario de un use case, test de BLoC con `blocTest` (verificando la secuencia de estados emitidos), y test de widget con `ProviderScope` y overrides de providers, prefiriendo fakes por sobre mocks.

Al final el documento incluye una sección de referencias externas (Effective Dart, Flutter Performance Best Practices, documentación de Riverpod, BLoC, GoRouter y Freezed) y remite a dos recursos complementarios dentro del propio ecosistema de skills: el skill `flutter-dart-code-review` para una checklist de revisión más exhaustiva, y las reglas en `rules/dart/` (estilo de código, patrones, seguridad, testing y hooks).
