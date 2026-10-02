/**
 * O aviso que a proposta mostra quando ela é CÓPIA de outra ("Duplicar proposta").
 *
 * POR QUE EXISTE
 *   Até 02/10/2026 a cópia nascia sem faturado, endereço, contato e modalidade,
 *   e a tela preenchia tudo com o padrão do cadastro, calada. Desde a fase 1 de
 *   `copiar_proposta_v2` esses dados vêm da original — e o vendedor precisa
 *   saber disso, porque o que veio pode não valer para a venda nova. O frete
 *   continua de fora, e os preços são os da venda original.
 *
 * SÓ PARA CÓPIA FEITA PELA FUNÇÃO NOVA
 *   Cópia anterior ao corte não levou o cabeçalho: dizer "veio da original"
 *   seria mentira. Para ela a tela fica exatamente como sempre foi.
 *
 * MODELOS
 *   A fase 2 da função copia os modelos e grava "Cópia do pedido #X" na
 *   observação de arte de cada um. É por essa marca que a tela conta quantos
 *   vieram; sem modelo marcado, o aviso não fala de modelo.
 *
 * Sem imports de propósito: roda no navegador e no teste do Node, igual.
 */

/** A fase 1 de `copiar_proposta_v2` entrou no banco em 02/10/2026, 18:00 UTC. */
export const COPIA_LEVA_CABECALHO_DESDE = "2026-10-02T18:00:00Z";

const MARCA_MODELO_COPIADO = /^Cópia do pedido #\d+/;

/** Quantos modelos carregam a marca que a cópia grava na observação de arte. */
export function contarModelosCopiados(observacoesDeArte: ReadonlyArray<string | null | undefined>): number {
  return observacoesDeArte.filter((obs) => MARCA_MODELO_COPIADO.test(String(obs ?? "").trim())).length;
}

/** A cópia foi criada depois que a função passou a levar o cabeçalho? */
export function copiaLevouCabecalho(criadaEm: string | null | undefined): boolean {
  const instante = Date.parse(String(criadaEm ?? ""));
  return Number.isFinite(instante) && instante >= Date.parse(COPIA_LEVA_CABECALHO_DESDE);
}

export type EntradaDoAvisoDaCopia = {
  /** `propostas.id_int_origem_copia`. Nulo quando a original foi apagada. */
  idIntOrigem: number | null;
  /** `propostas.modalidade_frete` da cópia. */
  modalidade: "CIF" | "FOB" | "RETIRA" | null;
  avulsa: boolean;
  /** Modelos com a marca da cópia — ver `contarModelosCopiados`. */
  modelosCopiados: number;
};

export type AvisoDaCopia = { titulo: string; linhas: string[] };

export function montarAvisoDaCopia(entrada: EntradaDoAvisoDaCopia): AvisoDaCopia {
  const linhas: string[] = [
    "Faturado, endereço de entrega, contato e observações vieram da original. Confira se valem para esta venda antes de salvar."
  ];

  if (entrada.avulsa) {
    linhas.push("O frete não foi copiado: informe o valor de novo.");
  } else if (entrada.modalidade === "RETIRA") {
    linhas.push("A modalidade Retira veio da original. Se esta venda for entregue, troque a modalidade e escolha o frete.");
  } else if (entrada.modalidade === "FOB") {
    linhas.push("A modalidade FOB e a transportadora vieram da original. Confira quem vai retirar.");
  } else {
    linhas.push("O frete não foi copiado: escolha a cotação de novo.");
  }

  if (!entrada.avulsa) {
    linhas.push("Os preços dos produtos são os da venda original, não os do catálogo de hoje.");
  }

  if (entrada.modelosCopiados > 0) {
    const n = entrada.modelosCopiados;
    linhas.push(
      `${n} ${n === 1 ? "modelo veio" : "modelos vieram"} com a mesma numeração da original e com a arte pendente. ` +
        "Confira a numeração na aba Pedido: se for o mesmo evento, ela vai se repetir."
    );
  }

  return {
    titulo: entrada.idIntOrigem ? `Cópia da proposta #${entrada.idIntOrigem}` : "Esta proposta é uma cópia",
    linhas
  };
}
