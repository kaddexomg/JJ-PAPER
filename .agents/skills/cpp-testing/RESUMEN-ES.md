---
skill: cpp-testing
idioma_original: en
---

# cpp-testing

Este skill ofrece un flujo de trabajo orientado a agentes para testing en C++ moderno (C++17/20), basado en GoogleTest/GoogleMock combinado con CMake/CTest. Su propósito es guiar la escritura, actualización y depuración de tests C++, la configuración de la infraestructura de pruebas, y la incorporación de cobertura y sanitizers.

Se debe usar cuando se escriben tests nuevos o se corrigen existentes, al diseñar cobertura de tests unitarios/integración, al agregar protección de regresión o gating de CI, al configurar flujos CMake/CTest, al investigar fallos o comportamiento inestable (flaky), o al habilitar sanitizers para diagnóstico de memoria/carreras. NO debe usarse para implementar features de producto sin cambios de tests, refactors grandes no relacionados con tests, tuning de performance sin regresiones que validar, ni en proyectos que no sean C++ o tareas no vinculadas a testing.

Conceptos clave: el loop TDD (rojo → verde → refactor: primero un test que falla, luego el fix mínimo, luego limpieza); aislamiento mediante inyección de dependencias y fakes en vez de estado global; estructura de carpetas típica `tests/unit`, `tests/integration`, `tests/testdata`; distinción entre mocks (para verificar interacciones) y fakes (para comportamiento con estado); uso de `gtest_discover_tests()` para descubrimiento estable de tests en CTest; y como señal de CI, correr primero un subconjunto y luego la suite completa con `--output-on-failure`.

El documento incluye ejemplos de código: un test unitario básico con gtest, un fixture con `SetUp()` usando `TEST_F`, y un mock con gmock (`MOCK_METHOD`, `EXPECT_CALL`) para verificar que un servicio invoque correctamente a un notificador. También muestra un CMakeLists.txt de ejemplo que usa `FetchContent` para traer GoogleTest, habilita testing con `enable_testing()` y usa `gtest_discover_tests`, junto con los comandos típicos `cmake -S . -B build`, `cmake --build build -j` y `ctest --test-dir build --output-on-failure`.

Para ejecutar tests puntuales se documentan filtros con CTest (`ctest -R NombreTest`) y con el binario de gtest directamente (`--gtest_filter=...`). Para depurar fallos, el flujo sugerido es: reproducir el test único con el filtro, agregar logging acotado cerca del assert que falla, re-ejecutar con sanitizers activados, y finalmente correr la suite completa una vez resuelta la causa raíz.

En cobertura, recomienda flags a nivel de target (no globales), mostrando un option `ENABLE_COVERAGE` en CMake con flags distintos para GCC (`--coverage`) y Clang (`-fprofile-instr-generate -fcoverage-mapping`), y da los pasos completos para generar reportes con GCC+gcov+lcov+genhtml y con Clang+llvm-profdata+llvm-cov.

Para sanitizers, define opciones CMake independientes `ENABLE_ASAN`, `ENABLE_UBSAN` y `ENABLE_TSAN`, cada una agregando los flags de compilación y enlace correspondientes (AddressSanitizer, UndefinedBehaviorSanitizer, ThreadSanitizer).

En cuanto a tests flaky, las salvaguardas indicadas son: nunca usar `sleep` para sincronización (usar condition variables o latches), generar directorios temporales únicos por test y limpiarlos siempre, evitar dependencias de tiempo real, red o filesystem en tests unitarios, y usar semillas deterministas para entradas aleatorias.

Las buenas prácticas (DO) incluyen mantener tests deterministas e aislados, preferir inyección de dependencias sobre globals, usar `ASSERT_*` para precondiciones y `EXPECT_*` para múltiples chequeos, separar tests unitarios de integración (por labels o directorios en CTest), y correr sanitizers en CI. Entre lo que evitar (DON'T): depender de tiempo real o red, usar sleeps como sincronización, sobre-mockear objetos de valor simples, y usar matching de strings frágil en logs no críticos. También lista errores comunes (pitfalls) como rutas temp fijas, dependencia del reloj de pared, tests de concurrencia flaky, estado global oculto, over-mocking, y falta de corridas con sanitizers o cobertura inconsistente entre builds debug/release.

Como apéndice opcional, cubre fuzzing/property testing (solo si el proyecto ya soporta LLVM/libFuzzer o una librería de property testing), mencionando libFuzzer para funciones puras con I/O mínimo y RapidCheck para validar invariantes, con un harness mínimo de ejemplo. Cierra listando alternativas a GoogleTest: Catch2 (header-only, matchers expresivos) y doctest (liviano, bajo overhead de compilación).
