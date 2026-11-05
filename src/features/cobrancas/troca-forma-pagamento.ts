/**
 * Trocar forma de pagamento — regras puras (sem I/O e sem React).
 *
 * Caso de origem: pedido com NF-e autorizada (nota antecipada) em que geraram
 * PIX, mas o cliente paga faturado. Cancelar a cobrança sozinha continua
 * barrado pela nota (`NOTA_AUTORIZADA` em cancelamento-elegibilidade). Trocar
 * é permitido: a nota fica como está, e a cobrança nova nasce com a mesma
 * proposta, o mesmo valor e o mesmo pagador.
 *
 * Escopo deliberadamente estreito:
 * - De: PIX não pago, das empresas que recebem pelo C6 (1 e 3). No C6 o Vibe
 *   só dá o PIX por cancelado quando o banco confirma; no Inter (Ideal Birô)
 *   essa confirmação ainda não existe, e por isso a troca não vale lá.
 * - Para: Faturado. É a única forma que nasce sem nada fora do Vibe (os
 *   boletos só existem depois, no Registro de Recebíveis). É isso que permite
 *   criar a nova ANTES de cancelar a antiga e desfazer a nova se o banco não
 *   confirmar.
 *
 * A rota é `src/app/api/cobrancas/trocar-forma-pagamento/route.ts`.
 */
import { formatCurrency } from "@/lib/formatters/currency";
import { getLocalDateInSaoPaulo } from "@/features/cobrancas/cobrancas-utils";
import { TODAS_AS_RECUSAS, type CodigoVeredito } from "@/features/cobrancas/cancelamento-elegibilidade";

/** Empresas cujo PIX sai pelo C6, com confirmação do banco no cancelamento. */
export const EMPRESAS_DA_TROCA: readonly number[] = [1, 3];

/** Forma de origem aceita. */
export const TIPO_DE_ORIGEM_DA_TROCA = "PIX";

/** Forma de destino aceita. */
export const TIPO_DE_DESTINO_DA_TROCA = "E-FATURADO";

/**
 * As recusas de cancelamento que valem para a troca: todas as de hoje, menos
 * a nota autorizada. Produção ativa, dinheiro recebido, vínculo ambíguo,
 * crédito consumido e título em aberto continuam barrando.
 */
export const RECUSAS_DA_TROCA: readonly CodigoVeredito[] = TODAS_AS_RECUSAS.filter(
  (codigo) => codigo !== "NOTA_AUTORIZADA"
);

/**
 * Marcador gravado em `pagamentos_v2.motivo_troca` da cobrança antiga enquanto
 * a troca está em andamento. A gravação é condicional (só se o campo estiver
 * vazio), e é ela que impede duas trocas da mesma cobrança ao mesmo tempo.
 */
export const PREFIXO_TROCA_EM_ANDAMENTO = "TROCA EM ANDAMENTO";

function normalizar(valor: unknown): string {
  return String(valor ?? "").trim().toUpperCase().replace(/_/g, "-");
}

export type CobrancaParaTroca = {
  tipo_cobranca: string | null;
  id_empresa: number | string | null;
  status: string | null;
  paid_at?: string | null;
};

/**
 * A tela mostra a ação? Só para PIX não pago de empresa do C6. A permissão e
 * o resto das recusas quem decide é o servidor, ao abrir a janela.
 */
export function cobrancaAceitaTroca(cobranca: CobrancaParaTroca): boolean {
  if (normalizar(cobranca.tipo_cobranca) !== TIPO_DE_ORIGEM_DA_TROCA) return false;
  if (!EMPRESAS_DA_TROCA.includes(Number(cobranca.id_empresa))) return false;
  if (cobranca.paid_at != null) return false;
  return normalizar(cobranca.status) === "A-RECEBER";
}

export type PagamentoDaTroca = CobrancaParaTroca & {
  id: string;
  id_int: number | null;
  id_pagamento: string | null;
  cod_solicitacao_inter: string | null;
  reserva_estado: string | null;
  id_pendencia: number | null;
  motivo_troca: string | null;
};

export type RecusaDaTroca = { code: string; message: string; httpStatus: number };

/**
 * O que a troca exige da cobrança antiga, além do veredito de cancelamento.
 * Devolve a primeira recusa ou `null`.
 */
export function recusaDaCobrancaParaTroca(pagamento: PagamentoDaTroca): RecusaDaTroca | null {
  if (pagamento.id_int == null) {
    return { code: "SEM_PROPOSTA", httpStatus: 409, message: "A troca só vale para cobrança vinculada a uma proposta." };
  }
  if (normalizar(pagamento.tipo_cobranca) !== TIPO_DE_ORIGEM_DA_TROCA) {
    return { code: "TIPO_NAO_ACEITO", httpStatus: 409, message: "A troca de forma de pagamento vale só para cobrança PIX." };
  }
  if (!EMPRESAS_DA_TROCA.includes(Number(pagamento.id_empresa))) {
    return {
      code: "EMPRESA_NAO_ACEITA",
      httpStatus: 409,
      message: "A troca de forma de pagamento não vale para a Ideal Birô. Use o cancelamento da cobrança."
    };
  }
  if (pagamento.paid_at != null || normalizar(pagamento.status) !== "A-RECEBER") {
    return { code: "NAO_A_RECEBER", httpStatus: 409, message: "Só dá para trocar a forma de uma cobrança emitida e não paga." };
  }
  if (!String(pagamento.cod_solicitacao_inter ?? "").trim()) {
    return {
      code: "PIX_SEM_CODIGO",
      httpStatus: 409,
      message: "Este PIX ainda não tem o código do banco. Aguarde alguns instantes e tente de novo."
    };
  }
  if (pagamento.reserva_estado === "RESERVA_ATIVA" || pagamento.id_pendencia != null) {
    return {
      code: "CONTA_CORRENTE",
      httpStatus: 409,
      message: "Cobrança vinculada à Conta Corrente. A troca de forma de pagamento não vale para ela."
    };
  }
  if (String(pagamento.motivo_troca ?? "").trim()) {
    return {
      code: "TROCA_EM_ANDAMENTO",
      httpStatus: 409,
      message: "Já existe uma troca de forma de pagamento registrada nesta cobrança. Atualize a tela."
    };
  }
  return null;
}

export type ModeloDaTroca = {
  id: string;
  resultado: string | null;
  qtd_parcela: number | null;
  inicio: number | null;
  intervalo: number | null;
  entrada_porcento: number | null;
};

/** "2026-11-05" + 30 dias -> "2026-12-05", sem fuso no meio. */
export function somarDiasIso(dataIso: string, dias: number): string {
  const [ano, mes, dia] = dataIso.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

/** Condição completa? A mesma exigência da tela de gerar cobrança. */
export function modeloValidoParaTroca(modelo: ModeloDaTroca | null | undefined): modelo is ModeloDaTroca {
  return Boolean(
    modelo &&
      String(modelo.resultado ?? "").trim() &&
      modelo.qtd_parcela != null &&
      modelo.inicio != null &&
      modelo.intervalo != null
  );
}

export type CobrancaAntigaParaCopia = {
  id_int: number;
  id_pagamento: string | null;
  id_cliente: number | null;
  cliente: string | null;
  documento: string | null;
  valor: number | string | null;
  empresa: string | null;
  id_empresa: number | null;
  os_ideal: number | null;
  atendente: string | null;
  obs_v2: string | null;
};

/**
 * A linha da cobrança nova. Proposta, valor, pagador, empresa, OS Ideal e
 * observação vêm da antiga; só a condição vem da tela. O vencimento segue a
 * condição, como no Gerar cobrança (hoje em São Paulo + dias até a primeira).
 */
export function montarCobrancaDaTroca(
  antiga: CobrancaAntigaParaCopia,
  modelo: ModeloDaTroca,
  agora: Date = new Date()
): Record<string, unknown> {
  const valor = Math.round(Number(antiga.valor) * 100) / 100;
  const hoje = getLocalDateInSaoPaulo(agora);
  const entrada = Number(modelo.entrada_porcento ?? 0);
  const referencia = antiga.id_pagamento || "anterior";
  return {
    id_int: antiga.id_int,
    id_cliente: antiga.id_cliente,
    cliente: antiga.cliente,
    documento: antiga.documento,
    valor,
    status: "A_VENCER",
    tipo_cobranca: TIPO_DE_DESTINO_DA_TROCA,
    empresa: antiga.empresa,
    id_empresa: antiga.id_empresa,
    os_ideal: antiga.os_ideal,
    atendente: antiga.atendente,
    descricao: `Cobrança E-FATURADO da proposta #${antiga.id_int} (troca da ${referencia})`,
    vencimento: somarDiasIso(hoje, Number(modelo.inicio)),
    obs_v2: antiga.obs_v2,
    confirmado: false,
    forma_fatu: modelo.resultado,
    forma_pgto: modelo.resultado,
    id_modelo_cobranca: modelo.id,
    p_valor_entrada: entrada > 0 ? Math.round(valor * entrada) / 100 : 0,
    p_qtd_parcelas: modelo.qtd_parcela,
    p_dias_pra_inicio: modelo.inicio,
    p_intervalo: modelo.intervalo,
    paid_at: null
  };
}

/** O que fica gravado em `motivo_troca` da antiga enquanto a troca corre. */
export function marcadorEmAndamento(autor: string, motivo: string): string {
  return `${PREFIXO_TROCA_EM_ANDAMENTO} por ${autor}. Motivo: ${motivo}`;
}

/** O que fica em `motivo_troca` da antiga depois da troca concluída. */
export function registroDaTrocaNaAntiga(entrada: {
  autor: string;
  motivo: string;
  novaIdPagamento: string;
  condicao: string;
}): string {
  return `Trocada por Faturado (${entrada.condicao}), cobrança ${entrada.novaIdPagamento}, por ${entrada.autor}. Motivo: ${entrada.motivo}`;
}

/** `motivo_cancela` da antiga. */
export function motivoCancelaDaAntiga(novaIdPagamento: string, motivo: string): string {
  return `Troca de forma de pagamento: substituída pela cobrança ${novaIdPagamento} (Faturado). Motivo: ${motivo}`;
}

/** `motivo_cancela` da nova, quando o banco não confirma o cancelamento do PIX. */
export function motivoCancelaDaNovaDesfeita(antigaIdPagamento: string, desfecho: string, motivo: string): string {
  return (
    `Troca de forma de pagamento não concluída: o banco não confirmou o cancelamento do PIX ${antigaIdPagamento} (${desfecho}). ` +
    `O PIX continua ativo. Motivo da troca: ${motivo}`
  );
}

/** A linha do Histórico que liga as duas cobranças. */
export function mensagemHistoricoDaTroca(entrada: {
  antigaIdPagamento: string;
  novaIdPagamento: string;
  autor: string;
  permissao: string;
  condicao: string;
  valor: number;
  motivo: string;
}): string {
  return (
    `Forma de pagamento trocada por ${entrada.autor} (${entrada.permissao}): ` +
    `cobrança ${entrada.antigaIdPagamento} (PIX) cancelada e substituída pela ${entrada.novaIdPagamento} ` +
    `(Faturado, ${entrada.condicao}), mesmo valor ${formatCurrency(entrada.valor)}. ` +
    `Nota fiscal mantida. Motivo: ${entrada.motivo}`
  );
}

/** A linha do Histórico quando a troca é desfeita. */
export function mensagemHistoricoDaTrocaDesfeita(entrada: {
  antigaIdPagamento: string;
  novaIdPagamento: string;
  autor: string;
  motivo: string;
}): string {
  return (
    `Troca de forma de pagamento não concluída (tentada por ${entrada.autor}): o banco não confirmou o cancelamento do PIX ` +
    `${entrada.antigaIdPagamento}, que continua ativo. A cobrança ${entrada.novaIdPagamento} (Faturado) foi cancelada. ` +
    `Motivo da troca: ${entrada.motivo}`
  );
}
