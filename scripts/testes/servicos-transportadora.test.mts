/**
 * Serviços da transportadora na aba Fretes — src/features/orcamentos/lib/servicos-transportadora.ts
 *
 *   node --experimental-strip-types --import ./scripts/testes/_alias-hook.mjs \
 *        scripts/testes/servicos-transportadora.test.mts
 *
 * O QUE PROVA
 *   1. A lista só aparece para quem tem mais de um serviço (hoje, a SVT/Azul).
 *   2. O frete atual é reconhecido pelo serviço INTEIRO; texto parecido não conta.
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
checar("SVT: ECOMM e o padrao, AZUL PREMIUM a escolha", servicosDaTransportadora(SVT), ["ECOMM", "AZUL PREMIUM"]);
checar("SVT: tem escolha de servico", transportadoraTemEscolhaDeServico(SVT), true);
checar("Correios: sem lista", transportadoraTemEscolhaDeServico(TRANSPORTADORAS_PARCEIRAS.CORREIOS), false);
checar("Sao Miguel: sem lista", servicosDaTransportadora(TRANSPORTADORAS_PARCEIRAS.SAO_MIGUEL), []);
checar("transportadora avulsa: sem lista", transportadoraTemEscolhaDeServico(120009), false);
checar("sem transportadora: sem lista", transportadoraTemEscolhaDeServico(null), false);

// — 2. Qual servico o frete atual e —
checar("cartao da cotacao automatica", servicoDoFrete(SVT, { servico: "ECOMM" }), "ECOMM");
checar("linha gravada, com caixa e espaco diferentes", servicoDoFrete(SVT, { servico: "  azul   premium " }), "AZUL PREMIUM");
checar("frete manual com o nome do cadastro: nenhum servico", servicoDoFrete(SVT, { servico: "SVT TRANSPORTES" }), null);
checar("grafia antiga da cotacao nao e o ECOMM da lista", servicoDoFrete(SVT, { servico: "AZUL ECOMM" }), null);
checar("sem frete escolhido", servicoDoFrete(SVT, undefined), null);
checar("servico vazio", servicoDoFrete(SVT, { servico: "" }), null);
checar("transportadora sem lista nunca casa", servicoDoFrete(120009, { servico: "ECOMM" }), null);
checar("freteEhDoServico: igual", freteEhDoServico({ servico: "Azul Premium" }, "AZUL PREMIUM"), true);
checar("freteEhDoServico: outro servico", freteEhDoServico({ servico: "ECOMM" }, "AZUL PREMIUM"), false);
checar("freteEhDoServico: sem frete", freteEhDoServico(null, "ECOMM"), false);

// — 3. Cada servico da lista segue reconhecido por quem le o frete —
for (const [id, categoriaEsperada] of [[SVT, "AEREO"]] as const) {
  for (const servico of servicosDaTransportadora(id)) {
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
