---
skill: csharp-testing
idioma_original: en
---

# csharp-testing

Este skill reúne patrones y buenas prácticas para escribir tests en aplicaciones C#/.NET, usando xUnit como framework principal, FluentAssertions para aserciones legibles, y herramientas complementarias de mocking e infraestructura de pruebas. Sirve tanto para escribir tests nuevos como para revisar la calidad de tests existentes.

Se activa cuando: se están escribiendo tests nuevos para código C#, se revisa calidad o cobertura de tests, se configura infraestructura de testing en un proyecto .NET, o se depuran tests inestables (flaky) o lentos.

Stack de herramientas recomendado: xUnit (framework de test preferido), FluentAssertions (sintaxis de aserciones), NSubstitute o Moq (mocking de dependencias), Testcontainers (infraestructura real en tests de integración, por ejemplo levantar un Postgres real en Docker), WebApplicationFactory (tests de integración de ASP.NET Core) y Bogus (generación de datos de prueba realistas).

Estructura de test unitario: sigue el patrón Arrange-Act-Assert, con el "system under test" (_sut) creado en el constructor de la clase de test (xUnit crea una instancia nueva por test, lo que da aislamiento automático). Los mocks se crean con Substitute.For<T>(). Para casos parametrizados se usa [Theory] con [InlineData] (valores literales) o [MemberData] apuntando a una propiedad estática de tipo TheoryData<T1,T2> que enumera casos inválidos o variantes.

Mocking con NSubstitute: se configuran retornos con `.Returns(...)` sobre llamadas a métodos del mock, y se verifican invocaciones con `.Received(1).Metodo(Arg.Is<T>(...), Arg.Any<CancellationToken>())`.

Tests de integración ASP.NET Core: se usa IClassFixture<WebApplicationFactory<Program>> para levantar la app en memoria; dentro de ConfigureServices se reemplaza el DbContext real por una base de datos en memoria (UseInMemoryDatabase) antes de crear el HttpClient. Los tests hacen requests HTTP reales contra la app y verifican status codes (404, 201, headers como Location).

Tests con Testcontainers: para pruebas de repositorio contra una base real, se implementa IAsyncLifetime, se levanta un contenedor (ej. PostgreSqlBuilder con imagen postgres:16-alpine) en InitializeAsync, se aplican migraciones, y se libera todo (DisposeAsync) al finalizar, garantizando aislamiento e infraestructura real en vez de mocks de base de datos.

Organización de tests: se recomienda separar proyectos por tipo — MyApp.UnitTests (organizado por carpetas Services/, Validators/), MyApp.IntegrationTests (Api/, Repositories/) y MyApp.TestHelpers (Builders/, Fixtures/) para código compartido de soporte.

Test Data Builders: patrón builder fluido (ej. OrderBuilder con métodos WithCustomer, WithItem que devuelven `this`, y Build() final) para construir objetos de prueba complejos de forma legible y reutilizable, evitando duplicar construcción de datos en cada test.

Antipatrones comunes documentados y su corrección: testear detalles de implementación en vez de comportamiento; estado mutable compartido entre tests (se soluciona con instancia fresca por test, que xUnit ya provee vía constructor); usar Thread.Sleep en tests async (usar Task.Delay con timeout o polling); asertar sobre la salida de ToString() en vez de propiedades tipadas; tests con una sola aserción gigante en vez de una aserción lógica por test; nombres de test que describen implementación en vez de comportamiento (convención recomendada: Method_ExpectedResult_WhenCondition); e ignorar el CancellationToken (siempre debe pasarse y, cuando corresponda, verificarse).

Comandos para ejecutar tests (dotnet CLI): `dotnet test` para correr todos los tests; `dotnet test --collect:"XPlat Code Coverage"` para generar cobertura; `dotnet test tests/MyApp.UnitTests/` para correr un proyecto específico; `dotnet test --filter "FullyQualifiedName~OrderService"` para filtrar por nombre; y `dotnet watch test --project tests/MyApp.UnitTests/` para modo watch durante desarrollo activo.
