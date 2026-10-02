/**
 * Serviços da transportadora na aba Fretes — src/features/orcamentos/lib/servicos-transportadora.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/servicos-transportadora.test.mts
 *
 * O QUE PROVA
 *   1. A lista só aparece para quem tem mais de um serviço (hoje, a SVT/Azul).
 *   2. O frete atual é reconhecido pelo serviço INTEIRO; texto parecido não conta.
 *      "ECOMM", o código que a cotação automática grava, é o AZUL ECOMM da lista.
 *   3. CADA serviço da lista continua sendo reconhecido por quem lê o frete
 *      depois: o vínculo da transportadora (NF-e), a categoria do painel da
 *      Expedição, o tipo de frete (trava do despacho) e o texto da coluna Envio.
 *      Serviço novo que quebre um desses reconhecimentos faz este teste falhar.
 */
import {
  freteEhDoServico,
  servicoDoFrete,
  servicosDaTransportadora,
  transportadoraTemEscolhaDeServico
} from "../../src/features/orcamentos/lib/servicos-transportadora.ts";
import {
  resolverTransportadoraParceira,
  TRANSPORTADORAS_PARCEIRAS
} from "../../src/features/orcamentos/lib/transportadoras-parceiras.ts";
import { categoriaDoServico } from "../../src/features/orcamentos/lib/categoria-frete.ts";
import { nomeTransporteEfetivo } from "../../src/features/orcamentos/lib/modalidade-frete.ts";
import { normalizarTipoFrete } from "../../src/features/expedicao/lib/tipo-frete.ts";

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

const SVT = TRANSPORTADORAS_PARCEIRAS.AZUL;

// — 1. Quem tem lista —
checar(
  "SVT: os quatro servicos, na ordem do dono",
  servicosDaTransportadora(SVT),
  ["AZUL ECOMM", "AZUL STANDARD", "AZUL EXPRESSO", "AZUL PREMIUM"]
);
checar("SVT: tem escolha de servico", transportadoraTemEscolhaDeServico(SVT), true);
checar("Correios: sem lista", transportadoraTemEscolhaDeServico(TRANSPORTADORAS_PARCEIRAS.CORREIOS), false);
checar("Sao Miguel: sem lista", servicosDaTransportadora(TRANSPORTADORAS_PARCEIRAS.SAO_MIGUEL), []);
checar("transportadora avulsa: sem lista", transportadoraTemEscolhaDeServico(120009), false);
checar("sem transportadora: sem lista", transportadoraTemEscolhaDeServico(null), false);

// — 2. Qual servico o frete atual e —
// "ECOMM" e o codigo que a cotacao automatica da Azul grava: e o AZUL ECOMM.
checar("ECOMM gravado aparece como AZUL ECOMM", servicoDoFrete(SVT, { servico: "ECOMM" }), "AZUL ECOMM");
checar("cartao da cotacao automatica (Azul Cargo / ECOMM)", servicoDoFrete(SVT, { servico: "ECOMM" }), "AZUL ECOMM");
checar("ECOMM com caixa e espaco diferentes", servicoDoFrete(SVT, { servico: "  ecomm " }), "AZUL ECOMM");
checar("grafia antiga AZUL ECOMM, igual a da lista", servicoDoFrete(SVT, { servico: "AZUL ECOMM" }), "AZUL ECOMM");
checar("AZUL STANDARD", servicoDoFrete(SVT, { servico: "Azul Standard" }), "AZUL STANDARD");
checar("AZUL EXPRESSO", servicoDoFrete(SVT, { servico: "AZUL EXPRESSO" }), "AZUL EXPRESSO");
checar("linha gravada, com caixa e espaco diferentes", servicoDoFrete(SVT, { servico: "  azul   premium " }), "AZUL PREMIUM");
checar("frete manual com o nome do cadastro: nenhum servico", servicoDoFrete(SVT, { servico: "SVT TRANSPORTES" }), null);
checar("erro de digitacao antigo nao vira servico", servicoDoFrete(SVT, { servico: "AZUL ECOM" }), null);
checar("texto parecido nao vira servico", servicoDoFrete(SVT, { servico: "AEREO EXPRESSO" }), null);
checar("sem frete escolhido", servicoDoFrete(SVT, undefined), null);
checar("servico vazio", servicoDoFrete(SVT, { servico: "" }), null);
checar("transportadora sem lista nunca casa", servicoDoFrete(120009, { servico: "ECOMM" }), null);
checar("sem transportadora nunca casa", servicoDoFrete(null, { servico: "ECOMM" }), null);
checar("freteEhDoServico: igual", freteEhDoServico(SVT, { servico: "Azul Premium" }, "AZUL PREMIUM"), true);
checar("freteEhDoServico: o cartao ECOMM e o AZUL ECOMM", freteEhDoServico(SVT, { servico: "ECOMM" }, "AZUL ECOMM"), true);
checar("freteEhDoServico: outro servico", freteEhDoServico(SVT, { servico: "ECOMM" }, "AZUL PREMIUM"), false);
checar("freteEhDoServico: sem frete", freteEhDoServico(SVT, null, "AZUL ECOMM"), false);
checar("freteEhDoServico: transportadora sem lista", freteEhDoServico(120009, { servico: "ECOMM" }, "AZUL ECOMM"), false);

// — 3. Cada servico da lista segue reconhecido por quem le o frete —
// O codigo cru "ECOMM" entra junto: e ele que a cotacao automatica grava.
for (const [id, categoriaEsperada] of [[SVT, "AEREO"]] as const) {
  for (const servico of [...servicosDaTransportadora(id), "ECOMM"]) {
    // O frete manual nasce com `transportadora = servico`, e e assim que ele
    // volta do banco (`cotacao_frete` nao guarda a transportadora).
    const frete = { transportadora: servico, servico };
    checar(`${servico}: vinculo com a transportadora (NF-e)`, resolverTransportadoraParceira(frete), id);
    checar(`${servico}: categoria do painel da Expedicao`, categoriaDoServico(servico, servico, "CIF"), categoriaEsperada);
    checar(`${servico}: tipo de frete (trava do despacho)`, normalizarTipoFrete(servico), "TRANSPORTADORA");
    checar(`${servico}: texto da coluna Envio e da Expedicao em CIF`, nomeTransporteEfetivo(servico, "CIF", servico), servico);
  }
}

console.log(falhas === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${falhas} TESTE(S) FALHARAM`);
process.exitCode = falhas === 0 ? 0 : 1;
