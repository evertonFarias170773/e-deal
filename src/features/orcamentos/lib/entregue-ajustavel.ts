/**
 * PEDIDO ENTREGUE COM VALOR AJUSTÁVEL (23/11/2026, regra do Everton; caso 24830).
 *
 * A trava de 02/11/2026 (`services/pedido-entregue.ts`) continua: pedido
 * ENTREGUE não é alterado. A ÚNICA exceção é a edição de pedido pago
 * (`/api/orcamentos/editar-paga`) quando TODAS valem:
 *   - nenhuma nota fiscal do pedido (NF-e de venda ou remessa, NFS-e) em
 *     produção que não esteja cancelada — autorizada, em processamento,
 *     rascunho ou com erro travam, porque podem sair com o valor velho;
 *     nota de homologação não trava (mesma decisão de `isNotaImpeditiva`);
 *   - nenhum título do pedido ativo no Contas a Receber (boleto ou depósito,
 *     qualquer status que não seja CANCELADO);
 *   - nenhum valor recebido: toda cobrança ativa está a vencer ou a receber
 *     (`A_VENCER`/`A_RECEBER`) e sem `paid_at` — o E-Faturado confirmado e
 *     não pago é o caso;
 *   - usuário com "Editar Proposta Paga" ou "Editar Faturado" (conferido pela
 *     rota, não aqui).
 * Fora disso a trava continua igual. Status e datas de envio não mudam: a
 * edição não escreve em `expedicoes` nem em `status_interno`. O motivo é
 * obrigatório e vai para o chat do pedido.
 *
 * O destino da diferença NÃO é decidido aqui: é o caminho de sempre da
 * editar-paga (o faturado a vencer absorve a diferença, sem crédito).
 *
 * Sem I/O de propósito: a tela e a rota decidem pela mesma função; o coletor
 * do banco está em `services/entregue-ajustavel.server.ts`.
 */

export const CODIGO_ENTREGUE_NAO_AJUSTAVEL = "PEDIDO_ENTREGUE";
export const CODIGO_MOTIVO_ENTREGUE_AUSENTE = "MOTIVO_ENTREGUE_AUSENTE";

/** Tamanho mínimo do motivo digitado (sem espaços nas pontas). */
export const MOTIVO_ENTREGUE_MINIMO = 10;
export const MOTIVO_ENTREGUE_MAXIMO = 500;

export type NotaParaAjusteEntregue = {
  tipo: "NFE" | "NFSE";
  numero: string | null;
  status: string | null;
  ambiente: string | null;
};

export type TituloParaAjusteEntregue = {
  status: string | null;
  parcela?: number | null;
  total_parcelas?: number | null;
  deposito_conta?: boolean | null;
};

export type CobrancaParaAjusteEntregue = {
  id_pagamento?: string | null;
  tipo_cobranca?: string | null;
  status: string | null;
  paid_at?: string | null;
};

export type MotivoEntregueNaoAjustavel = "NOTA_FISCAL" | "TITULO_ATIVO" | "VALOR_RECEBIDO";

export type AvaliacaoAjusteEntregue =
  | { ajustavel: true }
  | { ajustavel: false; motivo: MotivoEntregueNaoAjustavel; mensagem: string };

const COBRANCA_INATIVA = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];
const COBRANCA_NAO_RECEBIDA = ["A_VENCER", "A_RECEBER"];
const NOTA_SEM_EFEITO = ["CANCELADA", "CANCELADO"];

function normalizar(texto: unknown): string {
  return String(texto ?? "").trim().toUpperCase();
}

/** Nota que trava: de produção (ou sem ambiente gravado) e não cancelada. */
export function notaTravaAjusteEntregue(nota: NotaParaAjusteEntregue): boolean {
  if (normalizar(nota.ambiente) === "HOMOLOGACAO") return false;
  return !NOTA_SEM_EFEITO.includes(normalizar(nota.status));
}

export function tituloTravaAjusteEntregue(titulo: TituloParaAjusteEntregue): boolean {
  return normalizar(titulo.status) !== "CANCELADO";
}

/** Cobrança ativa com dinheiro recebido — ou em status desconhecido, que trava por segurança. */
export function cobrancaTravaAjusteEntregue(cobranca: CobrancaParaAjusteEntregue): boolean {
  const status = normalizar(cobranca.status);
  if (COBRANCA_INATIVA.includes(status)) return false;
  if (cobranca.paid_at) return true;
  return !COBRANCA_NAO_RECEBIDA.includes(status);
}

function rotuloNota(nota: NotaParaAjusteEntregue): string {
  const tipo = nota.tipo === "NFSE" ? "NFS-e" : "NF-e";
  const numero = String(nota.numero ?? "").trim();
  const status = normalizar(nota.status) || "sem status";
  return numero ? `${tipo} ${numero} (${status})` : `${tipo} sem número (${status})`;
}

export const MENSAGEM_ENTREGUE_PREFIXO = "Pedido entregue não pode ser alterado";

/**
 * O pedido ENTREGUE pode ter o valor ajustado pela edição de pedido pago?
 * Recebe tudo do pedido como veio do banco; quem filtra é esta função. A
 * ordem das recusas é nota, título, recebimento — a primeira que valer.
 */
export function avaliarAjusteEntregue(entrada: {
  notas: readonly NotaParaAjusteEntregue[];
  titulos: readonly TituloParaAjusteEntregue[];
  cobrancas: readonly CobrancaParaAjusteEntregue[];
}): AvaliacaoAjusteEntregue {
  const notas = entrada.notas.filter(notaTravaAjusteEntregue);
  if (notas.length > 0) {
    return {
      ajustavel: false,
      motivo: "NOTA_FISCAL",
      mensagem:
        `${MENSAGEM_ENTREGUE_PREFIXO}: ele tem nota fiscal (${Array.from(new Set(notas.map(rotuloNota))).join(", ")}). ` +
        "Só pedido entregue sem nota, sem título e sem valor recebido pode ter o valor ajustado."
    };
  }

  const titulos = entrada.titulos.filter(tituloTravaAjusteEntregue);
  if (titulos.length > 0) {
    return {
      ajustavel: false,
      motivo: "TITULO_ATIVO",
      mensagem:
        `${MENSAGEM_ENTREGUE_PREFIXO}: ele tem ${titulos.length} título(s) ativo(s) no Contas a Receber. ` +
        "Só pedido entregue sem nota, sem título e sem valor recebido pode ter o valor ajustado."
    };
  }

  const recebidas = entrada.cobrancas.filter(cobrancaTravaAjusteEntregue);
  if (recebidas.length > 0) {
    const rotulos = recebidas.map((c) => String(c.id_pagamento ?? c.tipo_cobranca ?? "cobrança").trim() || "cobrança");
    return {
      ajustavel: false,
      motivo: "VALOR_RECEBIDO",
      mensagem:
        `${MENSAGEM_ENTREGUE_PREFIXO}: ele tem valor recebido (${Array.from(new Set(rotulos)).join(", ")}). ` +
        "Só pedido entregue sem nota, sem título e sem valor recebido pode ter o valor ajustado."
    };
  }

  return { ajustavel: true };
}

/** Motivo digitado, limpo; `null` quando não serve (vazio ou curto demais). */
export function motivoEntregueValido(motivo: unknown): string | null {
  const limpo = String(motivo ?? "").replace(/\s+/g, " ").trim();
  if (limpo.length < MOTIVO_ENTREGUE_MINIMO) return null;
  return limpo.slice(0, MOTIVO_ENTREGUE_MAXIMO);
}

const moeda = (v: number) => (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** Linha do chat do pedido depois do ajuste gravado. */
export function textoChatAjusteEntregue(entrada: {
  autor: string;
  motivo: string;
  totalAntes: number;
  totalDepois: number;
}): string {
  return (
    `Pedido ENTREGUE alterado por ${entrada.autor} (sem nota, sem título e sem valor recebido). ` +
    `Total de ${moeda(entrada.totalAntes)} para ${moeda(entrada.totalDepois)}. ` +
    `Status e datas de envio não mudaram. Motivo: ${entrada.motivo}`
  );
}
