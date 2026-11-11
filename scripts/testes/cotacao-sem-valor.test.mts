/**
 * Cotação sem valor não vira card (11/11/2026, caso 25058).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs scripts/testes/cotacao-sem-valor.test.mts
 *
 * Prova, sem chamar nenhuma API:
 *   1. SEDEX: a resposta do 25058 (item sem servico, valor e prazo) e a lista
 *      vazia não viram card e lançam CotacaoSemValorError; a resposta normal
 *      vira os mesmos cards de antes; PAC sem valor ao lado do SEDEX sai sozinho.
 *   2. Azul: serviço com Total vazio ou zero não vira card; os outros ficam.
 *   3. O aviso diz qual fonte não cotou; "não atende" não é aviso.
 *   4. As três portas de cotação da tela gravam o aviso, e ele aparece na aba.
 */
import { readFileSync } from "node:fs";
import { cardsDaRespostaSedex } from "../../src/features/orcamentos/lib/cotacao-sedex.ts";
import { mapearCotacoesAzul, planejarCotacaoAzul } from "../../src/features/orcamentos/lib/cotacao-azul.ts";
import {
  CotacaoSemValorError,
  fontesQueNaoCotaram,
  valorCotadoValido,
  veppoDeviaTerCotado
} from "../../src/features/orcamentos/lib/cotacao-sem-valor.ts";

let falhas = 0;
function checar(nome: string, real: unknown, esperado: unknown) {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) {
    falhas += 1;
    console.log(`FALHOU  ${nome}\n  esperado: ${JSON.stringify(esperado)}\n  real:     ${JSON.stringify(real)}`);
  } else {
    console.log(`ok      ${nome}`);
  }
}
function erroDe(fn: () => unknown): unknown {
  try {
    fn();
    return null;
  } catch (e) {
    return e;
  }
}
const silencio = console.warn;
console.warn = () => {};

// ── 1. SEDEX ──
const entrada = { peso: 2713.5, id_int: 25058, volumes: 1 };
const erro25058 = erroDe(() => cardsDaRespostaSedex({}, entrada));
checar("25058: resposta sem servico/valor/prazo nao vira card (CotacaoSemValorError)", erro25058 instanceof CotacaoSemValorError, true);
checar("25058: mensagem", (erro25058 as Error)?.message, "SEDEX respondeu sem valor.");
checar("SEDEX valor 0 explicito nao vira card", erroDe(() => cardsDaRespostaSedex([{ servico: "SEDEX", valor: 0, prazo: 3 }], entrada)) instanceof CotacaoSemValorError, true);
checar("SEDEX lista vazia nao vira card", erroDe(() => cardsDaRespostaSedex([], entrada)) instanceof CotacaoSemValorError, true);
checar("SEDEX corpo invalido continua erro comum", (erroDe(() => cardsDaRespostaSedex("x", entrada)) as Error)?.message, "Resposta inválida do serviço de frete.");

const normal = cardsDaRespostaSedex(
  [
    { servico: "SEDEX", valor: 22.4, prazo: 3, texto_entrega: "Entrega em 3 dias" },
    { servico: "PAC", valor: 18.1, prazo: 1 }
  ],
  entrada
);
checar("cotacao normal: mesmos cards de antes", normal, [
  { id: "frete_sedex_0", id_int: 25058, transportadora: "Correios SEDEX", servico: "SEDEX", valor: 22.4, prazo: "3 dias úteis", observacao: "Entrega em 3 dias", escolhido: false, pesoUsado: 2713.5, volumes: 1 },
  { id: "frete_pac_1", id_int: 25058, transportadora: "Correios PAC", servico: "PAC", valor: 18.1, prazo: "1 dia útil", observacao: "", escolhido: false, pesoUsado: 2713.5, volumes: 1 }
]);

let descartados: string[] = [];
const misto = cardsDaRespostaSedex(
  [
    { servico: "SEDEX", valor: 30, prazo: 2 },
    { servico: "PAC", valor: 0 }
  ],
  entrada,
  (s) => {
    descartados = s;
  }
);
checar("PAC sem valor sai, SEDEX fica (mesmo id de antes)", misto.map((c) => `${c.id}:${c.valor}`), ["frete_sedex_0:30"]);
checar("PAC sem valor vai para o aviso", descartados, ["PAC"]);

// ── 2. Azul ──
const plano = planejarCotacaoAzul(2.7135, "DEMAIS");
const semValorAzul: string[] = [];
const azul = mapearCotacoesAzul(
  [
    { Servico: "EXPRESSO", Total: 0, Prazo: 2 },
    { Servico: "STANDARD", Total: 55.5, Prazo: 5 },
    { Servico: "PREMIUM" }
  ],
  { pesoGramas: 2713.5, plano, aoDescartarSemValor: (s) => semValorAzul.push(s) }
);
checar("Azul: so o servico com valor vira card", azul.map((c) => `${c.servico}:${c.valor}`), ["AZUL STANDARD:55.5"]);
checar("Azul: os sem valor vao para o aviso", semValorAzul, ["AZUL EXPRESSO", "AZUL PREMIUM"]);
checar("Azul: id por posicao continua comecando em 0", azul[0]?.id, "frete_azul_azul_standard_0");

// ── 3. Aviso ──
checar("valorCotadoValido", [0, -1, null, undefined, "", "abc", NaN, 0.01, "22.4"].map(valorCotadoValido), [false, false, false, false, false, false, false, true, true]);
checar(
  "linhas do aviso, uma por fonte",
  fontesQueNaoCotaram([
    { fonte: "SEDEX", erro: new CotacaoSemValorError("SEDEX") },
    { fonte: "AZUL", erro: new Error("timeout") },
    { fonte: "TRANSPORTADORAS" },
    { fonte: "VEPPO", naoCotou: true }
  ]),
  ["Correios (SEDEX/PAC): respondeu sem valor", "Azul Cargo: não respondeu", "VEPPO: não cotou"]
);
checar("descarte parcial vira linha", fontesQueNaoCotaram([{ fonte: "SEDEX", descartados: ["PAC"] }]), ["Correios (SEDEX/PAC): PAC sem valor"]);
checar("tudo cotou: sem aviso", fontesQueNaoCotaram([{ fonte: "SEDEX" }, { fonte: "AZUL" }, { fonte: "TRANSPORTADORAS" }, { fonte: "VEPPO" }]), []);
checar(
  "VEPPO: so avisa quando devia cotar",
  ["SEM_COTACAO", "LISTA_INDISPONIVEL", "CORTE_NAO_CONFERIDO", "COTADA", "NAO_ATENDIDA", "FORA_DA_REGRA"].map(veppoDeviaTerCotado),
  [true, true, true, true, false, false]
);

// ── 4. Tela ──
const pagina = readFileSync("src/features/orcamentos/OrcamentoFormPage.tsx", "utf8");
const servico = readFileSync("src/features/orcamentos/services/frete.service.ts", "utf8");
checar("as tres portas de cotacao gravam o aviso", pagina.split("setFretesNaoCotados(").length - 1, 3);
checar("o aviso aparece na aba Fretes", pagina.includes('data-testid="aviso-frete-nao-cotou"') && pagina.includes("Atualizar fretes"), true);
checar("o servico do SEDEX passa pela regra", servico.includes("cardsDaRespostaSedex(data,"), true);
checar("a VEPPO da tela filtra valor", servico.includes("filter((f) => valorCotadoValido(f.valor))"), true);
checar("Sao Miguel e Motoboy seguem so com valor maior que zero", [servico.includes("row.sm > 0"), servico.includes("row.mb > 0")], [true, true]);

console.warn = silencio;
if (falhas > 0) {
  console.log(`\n${falhas} falha(s).`);
  process.exitCode = 1;
} else {
  console.log("\nTudo certo.");
}
