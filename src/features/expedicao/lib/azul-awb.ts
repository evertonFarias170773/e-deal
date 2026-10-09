/**
 * Regras puras da emissao de AWB da Azul Logistica (sem rede, sem banco).
 *
 * Vivem aqui porque a MESMA regra roda em dois lugares: o modal recusa antes de
 * enviar, e a rota recusa de novo no servidor — a tela nunca e a unica trava.
 *
 * A emissao cria contrato e cobranca reais na Azul e a API nao tem chave de
 * idempotencia. Por isso nada aqui "completa" valor que o operador nao digitou.
 */

/** Soma minima (cm) de altura + largura + comprimento por volume, exigida pela Azul. */
export const SOMA_MINIMA_DIMENSOES_CM = 45;

/** Descricoes que a Azul recusa em ProdutoNatureza (comparadas sem acento e caixa). */
const NATUREZAS_GENERICAS = ["PECAS", "AMOSTRAS", "BRINDES"];

export type ServicoAzul = "EXPRESSO" | "STANDARD";
export type TipoEntregaAzul = "Domicilio" | "Aeroporto";

export const SERVICOS_AZUL: readonly ServicoAzul[] = ["EXPRESSO", "STANDARD"];
export const TIPOS_ENTREGA_AZUL: readonly TipoEntregaAzul[] = ["Domicilio", "Aeroporto"];

/** Uma linha do modal: volumes de medidas e peso iguais agrupam por `quantidade`. */
export type VolumeAzul = {
  altura: number;
  largura: number;
  comprimento: number;
  /** Peso de UM volume, em kg. */
  pesoKg: number;
  quantidade: number;
};

function semAcento(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();
}

/** `null` quando a natureza serve; senao o motivo, pronto para o operador. */
export function validarNaturezaProduto(texto: string | null | undefined): string | null {
  const natureza = String(texto ?? "").trim();
  if (natureza.length < 3) return "Informe a natureza do produto (descrição específica da mercadoria).";
  if (natureza.length > 100) return "Natureza do produto longa demais (máximo 100 caracteres).";
  if (NATUREZAS_GENERICAS.includes(semAcento(natureza))) {
    return `A Azul recusa "${natureza}" como natureza do produto. Descreva a mercadoria (ex.: "Etiquetas adesivas impressas").`;
  }
  return null;
}

/** `null` quando todos os volumes servem; senao o motivo do primeiro que falha. */
export function validarVolumes(volumes: readonly VolumeAzul[]): string | null {
  if (volumes.length === 0) return "Informe ao menos um volume.";
  for (let i = 0; i < volumes.length; i += 1) {
    const v = volumes[i];
    const rotulo = `Volume ${i + 1}`;
    for (const [nome, valor] of [
      ["altura", v.altura],
      ["largura", v.largura],
      ["comprimento", v.comprimento],
      ["peso", v.pesoKg]
    ] as const) {
      if (!Number.isFinite(valor) || valor <= 0) return `${rotulo}: informe ${nome} maior que zero.`;
    }
    if (!Number.isInteger(v.quantidade) || v.quantidade <= 0) {
      return `${rotulo}: a quantidade deve ser um número inteiro maior que zero.`;
    }
    const soma = v.altura + v.largura + v.comprimento;
    if (soma < SOMA_MINIMA_DIMENSOES_CM) {
      return `${rotulo}: altura + largura + comprimento = ${soma.toLocaleString("pt-BR")} cm; a Azul exige no mínimo ${SOMA_MINIMA_DIMENSOES_CM} cm.`;
    }
  }
  return null;
}

/** Peso inicial por volume do modal: `peso_kg / qtd_volumes`, so um ponto de partida editavel. */
export function pesoInicialPorVolume(pesoKg: number | null, qtdVolumes: number | null): number | null {
  if (!pesoKg || pesoKg <= 0) return null;
  const qtd = qtdVolumes && qtdVolumes > 0 ? qtdVolumes : 1;
  return Math.round((pesoKg / qtd) * 1000) / 1000;
}

export type EstadoBotaoAzul = {
  /** Algum motivo para o botao existir neste card. */
  visivel: boolean;
  habilitado: boolean;
  /** Dica do item desligado, ou o numero da AWB quando ja emitida. */
  motivo: string | null;
  /** AWB ja gravada: o menu mostra o numero no lugar do botao. */
  awb: string | null;
};

/**
 * Quando o botao "Emitir AWB Azul" aparece e quando habilita.
 *
 * So aparece para quem a Azul atende de fato (transportadora Azul no cadastro
 * ou frete cotado como Azul); os outros cards nao ganham item morto. Habilita
 * so com CIF + NF-e autorizada + sem AWB e sem emissao em andamento.
 */
export function estadoBotaoAzul(p: {
  transportadoraAzul: boolean;
  modalidade: string | null | undefined;
  nfAutorizada: boolean;
  podeOperar: boolean;
  azulAwb: string | null | undefined;
  azulStatus: string | null | undefined;
  temExpedicao: boolean;
}): EstadoBotaoAzul {
  if (p.azulAwb) return { visivel: true, habilitado: false, motivo: `AWB Azul ${p.azulAwb}`, awb: p.azulAwb };
  if (!p.transportadoraAzul) return { visivel: false, habilitado: false, motivo: null, awb: null };
  const recusa = (motivo: string): EstadoBotaoAzul => ({ visivel: true, habilitado: false, motivo, awb: null });
  if (!p.podeOperar) return recusa("Sem permissão para operar a Expedição.");
  if (p.modalidade !== "CIF") {
    return recusa("A AWB da Azul só é emitida em frete CIF (por conta da empresa). Em FOB o cliente contrata a Azul.");
  }
  if (!p.temExpedicao) return recusa("Salve os dados de expedição do pedido antes de emitir a AWB.");
  if (!p.nfAutorizada) return recusa("A AWB exige NF-e autorizada: a Azul recebe a chave de acesso, a data e o valor da nota.");
  if (p.azulStatus === "EMITINDO") return recusa("Emissão em andamento. Aguarde alguns segundos e recarregue.");
  if (p.azulStatus === "INCERTA") {
    return recusa("Emissão incerta: a Azul não respondeu. Confira no portal da Azul se a AWB foi criada antes de qualquer nova tentativa.");
  }
  return { visivel: true, habilitado: true, motivo: null, awb: null };
}
