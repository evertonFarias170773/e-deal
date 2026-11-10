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
 * - Para: as formas internas da família faturado (Faturado, E-Permuta,
 *   E-Amostra, E-Retrabalho — ver DESTINOS_DA_TROCA). Nascem sem nada fora do
 *   Vibe (os boletos do faturado só existem depois, no Registro de
 *   Recebíveis). É isso que permite criar a nova ANTES de cancelar a antiga e
 *   desfazer a nova se o banco não confirmar.
 *
 * A rota é `src/app/api/cobrancas/trocar-forma-pagamento/route.ts`.
 */
import { formatCurrency } from "@/lib/formatters/currency";
import { getLocalDateInSaoPaulo } from "@/features/cobrancas/cobrancas-utils";
import { TODAS_AS_RECUSAS, type CodigoVeredito } from "@/features/cobrancas/cancelamento-elegibilidade";
import { recusaDoTipoNoPedido, type ContextoRetrabalhoDoPedido } from "@/features/cobrancas/lib/tipo-x-retrabalho";

/** Empresas cujo PIX sai pelo C6, com confirmação do banco no cancelamento. */
export const EMPRESAS_DA_TROCA: readonly number[] = [1, 3];

/** Forma de origem aceita. */
export const TIPO_DE_ORIGEM_DA_TROCA = "PIX";

/** Forma de destino padrão (a única até 10/11/2026). */
export const TIPO_DE_DESTINO_DA_TROCA = "E-FATURADO";

export type TipoDestinoDaTroca = "E-FATURADO" | "E-PERMUTA" | "E-AMOSTRA" | "E-RETRABALHO" | "E-CREDITO";

export type DestinoDaTroca = {
  tipo: TipoDestinoDaTroca;
  rotulo: string;
  /** Faturado e E-Permuta pedem condição, como no Gerar cobrança; cortesia não. */
  exigeCondicao: boolean;
  /** E-Crédito: nasce paga, consumindo o saldo de crédito do cliente. */
  consomeCredito?: boolean;
};

/**
 * Formas internas aceitas como destino (10/11/2026): a família faturado do
 * Gerar cobrança e o E-Crédito. Nenhuma passa por banco.
 * - Família faturado: não consome nada ao nascer; desfazer é cancelá-la.
 * - E-Crédito: nasce paga e consome o crédito do cliente (pendências mais
 *   antigas primeiro, depois o avulso, como em usar-credito). Só vale se o
 *   saldo cobrir o valor inteiro. Desfazer é a função do banco
 *   `mc_desfazer_credito_da_troca`, que devolve exatamente o que a troca
 *   consumiu e cancela a cobrança, numa transação só.
 *
 * Fora, de propósito: boleto, PIX novo e cartão, que nascem no banco.
 */
export const DESTINOS_DA_TROCA: readonly DestinoDaTroca[] = [
  { tipo: "E-FATURADO", rotulo: "Faturado", exigeCondicao: true },
  { tipo: "E-PERMUTA", rotulo: "E-Permuta", exigeCondicao: true },
  { tipo: "E-AMOSTRA", rotulo: "E-Amostra", exigeCondicao: false },
  { tipo: "E-RETRABALHO", rotulo: "E-Retrabalho", exigeCondicao: false },
  { tipo: "E-CREDITO", rotulo: "E-Crédito", exigeCondicao: false, consomeCredito: true }
];

/** Saldo cobre o valor? Em centavos, sem sobra de ponto flutuante. */
export function saldoCobreOValor(saldo: number, valor: number): boolean {
  return Math.round(saldo * 100) >= Math.round(valor * 100);
}

export type FatiaDoCredito = { idPendencia: number | null; centavos: number };

/**
 * Como o crédito é consumido: pendências a favor do cliente, mais antigas
 * primeiro, e o resto no crédito avulso (a mesma ordem de usar-credito).
 */
export function fatiasDoConsumo(
  valorCentavos: number,
  pendencias: { id: number; valor_saldo: number | string }[]
): FatiaDoCredito[] {
  const fatias: FatiaDoCredito[] = [];
  let restante = valorCentavos;
  for (const p of pendencias) {
    if (restante <= 0) break;
    const saldo = Math.round(Number(p.valor_saldo) * 100);
    const fatia = Math.min(restante, saldo);
    if (fatia < 1) continue;
    fatias.push({ idPendencia: p.id, centavos: fatia });
    restante -= fatia;
  }
  if (restante > 0) fatias.push({ idPendencia: null, centavos: restante });
  return fatias;
}

/** O destino pelo tipo pedido; vazio é Faturado (o corpo antigo da rota). */
export function destinoDaTroca(tipo: unknown): DestinoDaTroca | null {
  const texto = String(tipo ?? "").trim();
  const alvo = texto ? texto.toUpperCase().replace(/_/g, "-") : TIPO_DE_DESTINO_DA_TROCA;
  return DESTINOS_DA_TROCA.find((d) => d.tipo === alvo) ?? null;
}

/**
 * As formas que o pedido aceita, pela mesma regra do gatilho do retrabalho:
 * E-Retrabalho só em retrabalho, e retrabalho só com E-Retrabalho. Sem o
 * contexto, esconde só a E-Retrabalho (o banco recusa o resto, se for o caso).
 */
export function destinosPermitidosNoPedido(contexto: ContextoRetrabalhoDoPedido | null): DestinoDaTroca[] {
  return DESTINOS_DA_TROCA.filter((d) =>
    contexto ? recusaDoTipoNoPedido(d.tipo, contexto) === null : d.tipo !== "E-RETRABALHO"
  );
}

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
  /** uuid da antiga: referência da descrição quando não há id_pagamento. */
  id?: string | null;
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
  modelo: ModeloDaTroca | null,
  agora: Date = new Date(),
  destino: DestinoDaTroca = DESTINOS_DA_TROCA[0]
): Record<string, unknown> {
  const valor = Math.round(Number(antiga.valor) * 100) / 100;
  const hoje = getLocalDateInSaoPaulo(agora);
  // A função do banco que desfaz o E-Crédito confere esta referência.
  const referencia = antiga.id_pagamento || antiga.id || "anterior";
  if (!destino.exigeCondicao || !modelo) {
    // Cortesia (E-Amostra, E-Retrabalho) e E-Crédito: sem condição, como no
    // Gerar cobrança — nulo em forma_fatu, forma_pgto, id_modelo_cobranca e
    // nos p_*. O E-Crédito nasce PAID (o crédito sai do saldo na hora) e não
    // confirmado: conferir é do Financeiro, como em usar-credito.
    const credito = destino.consomeCredito === true;
    return {
      id_int: antiga.id_int,
      id_cliente: antiga.id_cliente,
      cliente: antiga.cliente,
      documento: antiga.documento,
      valor,
      status: credito ? "PAID" : "A_VENCER",
      tipo_cobranca: destino.tipo,
      empresa: antiga.empresa,
      id_empresa: antiga.id_empresa,
      os_ideal: antiga.os_ideal,
      atendente: antiga.atendente,
      descricao: `Cobrança ${destino.tipo} da proposta #${antiga.id_int} (troca da ${referencia})`,
      vencimento: hoje,
      obs_v2: antiga.obs_v2,
      confirmado: false,
      forma_fatu: null,
      forma_pgto: null,
      id_modelo_cobranca: null,
      p_valor_entrada: null,
      p_qtd_parcelas: null,
      p_dias_pra_inicio: null,
      p_intervalo: null,
      paid_at: credito ? agora.toISOString() : null
    };
  }
  const entrada = Number(modelo.entrada_porcento ?? 0);
  return {
    id_int: antiga.id_int,
    id_cliente: antiga.id_cliente,
    cliente: antiga.cliente,
    documento: antiga.documento,
    valor,
    status: "A_VENCER",
    tipo_cobranca: destino.tipo,
    empresa: antiga.empresa,
    id_empresa: antiga.id_empresa,
    os_ideal: antiga.os_ideal,
    atendente: antiga.atendente,
    descricao: `Cobrança ${destino.tipo} da proposta #${antiga.id_int} (troca da ${referencia})`,
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

/** "Faturado (30 DIAS)" ou só "E-Amostra", quando não há condição. */
function descreverForma(rotulo: string | undefined, condicao: string | null): string {
  const nome = rotulo ?? "Faturado";
  return condicao ? `${nome} (${condicao})` : nome;
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
  condicao: string | null;
  rotulo?: string;
}): string {
  const forma = descreverForma(entrada.rotulo, entrada.condicao);
  return `Trocada por ${forma}, cobrança ${entrada.novaIdPagamento}, por ${entrada.autor}. Motivo: ${entrada.motivo}`;
}

/** `motivo_cancela` da antiga. */
export function motivoCancelaDaAntiga(novaIdPagamento: string, motivo: string, rotulo = "Faturado"): string {
  return `Troca de forma de pagamento: substituída pela cobrança ${novaIdPagamento} (${rotulo}). Motivo: ${motivo}`;
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
  condicao: string | null;
  valor: number;
  motivo: string;
  rotulo?: string;
}): string {
  const rotulo = entrada.rotulo ?? "Faturado";
  return (
    `Forma de pagamento trocada por ${entrada.autor} (${entrada.permissao}): ` +
    `cobrança ${entrada.antigaIdPagamento} (PIX) cancelada e substituída pela ${entrada.novaIdPagamento} ` +
    `(${entrada.condicao ? `${rotulo}, ${entrada.condicao}` : rotulo}), mesmo valor ${formatCurrency(entrada.valor)}. ` +
    `Nota fiscal mantida. Motivo: ${entrada.motivo}`
  );
}

/** A linha do Histórico quando a troca é desfeita. */
export function mensagemHistoricoDaTrocaDesfeita(entrada: {
  antigaIdPagamento: string;
  novaIdPagamento: string;
  autor: string;
  motivo: string;
  rotulo?: string;
}): string {
  return (
    `Troca de forma de pagamento não concluída (tentada por ${entrada.autor}): o banco não confirmou o cancelamento do PIX ` +
    `${entrada.antigaIdPagamento}, que continua ativo. A cobrança ${entrada.novaIdPagamento} (${entrada.rotulo ?? "Faturado"}) foi cancelada. ` +
    `Motivo da troca: ${entrada.motivo}`
  );
}
