/**
 * Resolvedor de imports para os testes que rodam direto pelo Node
 * (`node --experimental-strip-types`), sem bundler.
 *
 * POR QUE EXISTE
 *   O padrão dos testes deste diretório só funcionava para módulos que não
 *   importam nada (ver faturado-editavel.test.mts). Assim que o módulo sob teste
 *   tem um `import`, o Node esbarra em duas coisas que o bundler do Next resolve
 *   sozinho e ele não: o alias `@/` do tsconfig e os caminhos relativos sem
 *   extensão. Este hook cobre exatamente esses dois casos e nada mais — não
 *   transforma código, não lê tsconfig, não substitui o build.
 *
 * USO
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/<arquivo>.test.mts
 *
 * AS SUITES ENCERRAM COM `process.exitCode`, NUNCA COM `process.exit()`
 *   No Windows, `process.exit()` derruba o loop enquanto um handle assincrono do
 *   carregador de modulos ainda esta fechando, e a libuv aborta o processo
 *   ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c").
 *   O abort acontece DEPOIS de a suite imprimir que passou, entao a saida fica
 *   perfeita e o codigo de retorno vira 127 — falha invisivel em qualquer script
 *   que dependa do exit code. Medido em 19/08/2026 na frete-desatualizado: 9 de
 *   10 execucoes abortavam; trocando por `process.exitCode`, 10 de 10 limpas.
 *   Este hook agrava a corrida (sem ele era 1 em 10), mas nao e a causa.
 *   Excecao legitima: `process.exit()` usado como fluxo de controle para ABORTAR
 *   no meio do arquivo (ver fob-gravacao.test.mts) — ali `exitCode` nao
 *   interromperia a execucao.
 */
import { registerHooks } from "node:module";
import { existsSync, statSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Primeiro candidato que existe como ARQUIVO (diretório não conta). */
function primeiroArquivo(base) {
  const candidatos = [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, path.join(base, "index.ts")];
  for (const c of candidatos) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador.startsWith("@/")) {
      const achado = primeiroArquivo(path.join(RAIZ, "src", especificador.slice(2)));
      if (achado) return { url: pathToFileURL(achado).href, shortCircuit: true };
    }
    if (especificador.startsWith(".") && contexto.parentURL?.startsWith("file:")) {
      const base = path.resolve(path.dirname(fileURLToPath(contexto.parentURL)), especificador);
      const achado = primeiroArquivo(base);
      if (achado) return { url: pathToFileURL(achado).href, shortCircuit: true };
    }
    return proximo(especificador, contexto);
  }
});
