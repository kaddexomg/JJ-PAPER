---
skill: bun-runtime
idioma_original: en
---

# bun-runtime

Este skill documenta el uso de Bun, un runtime de JavaScript/TypeScript todo-en-uno (rápido) que funciona simultáneamente como runtime de ejecución, gestor de paquetes, bundler y test runner. Sirve como guía de referencia para decidir cuándo conviene usar Bun en vez de Node, cómo migrar proyectos existentes de Node a Bun, y cómo configurar Bun en plataformas de despliegue como Vercel.

Cuándo conviene usarlo: se recomienda Bun para proyectos nuevos de JS/TS, para escenarios donde la velocidad de instalación y ejecución es importante, para despliegues en Vercel configurados con runtime Bun, y en general cuando se busca un único toolchain que cubra ejecución, instalación de dependencias, testing y build sin combinar herramientas distintas. En cambio, se recomienda Node cuando se necesita máxima compatibilidad con el ecosistema, cuando se trabaja con tooling legacy que asume Node, o cuando alguna dependencia específica tiene problemas conocidos de compatibilidad con Bun. El skill se dispara en contextos de adopción de Bun, migración desde Node, escritura o depuración de scripts/tests en Bun, o configuración de Bun en Vercel u otras plataformas.

En cuanto al funcionamiento interno, el documento describe los cuatro componentes de Bun:
- **Runtime**: es compatible "drop-in" con Node (es decir, puede reemplazarlo directamente en la mayoría de los casos), está construido sobre el motor JavaScriptCore y su implementación está escrita en Zig.
- **Gestor de paquetes**: `bun install` es notablemente más rápido que npm o yarn. Genera un lockfile llamado `bun.lock` (en formato texto) en las versiones actuales de Bun; versiones más antiguas usaban `bun.lockb` (formato binario).
- **Bundler**: incluye un bundler y transpilador integrado, útil tanto para aplicaciones como para librerías.
- **Test runner**: incorpora `bun test`, con una API similar a la de Jest, lo que facilita la migración de suites de test existentes.

Para migrar desde Node, el skill indica reemplazar `node script.js` por `bun run script.js` o directamente `bun script.js`. La instalación de dependencias con `npm install` se reemplaza por `bun install`, y la mayoría de los paquetes de npm funcionan sin cambios. Para ejecutar scripts definidos en package.json se usa `bun run`, y para ejecuciones puntuales al estilo npx se usa `bun x`. Los módulos built-in de Node siguen siendo soportados, pero se recomienda preferir las APIs nativas de Bun cuando existan, ya que suelen ofrecer mejor rendimiento.

Para despliegues en Vercel, hay que configurar el runtime como Bun en la configuración del proyecto. El comando de build puede ser `bun run build` o `bun build ./src/index.ts --outdir=dist`, y para instalar dependencias de forma reproducible en el pipeline de deploy se recomienda `bun install --frozen-lockfile`.

El skill incluye ejemplos de código breves que cubren: instalación y ejecución (`bun install`, `bun run dev`, `bun run src/index.ts`, `bun src/index.ts`); manejo de variables de entorno y scripts (`bun run --env-file=.env dev`, `FOO=bar bun run script.ts`); testing (`bun test`, `bun test --watch`, junto con un ejemplo de test usando `import { expect, test } from "bun:test"`); y uso de la API nativa del runtime, mostrando `Bun.file()` para leer archivos (por ejemplo `package.json` como JSON) y `Bun.serve()` para levantar un servidor HTTP simple respondiendo "Hello" en el puerto 3000.

Finalmente, como buenas prácticas el skill recomienda: siempre commitear el lockfile (`bun.lock` o `bun.lockb`) para garantizar instalaciones reproducibles entre entornos; preferir `bun run` para ejecutar scripts, aprovechando que Bun ejecuta archivos `.ts` de forma nativa sin necesidad de transpilación previa; y mantener las dependencias actualizadas, dado que tanto Bun como su ecosistema evolucionan con rapidez.
