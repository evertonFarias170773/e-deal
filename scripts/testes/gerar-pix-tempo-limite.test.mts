/**
 * Emissão de PIX com tempo limite opcional (15/10/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/gerar-pix-tempo-limite.test.mts
 *
 * SEM banco de dados, SEM n8n e SEM banco emissor: cliente Supabase falso e `fetch` falso.
 *   A. sem `timeoutMs` (gerar-pix, pagamento-combinado): a chamada sai igual, sem
 *      `signal`, grava o PIX e devolve o mesmo resultado de antes;
 *   B. sem `timeoutMs` e erro de rede: mesma mensagem crua de antes, sem `tempoEsgotado`;
 *   C. com `timeoutMs` e o n8n mudo (cabeçalho ou corpo): `tempoEsgotado`, nenhuma gravação;
 *   D. com `timeoutMs` e resposta dentro do prazo: grava igual a A e o relógio é desligado;
 *   E. os três chamadores: só a área do cliente passa o limite.
 */
import { registerHooks } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import path from "node:path";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const url = (arquivo: string) => pathToFileURL(path.join(AQUI, arquivo)).href;
registerHooks({
  resolve(especificador, contexto, proximo) {
    if (especificador === "@supabase/supabase-js") return { url: url("_supabase-js-falso-com-tipos.mts"), shortCircuit: true };
    return proximo(especificador, contexto);
  }
});

const { gerarPixBancoInter } = await import("../../src/features/cobrancas/services/banco-inter.service.ts");

let falhas = 0;
function confere(nome: string, ok: boolean, detalhe?: unknown) {
  console.log(`${ok ? "ok    " : "FALHOU"}  ${nome}${ok || detalhe === undefined ? "" : `  -> ${JSON.stringify(detalhe)}`}`);
  if (!ok) falhas++;
}

/** Cliente Supabase falso: registra cada UPDATE em pagamentos_v2. */
function clienteFalso() {
  const gravacoes: Array<Record<string, unknown>> = [];
  const cliente = {
    from(tabela: string) {
      return {
        update(valores: Record<string, unknown>) {
          gravacoes.push({ tabela, ...valores });
          const fim = { data: { id: "cob-1", ...valores }, error: null };
          const cadeia = { eq: () => ({ ...Promise.resolve(fim), then: (r: (v: unknown) => unknown) => Promise.resolve(fim).then(r), select: () => ({ single: async () => fim }) }) };
          return cadeia;
        }
      };
    }
  };
  return { cliente: cliente as never, gravacoes };
}

const PARAMS = {
  cobrancaId: "cob-1",
  idEmpresa: 1,
  seuNumero: "23000",
  valorNominal: 100,
  dataVencimento: "2026-10-18",
  cpfCnpj: "000.000.000-00",
  nome: "Cliente Teste",
  endereco: "Rua A, 1",
  cidade: "Cidade",
  uf: "RS",
  cep: "90000-000"
};
const RESPOSTA_OK = JSON.stringify({ txid: "TX1", pix_copia_e_cola: "000201PIX" });

type Chamada = { url: string; init: RequestInit };
const fetchOriginal = globalThis.fetch;
function fetchFalso(comportamento: (init: RequestInit) => Promise<Response>) {
  const chamadas: Chamada[] = [];
  globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(u), init: init ?? {} });
    return comportamento(init ?? {});
  }) as typeof fetch;
  return chamadas;
}
/** Promessa que só termina quando o sinal aborta (n8n mudo). */
function esperaAteAbortar(init: RequestInit): Promise<never> {
  return new Promise((_, rejeita) => {
    const s = init.signal;
    if (!s) return; // sem sinal: ficaria para sempre — não usado sem limite
    s.addEventListener("abort", () => rejeita(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })));
  });
}

// ── A. sem limite: igual a antes ────────────────────────────────────────────
console.log("== A. sem timeoutMs (gerar-pix, pagamento-combinado)");
{
  const { cliente, gravacoes } = clienteFalso();
  const chamadas = fetchFalso(async () => new Response(RESPOSTA_OK, { status: 200 }));
  const r = await gerarPixBancoInter(cliente, PARAMS);
  confere("uma chamada ao webhook da Ideal", chamadas.length === 1 && chamadas[0].url.endsWith("/webhook/vibe-ideal"), chamadas.map((c) => c.url));
  confere("init sem signal (chamada idêntica à antiga)", !("signal" in chamadas[0].init), Object.keys(chamadas[0].init));
  confere("init com as mesmas três chaves de antes", JSON.stringify(Object.keys(chamadas[0].init)) === JSON.stringify(["method", "headers", "body"]), Object.keys(chamadas[0].init));
  confere("sucesso e PIX gravado", r.success === true && gravacoes.length === 1 && gravacoes[0].pix_copia_cola === "000201PIX", { r, gravacoes });
  confere("sem tempoEsgotado no resultado", !("tempoEsgotado" in r), r);
}

// ── B. sem limite e erro de rede: mesma mensagem de antes ───────────────────
console.log("== B. sem timeoutMs e erro de rede");
{
  const { cliente, gravacoes } = clienteFalso();
  fetchFalso(async () => { throw new TypeError("fetch failed"); });
  const r = await gerarPixBancoInter(cliente, PARAMS);
  confere("falha com a mensagem crua do erro, como antes", r.success === false && r.error === "fetch failed", r);
  confere("sem tempoEsgotado e sem gravação", !r.tempoEsgotado && gravacoes.length === 0, { r, gravacoes });
}

// ── C. com limite e n8n mudo: nada gravado ──────────────────────────────────
console.log("== C. com timeoutMs e o n8n sem responder");
{
  const { cliente, gravacoes } = clienteFalso();
  const chamadas = fetchFalso((init) => esperaAteAbortar(init));
  const inicio = Date.now();
  const r = await gerarPixBancoInter(cliente, PARAMS, { timeoutMs: 150 });
  const levou = Date.now() - inicio;
  confere("init com signal", chamadas[0].init.signal instanceof AbortSignal);
  confere("tempoEsgotado, sem sucesso, sem cobrancaEmitida", r.success === false && r.tempoEsgotado === true && !r.cobrancaEmitida, r);
  confere("nenhuma gravação na cobrança", gravacoes.length === 0, gravacoes);
  confere("uma única chamada (não reemite)", chamadas.length === 1, chamadas.length);
  confere("respondeu perto do limite (150 ms)", levou >= 140 && levou < 2000, levou);
}
{
  // Cabeçalho chega a tempo, corpo não: o limite vale para a resposta inteira.
  const { cliente, gravacoes } = clienteFalso();
  fetchFalso(async (init) => {
    const corpo = new ReadableStream({
      start(ctrl) { init.signal?.addEventListener("abort", () => ctrl.error(Object.assign(new Error("aborted"), { name: "AbortError" }))); }
    });
    return new Response(corpo, { status: 200 });
  });
  const r = await gerarPixBancoInter(cliente, PARAMS, { timeoutMs: 150 });
  confere("corpo preso: tempoEsgotado e nada gravado", r.tempoEsgotado === true && gravacoes.length === 0, { r, gravacoes });
}

// ── D. com limite e resposta a tempo: igual a A ─────────────────────────────
console.log("== D. com timeoutMs e resposta dentro do prazo");
{
  const { cliente, gravacoes } = clienteFalso();
  fetchFalso(async () => new Response(RESPOSTA_OK, { status: 200 }));
  const r = await gerarPixBancoInter(cliente, PARAMS, { timeoutMs: 150 });
  await new Promise((ok) => setTimeout(ok, 250)); // o relógio desligado não aborta nada depois
  confere("sucesso e PIX gravado, como em A", r.success === true && gravacoes.length === 1 && gravacoes[0].pix_copia_cola === "000201PIX", { r, gravacoes });
  confere("sem tempoEsgotado", !r.tempoEsgotado, r);
}

// ── E. quem passa o limite ──────────────────────────────────────────────────
console.log("== E. chamadores");
const RAIZ = path.join(AQUI, "..", "..");
const ler = (p: string) => readFileSync(path.join(RAIZ, p), "utf8");
const chamada = (fonte: string) => {
  const i = fonte.indexOf("gerarPixBancoInter(");
  const fim = fonte.indexOf("});", i);
  return fonte.slice(i, fim + 3);
};
confere("gerar-pix: chamada sem terceiro argumento", !/timeoutMs/.test(chamada(ler("src/app/api/cobrancas/gerar-pix/route.ts"))));
confere("pagamento-combinado: chamada sem terceiro argumento", !/timeoutMs/.test(chamada(ler("src/app/api/cobrancas/pagamento-combinado/route.ts"))));
const area = ler("src/features/area-cliente/services/area-cliente.server.ts");
confere("área do cliente: passa TEMPO_LIMITE_PIX_MS", /\{ timeoutMs: TEMPO_LIMITE_PIX_MS \}/.test(area));
confere("área do cliente: limite de 20 s", /const TEMPO_LIMITE_PIX_MS = 20_000;/.test(area));

globalThis.fetch = fetchOriginal;
console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} FALHA(S)`);
process.exit(falhas === 0 ? 0 : 1);
