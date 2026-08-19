/**
 * Testes das regras de frete desatualizado.
 *
 *   node --experimental-strip-types scripts/testes/frete-desatualizado.test.mts
 *
 * Sai com código 1 se algo falhar. Rode depois de mexer em
 * src/features/orcamentos/services/frete-desatualizado.ts — decide se uma
 * cobrança sai ou não.
 */
import {
  avaliarFreteParaCobranca,
  formatarPesoGramas,
  mensagemFreteDesatualizado
} from "../../src/features/orcamentos/services/frete-desatualizado.ts";

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

const cotado = (over: Record<string, unknown> = {}) => ({
  pesoCotadoGramas: 10000,
  pesoAtualGramas: 10000,
  valorFrete: 85.5,
  servico: "SEDEX",
  temCotacao: true,
  temItens: true,
  ...over
});

// — Não bloqueia —
checar("peso igual esta em dia", avaliarFreteParaCobranca(cotado()).motivo, "EM_DIA");
checar("peso igual nao bloqueia", avaliarFreteParaCobranca(cotado()).bloqueia, false);

checar(
  "sem cotacao nao bloqueia",
  avaliarFreteParaCobranca(cotado({ temCotacao: false, pesoAtualGramas: 99999 })).motivo,
  "SEM_COTACAO"
);

checar(
  "frete zero nao bloqueia mesmo com peso diferente",
  avaliarFreteParaCobranca(cotado({ valorFrete: 0, pesoAtualGramas: 50000 })).motivo,
  "FRETE_SEM_CUSTO"
);

checar(
  "cotacao sem peso registrado nao bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoCotadoGramas: null, pesoAtualGramas: 50000 })).motivo,
  "SEM_ANCORA"
);
checar(
  "peso cotado zero conta como sem ancora",
  avaliarFreteParaCobranca(cotado({ pesoCotadoGramas: 0, pesoAtualGramas: 50000 })).motivo,
  "SEM_ANCORA"
);

// — Bloqueia —
const maisPesado = avaliarFreteParaCobranca(cotado({ pesoAtualGramas: 12500 }));
checar("pedido mais pesado bloqueia", maisPesado.bloqueia, true);
checar("motivo e peso divergente", maisPesado.motivo, "PESO_DIVERGENTE");
checar("diferenca positiva", maisPesado.diferencaGramas, 2500);

const maisLeve = avaliarFreteParaCobranca(cotado({ pesoAtualGramas: 7000 }));
checar("pedido mais leve tambem bloqueia", maisLeve.bloqueia, true);
checar("diferenca negativa", maisLeve.diferencaGramas, -3000);

checar(
  "um grama de diferenca ja bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoAtualGramas: 10001 })).bloqueia,
  true
);

// — Tolerância de arredondamento —
// A cotação grava o peso em gramas inteiras e o item é fracionário: a âncora é
// o arredondamento para cima do total. Sem tolerância, 15 das 26 propostas
// divergentes da base seriam barradas por menos de um grama, com o modal
// exibindo o mesmo número dos dois lados. Casos reais medidos em produção.
checar(
  "#18825 real: 269 cotado x 268,80 atual nao bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoCotadoGramas: 269, pesoAtualGramas: 268.8 })).motivo,
  "EM_DIA"
);
checar(
  "#18553 real: 960 cotado x 959,20 atual nao bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoCotadoGramas: 960, pesoAtualGramas: 959.2 })).bloqueia,
  false
);
checar(
  "#18212 real: 5387 cotado x 5386,40 atual nao bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoCotadoGramas: 5387, pesoAtualGramas: 5386.4 })).bloqueia,
  false
);
checar(
  "diferenca de exatamente 1 g ainda bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoAtualGramas: 10001 })).bloqueia,
  true
);
checar(
  "0,99 g de diferenca nao bloqueia",
  avaliarFreteParaCobranca(cotado({ pesoAtualGramas: 10000.99 })).bloqueia,
  false
);

// — Proposta sem item ativo —
// Peso zero contra qualquer âncora pareceria divergência máxima, mas é
// proposta que ainda não tem produto. E não teria saída: a aba Fretes
// desabilita a recotação justamente quando não há peso.
checar(
  "proposta sem itens nao bloqueia",
  avaliarFreteParaCobranca(cotado({ temItens: false, pesoAtualGramas: 0 })).motivo,
  "SEM_ITENS"
);
checar(
  "proposta sem itens nao bloqueia (bandeira)",
  avaliarFreteParaCobranca(cotado({ temItens: false, pesoAtualGramas: 0 })).bloqueia,
  false
);
checar(
  "com itens, peso zerado bloqueia",
  avaliarFreteParaCobranca(cotado({ temItens: true, pesoAtualGramas: 0 })).bloqueia,
  true
);

// — Entradas sujas —
checar(
  "peso atual nulo vira zero",
  avaliarFreteParaCobranca(cotado({ pesoAtualGramas: null })).pesoAtualGramas,
  0
);
checar(
  "valor de frete nulo conta como sem custo",
  avaliarFreteParaCobranca(cotado({ valorFrete: null, pesoAtualGramas: 50000 })).motivo,
  "FRETE_SEM_CUSTO"
);

// — Formatação —
checar("gramas abaixo de mil", formatarPesoGramas(850), "850 g");
checar("quilos com uma casa", formatarPesoGramas(10500), "10,5 kg");
checar("acima de cem quilos sem casa", formatarPesoGramas(130000), "130 kg");

// — Mensagem —
const msg = mensagemFreteDesatualizado(maisPesado);
checar("mensagem cita o peso cotado", msg.includes("10,0 kg"), true);
checar("mensagem cita o peso atual", msg.includes("12,5 kg"), true);
checar("mensagem cita o valor do frete", msg.includes("85,50"), true);
checar("mensagem cita o servico", msg.includes("SEDEX"), true);
checar("mensagem manda para a aba Fretes", msg.includes("aba Fretes"), true);
checar("mensagem diz mais pesado", msg.includes("mais pesado"), true);
checar("mensagem do mais leve diz mais leve", mensagemFreteDesatualizado(maisLeve).includes("mais leve"), true);
checar("sem bloqueio a mensagem e vazia", mensagemFreteDesatualizado(avaliarFreteParaCobranca(cotado())), "");

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
