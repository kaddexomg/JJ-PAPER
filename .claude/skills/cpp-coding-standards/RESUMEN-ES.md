---
skill: cpp-coding-standards
idioma_original: en
---

# cpp-coding-standards

Este skill provee un conjunto exhaustivo de estándares de codificación para C++ moderno (C++17/20/23), basados directamente en las C++ Core Guidelines (isocpp.github.io). Su propósito es guiar la escritura, revisión y refactorización de código C++ para que sea seguro en tipos, seguro en manejo de recursos, inmutable por defecto y claro en su intención. Se usa al escribir clases, funciones o templates nuevos, al revisar o refactorizar código existente, al tomar decisiones arquitectónicas en proyectos C++, para mantener un estilo consistente en un codebase, y para elegir entre alternativas de lenguaje (por ejemplo `enum` vs `enum class`, puntero crudo vs puntero inteligente). Explícitamente NO se recomienda usarlo en proyectos que no son C++, en código C legado que no puede adoptar características modernas, ni en contextos embebidos/bare-metal donde ciertas reglas puedan chocar con restricciones de hardware (en ese caso, adoptar las reglas selectivamente).

El skill se organiza alrededor de seis principios transversales que atraviesan todas las secciones: RAII en todas partes (vincular el tiempo de vida de un recurso al de un objeto), inmutabilidad por defecto (preferir `const`/`constexpr`), seguridad de tipos (usar el sistema de tipos para prevenir errores en compilación), expresar intención (nombres y tipos que comuniquen propósito), minimizar complejidad, y preferir semántica de valor sobre semántica de punteros.

A partir de ahí, cubre en detalle categorías temáticas de las Core Guidelines, cada una con una tabla de reglas clave (con su código, ej. P.10, F.20, C.21), ejemplos de código "DO/DON'T" y una lista de anti-patrones a evitar:

- **Filosofía e interfaces (P.*, I.*)**: expresar intención, tipado fuerte, no usar globales no-const, no transferir ownership por puntero/referencia crudos.
- **Funciones (F.*)**: funciones cortas y de una sola responsabilidad, paso de parámetros (por valor si son baratos, por `const&` si son costosos), preferir devolver valores/structs en vez de parámetros de salida, funciones puras y `constexpr`.
- **Clases y jerarquías (C.*)**: Rule of Zero y Rule of Five, destructores virtuales públicos o no-virtuales protegidos, constructores `explicit` de un argumento, uso correcto de `override`/`final`.
- **Gestión de recursos (R.*)**: RAII, evitar `malloc`/`new`/`delete` explícitos, uso de `unique_ptr`/`shared_ptr` según ownership único o compartido, `make_shared`.
- **Expresiones y sentencias (ES.*)**: inicialización siempre con `{}`, `const`/`constexpr` por defecto, evitar conversiones que pierdan datos, usar `nullptr`, evitar casts estilo C y quitar `const`.
- **Manejo de errores (E.*)**: estrategia de excepciones definida temprano, tipos de excepción propios, lanzar por valor y capturar por referencia, destructores que nunca fallan, no atrapar todo indiscriminadamente.
- **Constantes e inmutabilidad (Con.*)**: objetos y funciones miembro `const` por defecto, `constexpr` para valores calculables en compilación.
- **Concurrencia (CP.*)**: evitar data races, minimizar datos compartidos mutables, RAII para locks (`scoped_lock`, `lock_guard` siempre nombrados), no usar `volatile` para sincronización, no programar lock-free sin necesidad real.
- **Templates y genéricos (T.*)**: usar concepts de C++20 para restringir templates, preferir `using` sobre `typedef`, evitar metaprogramación innecesaria.
- **Biblioteca estándar (SL.*)**: preferir `std::vector`/`std::array` sobre arrays C, `std::string`/`std::string_view` para cadenas, evitar `std::endl` (usar `'\n'`).
- **Enumeraciones (Enum.*)**: preferir `enum class` sobre `enum` plano, evitar macros y ALL_CAPS para enumeradores.
- **Archivos fuente y nomenclatura (SF.*, NL.*)**: guardas de inclusión, headers autocontenidos, no usar `using namespace` a nivel global en headers, estilo de nombres consistente (`underscore_style`), sin notación húngara.
- **Rendimiento (Per.*)**: no optimizar sin medir, favorecer cálculo en tiempo de compilación, acceso a memoria predecible/contiguo sobre estructuras con punteros dispersos.

Cada sección incluye fragmentos de código C++ concretos que ilustran la aplicación correcta e incorrecta de las reglas (por ejemplo, un `Buffer` implementando Rule of Five, un `FileHandle` con RAII, jerarquías de excepciones personalizadas, uso de `std::scoped_lock` para múltiples mutexes, concepts de C++20 como `std::integral`).

Finalmente, el skill cierra con un "Quick Reference Checklist" de verificación previa a dar por terminado un trabajo en C++, con ítems accionables como: no usar `new`/`delete` crudos, inicializar objetos en su declaración, variables `const`/`constexpr` por defecto, funciones miembro `const` cuando sea posible, `enum class` en vez de `enum`, `nullptr` en vez de `0`/`NULL`, evitar conversiones que estrechen el rango, evitar casts estilo C, constructores de un argumento `explicit`, aplicar Rule of Zero o Rule of Five, destructores de clase base correctos, templates restringidos con concepts, sin `using namespace` en headers, headers con guardas de inclusión y autocontenidos, locks con RAII, excepciones propias lanzadas por valor y capturadas por referencia, `'\n'` en vez de `std::endl`, y ausencia de números mágicos.
