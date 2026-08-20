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
import { divergenciaFreteDoDespacho, formatarCep } from "@/features/expedicao/lib/divergencia-frete-despacho";

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

// ── 2. DIVERGÊNCIA DE FRETE ────────────────────────────────────────────────

const cotacao20961 = { pesoGramas: 3120, cep: "90620130", valor: 18.84, servico: "SEDEX", existe: true };

// O caso real que motivou a correção.
const d20961 = divergenciaFreteDoDespacho({
  cotacao: cotacao20961,
  pesoAferidoGramas: 3500,
  cepDestino: "90620130"
});
checar("20961: acusa divergência", d20961.temAviso, true);
checar("20961: o motivo é o peso", d20961.peso.motivo, "PESO_DIVERGENTE");
checar("20961: a diferença é de 380 g", d20961.peso.diferencaGramas, 380);
checar("20961: o CEP não mudou", d20961.cepMudou, false);
checar("20961: resumo legível", d20961.resumoPeso, "3,1 kg cotados contra 3,5 kg no despacho");

// Peso igual ao cotado: nada a avisar.
checar(
  "peso igual não avisa",
  divergenciaFreteDoDespacho({ cotacao: cotacao20961, pesoAferidoGramas: 3120, cepDestino: "90620130" }).temAviso,
  false
);

// A tolerância de 1 g vem de `frete-desatualizado.ts`, calibrada em casos reais.
checar(
  "0,99 g de diferença não avisa",
  divergenciaFreteDoDespacho({ cotacao: cotacao20961, pesoAferidoGramas: 3120.99, cepDestino: "90620130" }).temAviso,
  false
);
checar(
  "1 g de diferença já avisa",
  divergenciaFreteDoDespacho({ cotacao: cotacao20961, pesoAferidoGramas: 3121, cepDestino: "90620130" }).temAviso,
  true
);

// CEP: só acusa quando os dois existem e diferem.
const dCep = divergenciaFreteDoDespacho({
  cotacao: cotacao20961,
  pesoAferidoGramas: 3120,
  cepDestino: "01310-100"
});
checar("destino trocado avisa", dCep.temAviso, true);
checar("destino trocado marca o CEP", dCep.cepMudou, true);
checar("CEP normalizado só com dígitos", dCep.cepDespacho, "01310100");
checar(
  "cotação sem CEP gravado não vira alarme",
  divergenciaFreteDoDespacho({
    cotacao: { ...cotacao20961, cep: null },
    pesoAferidoGramas: 3120,
    cepDestino: "01310100"
  }).cepMudou,
  false
);
checar(
  "despacho sem endereço escolhido não vira alarme",
  divergenciaFreteDoDespacho({ cotacao: cotacao20961, pesoAferidoGramas: 3120, cepDestino: null }).cepMudou,
  false
);

// Sem peso aferido não há o que comparar — e não se acusa divergência máxima
// contra zero.
const semPeso = divergenciaFreteDoDespacho({
  cotacao: cotacao20961,
  pesoAferidoGramas: null,
  cepDestino: "90620130"
});
checar("sem peso informado não avisa", semPeso.temAviso, false);
checar("sem peso informado o motivo é SEM_ITENS", semPeso.peso.motivo, "SEM_ITENS");

// Sem cotação escolhida não há âncora.
checar(
  "sem cotação escolhida não avisa",
  divergenciaFreteDoDespacho({
    cotacao: { pesoGramas: null, cep: null, valor: null, servico: null, existe: false },
    pesoAferidoGramas: 5000,
    cepDestino: "90620130"
  }).peso.motivo,
  "SEM_COTACAO"
);

// Frete zero (FOB, retirada, sem custo) não gera aviso: não há valor a defender.
checar(
  "frete zero não avisa",
  divergenciaFreteDoDespacho({
    cotacao: { ...cotacao20961, valor: 0 },
    pesoAferidoGramas: 9000,
    cepDestino: "90620130"
  }).peso.motivo,
  "FRETE_SEM_CUSTO"
);

checar("CEP formatado", formatarCep("90620130"), "90620-130");
checar("CEP nulo vira travessão", formatarCep(null), "—");

console.log(falhas === 0 ? "\nTUDO OK" : `\n${falhas} FALHA(S)`);
process.exitCode = falhas === 0 ? 0 : 1;
