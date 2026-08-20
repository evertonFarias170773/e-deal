/**
 * Testes das duas guardas do despacho (20/08/2026).
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/despacho-campos-e-divergencia.test.mts
 *
 * 1. `camposMinimosDespacho` — o que impede confirmar um despacho vazio. Até
 *    hoje o botão só olhava `salvando`, e a única guarda de campo obrigatório
 *    era a modalidade — que deixou de barrar qualquer coisa quando CIF virou o
 *    padrão das propostas novas, em 19/08.
 *
 * 2. `divergenciaFreteDoDespacho` — se o envio ainda corresponde ao frete que a
 *    proposta cobra. Informa, nunca bloqueia.
 *
 * Ambas são puras e rodam nos DOIS lados (tela e `despachar()`), porque não há
 * rota de API no caminho do despacho: é PostgREST direto do browser, com RLS
 * permissiva em `propostas`.
 */
import { camposMinimosDespacho, frasearFaltantes } from "@/features/expedicao/lib/campos-minimos-despacho";
import {
  divergenciaFreteDoDespacho,
  formatarCep,
  frasearMotivos,
  referenciaTransporte
} from "@/features/expedicao/lib/divergencia-frete-despacho";

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

// ── 1. CAMPOS MÍNIMOS ───────────────────────────────────────────────────────

const completo = {
  tipoEntrega: "TRANSPORTE" as const,
  modalidadeFrete: "CIF" as const,
  transportadoraNome: "Correios SEDEX",
  idTransportadoraCliente: null,
  qtdVolumes: 1,
  idEnderecoEntrega: "ee5db217-261b-409c-b574-b0c36c1b4917"
};

checar("despacho completo não tem faltantes", camposMinimosDespacho(completo, "DESPACHO"), []);

// O caso do bug: modal recém-aberto, CIF pré-selecionado, nada mais definido.
checar(
  "modal em branco acusa transportadora, endereço e volumes",
  camposMinimosDespacho(
    { ...completo, transportadoraNome: "", idTransportadoraCliente: null, idEnderecoEntrega: null, qtdVolumes: null },
    "DESPACHO"
  ),
  ["a transportadora", "o endereço de entrega", "a quantidade de volumes"]
);

checar(
  "sem modalidade ela entra na lista",
  camposMinimosDespacho({ ...completo, modalidadeFrete: null }, "DESPACHO"),
  ["a modalidade do frete"]
);

// Transportadora vale por nome OU por cadastro — são caminhos alternativos.
checar(
  "transportadora só pelo cadastro basta",
  camposMinimosDespacho({ ...completo, transportadoraNome: "", idTransportadoraCliente: 120001 }, "DESPACHO"),
  []
);
checar(
  "transportadora só com espaços não conta",
  camposMinimosDespacho({ ...completo, transportadoraNome: "   ", idTransportadoraCliente: null }, "DESPACHO"),
  ["a transportadora"]
);

// Volumes: o campo nasce "1" na tela; o que se impede é esvaziar ou zerar.
checar("volumes 0 não passa", camposMinimosDespacho({ ...completo, qtdVolumes: 0 }, "DESPACHO"), [
  "a quantidade de volumes"
]);
checar("volumes 2 passa", camposMinimosDespacho({ ...completo, qtdVolumes: 2 }, "DESPACHO"), []);

// Retirada no balcão: o cliente vem buscar. Sem transportadora, sem endereço.
checar(
  "retirada exige só a modalidade",
  camposMinimosDespacho(
    {
      tipoEntrega: "RETIRADA",
      modalidadeFrete: "RETIRA",
      transportadoraNome: "",
      idTransportadoraCliente: null,
      qtdVolumes: null,
      idEnderecoEntrega: null
    },
    "DESPACHO"
  ),
  []
);
checar(
  "retirada sem modalidade ainda acusa a modalidade",
  camposMinimosDespacho(
    {
      tipoEntrega: "RETIRADA",
      modalidadeFrete: null,
      transportadoraNome: "",
      idTransportadoraCliente: null,
      qtdVolumes: null,
      idEnderecoEntrega: null
    },
    "DESPACHO"
  ),
  ["a modalidade do frete"]
);

// Modo edição NÃO herda a exigência: o pedido já saiu, e obrigar campo agora
// impediria corrigir o que existe.
checar(
  "modo edição nunca acusa nada",
  camposMinimosDespacho(
    { ...completo, modalidadeFrete: null, transportadoraNome: "", idEnderecoEntrega: null, qtdVolumes: null },
    "EDICAO"
  ),
  []
);

checar("fraseado de um item", frasearFaltantes(["a transportadora"]), "a transportadora");
checar(
  "fraseado de três itens",
  frasearFaltantes(["a transportadora", "o endereço de entrega", "a quantidade de volumes"]),
  "a transportadora, o endereço de entrega e a quantidade de volumes"
);
checar("fraseado de lista vazia", frasearFaltantes([]), "");

// ── 2. DIVERGÊNCIA DE FRETE — TRÊS DIMENSÕES, E SÓ CIF BLOQUEIA ───────────

const CIF = "CIF" as const;
const cotacao20961 = { pesoGramas: 3120, cep: "90620130", valor: 18.84, servico: "SEDEX", existe: true };

/** Despacho fiel ao cotado: SEDEX → CORREIOS, mesmo peso, mesmo CEP. */
const fiel = {
  cotacao: cotacao20961,
  pesoAferidoGramas: 3120,
  cepDestino: "90620130",
  modalidadeEfetiva: CIF,
  tipoFreteEscolhido: "CORREIOS" as const
};

checar("despacho fiel não bloqueia", divergenciaFreteDoDespacho(fiel).bloqueia, false);
checar("despacho fiel não avisa", divergenciaFreteDoDespacho(fiel).temAviso, false);

// ── Dimensão PESO: margem de 5% para mais ─────────────────────────────────
// 3120 × 1,05 = 3276 exatos. "Margem SUPERIOR a 5%" — 5% cravado ainda passa.
checar(
  "5% cravado NÃO bloqueia (fronteira exata)",
  divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: 3276 }).bloqueia,
  false
);
checar(
  "1 grama acima dos 5% bloqueia",
  divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: 3277 }).bloqueia,
  true
);
checar(
  "4,99% não bloqueia",
  divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: 3275 }).bloqueia,
  false
);
// Peso MENOR nunca bloqueia: a empresa não perde enviando mais leve que cobrou.
checar(
  "peso muito menor não bloqueia",
  divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: 500 }).bloqueia,
  false
);
checar(
  "peso menor nem avisa",
  divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: 500 }).temAviso,
  false
);
// O caso real do 20961: 3.120 g cotados, 3.500 g despachados = +12,2%.
const d20961 = divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: 3500 });
checar("20961 bloqueia por peso", d20961.bloqueia, true);
checar("20961 marca a dimensão peso", d20961.pesoExcedeuMargem, true);
checar("20961 mede o excesso", Number((d20961.percentualAcimaDoCotado! * 100).toFixed(1)), 12.2);
checar("20961 não acusa transporte", d20961.transporteMudou, false);
checar("20961 não acusa destino", d20961.cepMudou, false);

// ── Dimensão DESTINO ──────────────────────────────────────────────────────
const dCep = divergenciaFreteDoDespacho({ ...fiel, cepDestino: "01310-100" });
checar("CEP diferente bloqueia", dCep.bloqueia, true);
checar("CEP normalizado só com dígitos", dCep.cepDespacho, "01310100");
checar(
  "cotação sem CEP não vira bloqueio",
  divergenciaFreteDoDespacho({ ...fiel, cotacao: { ...cotacao20961, cep: null }, cepDestino: "01310100" }).cepMudou,
  false
);
checar(
  "despacho sem endereço não vira bloqueio",
  divergenciaFreteDoDespacho({ ...fiel, cepDestino: null }).cepMudou,
  false
);

// ── Dimensão TRANSPORTE, e a referência confiável ─────────────────────────
checar(
  "trocar CORREIOS por TRANSPORTADORA bloqueia",
  divergenciaFreteDoDespacho({ ...fiel, tipoFreteEscolhido: "TRANSPORTADORA" }).bloqueia,
  true
);
checar("referência vem do serviço cotado", referenciaTransporte(null, "SEDEX"), "CORREIOS");
checar("MOTOBOY é referência válida", referenciaTransporte(null, "MOTOBOY"), "MOTOBOY");
checar("SÃO MIGUEL vira TRANSPORTADORA", referenciaTransporte(null, "SÃO MIGUEL"), "TRANSPORTADORA");

// 66% da base cai aqui: o texto da cotação é ambíguo, não a escolha do
// expedidor. Sem referência confiável, a dimensão não bloqueia.
checar("INDEFINIDO não é referência", referenciaTransporte(null, "FRETE INCLUSO"), null);
checar("SEM_CUSTO não é referência", referenciaTransporte(null, "Sem custo"), null);
checar("RETIRA_BALCAO não é referência", referenciaTransporte(null, "Retira balcão"), null);
checar("texto lixo não é referência", referenciaTransporte(null, "DD"), null);
checar(
  "cotação INDEFINIDA não bloqueia por transporte",
  divergenciaFreteDoDespacho({
    ...fiel,
    cotacao: { ...cotacao20961, servico: "FRETE INCLUSO" },
    tipoFreteEscolhido: "TRANSPORTADORA"
  }).transporteMudou,
  false
);
checar(
  "cotação SEM CUSTO não bloqueia por transporte",
  divergenciaFreteDoDespacho({
    ...fiel,
    cotacao: { ...cotacao20961, servico: "Sem custo" },
    tipoFreteEscolhido: "TRANSPORTADORA"
  }).bloqueia,
  false
);
// Já despachado: aí existe escolha explícita, e ela é a referência.
checar(
  "expedicoes.tipo_frete vence o texto da cotação",
  referenciaTransporte("MOTOBOY", "FRETE INCLUSO"),
  "MOTOBOY"
);
checar(
  "redespacho trocando o transporte bloqueia",
  divergenciaFreteDoDespacho({
    ...fiel,
    cotacao: { ...cotacao20961, servico: "FRETE INCLUSO" },
    tipoFreteEscolhido: "CORREIOS",
    tipoFreteJaDespachado: "MOTOBOY"
  }).bloqueia,
  true
);

// ── Fora de CIF nada bloqueia: a recotação nem existe para esse pedido ────
const tudoDivergente = {
  ...fiel,
  pesoAferidoGramas: 9000,
  cepDestino: "01310100",
  tipoFreteEscolhido: "TRANSPORTADORA" as const
};
checar("em CIF, tudo divergente bloqueia", divergenciaFreteDoDespacho(tudoDivergente).bloqueia, true);
checar("em CIF, os três motivos aparecem", divergenciaFreteDoDespacho(tudoDivergente).motivos.length, 3);
for (const modalidade of [null, "FOB", "RETIRA"] as const) {
  const d = divergenciaFreteDoDespacho({ ...tudoDivergente, modalidadeEfetiva: modalidade });
  checar(`modalidade ${modalidade ?? "nula"} não bloqueia`, d.bloqueia, false);
  checar(`modalidade ${modalidade ?? "nula"} ainda informa`, d.temAviso, true);
}

// ── Aplicar recotação limpa o bloqueio ────────────────────────────────────
// A referência passa a ser o peso/CEP da recotação aplicada, e é por isso que
// o bloqueio some sem precisar reabrir o modal.
const depoisDeAplicar = divergenciaFreteDoDespacho({
  ...fiel,
  cotacao: { pesoGramas: 3500, cep: "01310100", valor: 25.9, servico: "SEDEX", existe: true },
  pesoAferidoGramas: 3500,
  cepDestino: "01310100"
});
checar("recotado com o peso e destino novos: liberado", depoisDeAplicar.bloqueia, false);

// ── Porteiros herdados de frete-desatualizado.ts ──────────────────────────
checar(
  "sem peso informado não bloqueia",
  divergenciaFreteDoDespacho({ ...fiel, pesoAferidoGramas: null }).bloqueia,
  false
);
checar(
  "sem cotação escolhida não bloqueia",
  divergenciaFreteDoDespacho({
    ...fiel,
    cotacao: { pesoGramas: null, cep: null, valor: null, servico: null, existe: false },
    pesoAferidoGramas: 9000
  }).bloqueia,
  false
);
checar(
  "frete zero não bloqueia por peso",
  divergenciaFreteDoDespacho({
    ...fiel,
    cotacao: { ...cotacao20961, valor: 0 },
    pesoAferidoGramas: 9000
  }).pesoExcedeuMargem,
  false
);

checar("CEP formatado", formatarCep("90620130"), "90620-130");
checar("CEP nulo vira travessão", formatarCep(null), "—");
checar("fraseado de dois motivos", frasearMotivos(["o peso subiu", "o destino mudou"]), "o peso subiu e o destino mudou");

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
