/**
 * Ponto ÚNICO de decisão: "esta cobrança pode ser cancelada?", com o motivo.
 *
 * Regras puras, sem I/O e sem React — o coletor server-side monta o dossiê e
 * chama daqui; as rotas e a tela consomem o mesmo veredito. É isso que impede
 * a divergência que existia entre `CobrancasProvider` (que recusava no
 * navegador, sem nenhuma requisição sair), `cancelar-externo`, `cancelar-pago`
 * e `cancelar-boleto-faturado` — quatro lugares que discordavam sobre o que é
 * "efetivado".
 *
 * Spec: docs/superpowers/specs/2026-08-25-cancelamento-cobranca-refaturamento-design.md
 */
import { formatCurrency } from "@/lib/formatters/currency";
import { getLocalDateInSaoPaulo } from "@/features/cobrancas/cobrancas-utils";
import {
  bloqueiaCancelamentoPago,
  mensagemBloqueioProducao,
  tipoCobrancaBloqueiaCancelamentoPago,
  type PropostaParaBloqueioCancelamento
} from "@/features/cobrancas/cancelamento-pago";

/** Status de `pagamentos_v2` que já representam cobrança inativa. */
const STATUS_INATIVOS = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

export type CodigoVeredito =
  | "OK"
  | "JA_INATIVA"
  | "COBRANCA_RECEBIDA"
  | "TITULO_LIQUIDADO"
  | "NOTA_AUTORIZADA"
  | "PRODUCAO_ATIVA"
  | "VINCULO_AMBIGUO"
  | "CREDITO_CONSUMIDO"
  | "TITULO_EM_ABERTO";

/** Para onde o modal manda o usuário quando recusa. */
export type AcaoSugerida =
  | "CANCELAR_NOTA"
  | "DEVOLVER_OS"
  | "RETIRAR_PRODUCAO"
  | "CANCELAR_TITULO"
  | "ABRIR_DEVOLUCAO"
  | "CONFERIR_MANUAL";

export type CobrancaParaElegibilidade = {
  id: string;
  id_int: number | null;
  id_pagamento: string | null;
  status: string | null;
  confirmado: boolean | null;
  tipo_cobranca: string | null;
  paid_at: string | null;
  data_confirmacao: string | null;
};

export type TituloParaElegibilidade = {
  id: string;
  parcela: number | null;
  total_parcelas: number | null;
  valor: number | null;
  vencimento: string | null;
  status: string | null;
  paid_at: string | null;
  id_empresa: number | null;
  id_boleto_c6: string | null;
};

export type NotaParaElegibilidade = {
  tipo: "NFE" | "NFSE";
  numero: string | null;
  status: string | null;
  ambiente: string | null;
};

/**
 * Tudo que a decisão precisa, já lido do banco. O coletor é quem sabe buscar;
 * aqui só se decide.
 */
export type DossieCancelamento = {
  cobranca: CobrancaParaElegibilidade;
  proposta: PropostaParaBloqueioCancelamento | null;
  /** Títulos vinculados à cobrança — inclui os achados pelo fallback legado. */
  titulos: TituloParaElegibilidade[];
  /** Notas da PROPOSTA (não há vínculo nota↔cobrança no banco). */
  notas: NotaParaElegibilidade[];
  /**
   * Há título legado sem `id_pagamento` E a proposta tem mais de uma cobrança
   * faturada: não dá para saber de quem é o título. O coletor decide isso.
   */
  vinculoAmbiguo: boolean;
};

export type Recusa = {
  code: CodigoVeredito;
  message: string;
  acao?: AcaoSugerida;
};

export type VereditoCancelamento = {
  pode: boolean;
  code: CodigoVeredito;
  message: string;
  acao?: AcaoSugerida;
  /**
   * `PAGO` = dinheiro efetivamente recebido, atendido pela rota excepcional
   * `cancelar-pago` (super admin, motivo de catálogo, destino do valor).
   * Serve para ROTEAR, nunca para decidir se pode.
   */
  fluxo: "NORMAL" | "PAGO";
  /**
   * Motivo da recusa `TITULO_EM_ABERTO` — NUNCA lista de ação. O fluxo é em
   * três passos: o título é cancelado numa ação própria do usuário, em Contas
   * a Receber. Nenhuma rota cancela título em cascata.
   */
  titulosEmAberto: TituloParaElegibilidade[];
  /** Todas as recusas aplicáveis, em ordem — para o chamador que respeita só um subconjunto. */
  recusas: Recusa[];
  /**
   * Cobrança já inativa. `pode` é false, mas as rotas tratam como SUCESSO
   * no-op (idempotência de duplo clique), não como recusa.
   */
  jaInativa: boolean;
};

/**
 * ORDEM das recusas — ela decide qual mensagem o usuário lê quando mais de uma
 * se aplica. Primeiro o que nenhuma ação dele destrava, depois o que ele mesmo
 * resolve, depois o que depende de terceiros, e por último a instrução de
 * fluxo.
 *
 * `TITULO_EM_ABERTO` é a ÚLTIMA de propósito: é a única que é instrução, não
 * impedimento. Se viesse antes, uma proposta em produção com título em aberto
 * ouviria "cancele o título primeiro" — conselho errado, porque o título não é
 * o problema.
 */
export const TODAS_AS_RECUSAS: readonly CodigoVeredito[] = [
  "COBRANCA_RECEBIDA",
  "TITULO_LIQUIDADO",
  "NOTA_AUTORIZADA",
  "PRODUCAO_ATIVA",
  "VINCULO_AMBIGUO",
  "CREDITO_CONSUMIDO",
  "TITULO_EM_ABERTO"
];

/**
 * Subconjunto de `/api/orcamentos/cancelar-proposta`: cancelar a proposta é
 * ENCERRAR O PEDIDO, não refaturar. Nota autorizada e produção ativa existem
 * para proteger o refaturamento e não bloqueiam aquela rota; o que bloqueia é
 * dinheiro já recebido.
 */
export const RECUSAS_DE_DINHEIRO: readonly CodigoVeredito[] = [
  "COBRANCA_RECEBIDA",
  "TITULO_LIQUIDADO"
];

/**
 * Subconjunto de `/api/cobrancas/cancelar-pago` — o fluxo excepcional da
 * cobrança JÁ PAGA (super admin, motivo de catálogo, destino do valor).
 *
 * Ali o dinheiro recebido é a PREMISSA, não o impedimento: aquela rota existe
 * justamente para cancelar o que já foi pago e dizer para onde o valor vai
 * (devolvido, crédito, ou mantido). Então `COBRANCA_RECEBIDA` e
 * `TITULO_LIQUIDADO` não se aplicam — são duas formas de afirmar o mesmo fato
 * que a rota trata.
 *
 * Aplicar `TITULO_LIQUIDADO` ali recusaria **150 dos 182 boletos pagos** e
 * mais 20 PIX (medido em 25/08/2026), com uma mensagem invertida: "vira
 * devolução, não cancele por aqui" dita justamente pelo fluxo de devolução.
 *
 * `CREDITO_CONSUMIDO` também fica de fora porque a rota já tem bloqueio
 * próprio de tipo (`tipoCobrancaBloqueiaCancelamentoPago`), com mensagem e
 * código específicos. E `TITULO_EM_ABERTO` é da família faturado, que aquela
 * rota recusa antes por tipo.
 *
 * O que ela GANHA do veredito: nota fiscal autorizada — que nenhuma rota de
 * cancelamento verificava — e a regra de produção, que passa a ser
 * compartilhada em vez de viver só ali.
 */
export const RECUSAS_COBRANCA_PAGA: readonly CodigoVeredito[] = [
  "NOTA_AUTORIZADA",
  "PRODUCAO_ATIVA"
];

/**
 * Subconjunto de `/api/cobrancas/cancelar-boleto-faturado` — o PASSO 1, que
 * cancela UM título e mantém a cobrança viva.
 *
 * É operação de título, não de cobrança, e isso define o que pode barrá-la:
 * só a cobrança-mãe já liquidada. As demais recusas ou não se aplicam ou
 * bloqueariam uso legítimo:
 *
 * - `TITULO_LIQUIDADO` tem granularidade de COBRANÇA ("algum título pago"),
 *   e aqui a pergunta é sobre o título ALVO. Num faturado de 3 parcelas com a
 *   primeira paga, ele impediria cancelar a terceira — 2 casos reais em
 *   25/08/2026. A checagem do alvo continua na própria rota, que é onde a
 *   granularidade existe;
 * - `NOTA_AUTORIZADA` e `PRODUCAO_ATIVA` bloqueariam o "cancelar título para
 *   reemitir", que é o uso normal — inclusive no fluxo de salvar orçamento,
 *   que chama esta mesma rota. Cancelar um boleto não invalida NF-e, e estar
 *   em produção não congela a forma de pagamento. Medido: dos 58 faturados
 *   com título aberto hoje, ZERO estão em produção e ZERO têm nota de
 *   produção — não bloqueariam nada agora, e quebrariam o fluxo depois;
 * - `TITULO_EM_ABERTO` seria absurdo: cancelar o título aberto é o serviço;
 * - `VINCULO_AMBIGUO` e `CREDITO_CONSUMIDO` não se aplicam a título.
 */
export const RECUSAS_CANCELAMENTO_TITULO: readonly CodigoVeredito[] = [
  "COBRANCA_RECEBIDA"
];

function normalizar(valor: string | null | undefined): string {
  return String(valor || "").trim().toUpperCase();
}

/**
 * Família faturado — a modalidade em que o título é artefato SEPARADO da
 * cobrança (Registro de Recebíveis), com ação própria de cancelamento.
 *
 * Vive aqui, e não no coletor, porque é regra de decisão: é ela que define a
 * quem a recusa `TITULO_EM_ABERTO` se aplica.
 *
 * O banco guarda duas grafias — "E-Faturado" e "E-FATURADO". A comparação é
 * sobre o valor normalizado (caixa, espaços e underscore), nunca igualdade
 * literal, para uma grafia nova não furar a checagem em silêncio.
 *
 * NÃO consolida as três definições divergentes que já existem no módulo
 * (`isCobrancaEFaturado`, `TIPOS_SEM_LINK_EXTERNO`, a lista em
 * `pagamentos-v2.service.ts:159`) — isso é trabalho da Etapa 12 do plano.
 */
const FAMILIA_FATURADO = new Set(["E-FATURADO", "EFATURADO", "FATURADO"]);

export function isFamiliaFaturado(tipo: string | null | undefined): boolean {
  return FAMILIA_FATURADO.has(String(tipo || "").trim().toUpperCase().replace(/_/g, "-"));
}

/** "2026-08-30" -> "30/08/2026", sem passar por Date (evita deslocar um dia). */
function formatarDataIso(valor: string | null | undefined): string {
  const texto = String(valor || "").slice(0, 10);
  const [ano, mes, dia] = texto.split("-");
  if (!ano || !mes || !dia) return "";
  return `${dia}/${mes}/${ano}`;
}

/** Timestamp -> "12/08/2026" no fuso de São Paulo. */
function formatarTimestamp(valor: string | null | undefined): string {
  return formatarDataIso(getLocalDateInSaoPaulo(valor));
}

/** "1/3" quando há parcelas conhecidas; string vazia quando não há. */
function rotuloParcela(titulo: TituloParaElegibilidade): string {
  if (titulo.parcela == null) return "";
  return titulo.total_parcelas != null
    ? `${titulo.parcela}/${titulo.total_parcelas}`
    : String(titulo.parcela);
}

/** Título liquidado: baixa registrada OU status PAID. Os dois contam. */
export function isTituloLiquidado(titulo: TituloParaElegibilidade): boolean {
  return titulo.paid_at != null || normalizar(titulo.status) === "PAID";
}

/** Título que ainda vive no banco: nem cancelado, nem liquidado. */
export function isTituloEmAberto(titulo: TituloParaElegibilidade): boolean {
  const status = normalizar(titulo.status);
  if (status === "CANCELADO" || status === "CANCELADA") return false;
  return !isTituloLiquidado(titulo);
}

/**
 * Nota que impede o cancelamento: AUTORIZADA e de PRODUÇÃO.
 *
 * O filtro de ambiente não é detalhe: hoje as 10 notas do banco são de
 * `homologacao` (5 NF-e + 5 NFS-e AUTORIZADA). Sem ele, a regra bloquearia
 * cancelamento por nota de teste.
 */
export function isNotaImpeditiva(nota: NotaParaElegibilidade): boolean {
  return normalizar(nota.status) === "AUTORIZADA" && normalizar(nota.ambiente) === "PRODUCAO";
}

/**
 * Dinheiro efetivamente recebido NA COBRANÇA. `A_VENCER` com `confirmado` NÃO
 * entra: é faturamento aprovado, recebimento futuro autorizado — e é
 * exatamente o caso que este fluxo passa a permitir cancelar (regra 4).
 */
function cobrancaFoiRecebida(cobranca: CobrancaParaElegibilidade): boolean {
  return normalizar(cobranca.status) === "PAID" || cobranca.paid_at != null;
}

function montarRecusas(dossie: DossieCancelamento): Recusa[] {
  const { cobranca, proposta, titulos, notas } = dossie;
  const recusas: Recusa[] = [];

  // 1. Dinheiro já recebido — nada que o usuário faça destrava.
  if (cobrancaFoiRecebida(cobranca)) {
    const quando = formatarTimestamp(cobranca.paid_at || cobranca.data_confirmacao);
    recusas.push({
      code: "COBRANCA_RECEBIDA",
      message:
        `Esta cobrança já foi recebida${quando ? ` em ${quando}` : ""}. ` +
        "Cancelar não devolve o dinheiro — o caso é devolução, não cancelamento.",
      acao: "ABRIR_DEVOLUCAO"
    });
  }

  const liquidados = titulos.filter(isTituloLiquidado);
  if (liquidados.length > 0) {
    const titulo = liquidados[0];
    const parcela = rotuloParcela(titulo);
    const valor = titulo.valor != null ? ` (${formatCurrency(Number(titulo.valor))})` : "";
    const quando = formatarTimestamp(titulo.paid_at);
    recusas.push({
      code: "TITULO_LIQUIDADO",
      message:
        `O título${parcela ? ` ${parcela}` : ""} desta cobrança${valor} foi liquidado` +
        `${quando ? ` em ${quando}` : ""}. ` +
        "A cobrança inteira vira devolução — não cancele por aqui.",
      acao: "ABRIR_DEVOLUCAO"
    });
  }

  // 2. Nota fiscal antes de produção: tem prazo legal (24h SEFAZ) e a tarefa é
  //    do próprio financeiro/fiscal, enquanto devolver a OS depende do gerente.
  const notaImpeditiva = notas.find(isNotaImpeditiva);
  if (notaImpeditiva) {
    const rotulo = notaImpeditiva.tipo === "NFSE" ? "NFS-e" : "NF-e";
    const numero = notaImpeditiva.numero ? ` nº ${notaImpeditiva.numero}` : "";
    const proposta_ = cobranca.id_int != null ? `A proposta ${cobranca.id_int}` : "Esta proposta";
    recusas.push({
      code: "NOTA_AUTORIZADA",
      message:
        `${proposta_} tem ${rotulo}${numero} autorizada. ` +
        "Cancele a nota em Fiscal › Notas Fiscais antes de cancelar a cobrança.",
      acao: "CANCELAR_NOTA"
    });
  }

  // 3. Produção ativa — regra que já existia, mas só valia no cancelar-pago.
  //    Reusa a mensagem de lá, que já distingue "devolver para REVISAO
  //    ATENDENTE" de "retirar da produção".
  if (proposta && bloqueiaCancelamentoPago(proposta)) {
    recusas.push({
      code: "PRODUCAO_ATIVA",
      message: mensagemBloqueioProducao(cobranca.id_int, proposta),
      acao: proposta.is_prd_aprovado === true ? "RETIRAR_PRODUCAO" : "DEVOLVER_OS"
    });
  }

  // 4. Não dá para saber de quem é o título. Recusa conservadora: o custo de
  //    errar aqui é cancelar cobrança cujo título foi pago.
  if (dossie.vinculoAmbiguo) {
    recusas.push({
      code: "VINCULO_AMBIGUO",
      message:
        "Não foi possível identificar com segurança quais títulos pertencem a esta cobrança " +
        "(registro antigo, sem vínculo gravado). Peça conferência manual antes de cancelar.",
      acao: "CONFERIR_MANUAL"
    });
  }

  // 5. E-CREDITO: cancelar não estorna o crédito já consumido da conta
  //    corrente. E-FATURADO NÃO entra aqui — é o caso que passa (regra 4).
  if (tipoCobrancaBloqueiaCancelamentoPago(cobranca.tipo_cobranca) === "E-CREDITO") {
    recusas.push({
      code: "CREDITO_CONSUMIDO",
      message:
        "Cobrança paga com crédito do cliente: o cancelamento não estorna o crédito consumido. " +
        "Use o estorno de crédito.",
      acao: "CONFERIR_MANUAL"
    });
  }

  // 6. Instrução de fluxo, sempre por último — e SÓ para a família faturado.
  //
  //    Em BOLETO, PIX e cartão o título e a cobrança são o MESMO ato: quem
  //    cancela a cobrança cancela o título junto, no provedor e no registro,
  //    numa operação só (é o que `cancelar-externo` sempre fez). Recusar ali
  //    quebraria o cancelamento de boleto comum — medido em 25/08/2026: 4
  //    cobranças BOLETO ativas têm título vinculado em aberto — e a mensagem
  //    seria absurda, porque manda "cancelar o título primeiro em Contas a
  //    Receber" para algo que não tem existência separada.
  //
  //    No faturado é o oposto: o título é artefato do Registro de Recebíveis,
  //    com ação própria ("Cancelar recebível"), e o fluxo é em três passos.
  //
  //    `TITULO_LIQUIDADO` (acima) NÃO tem essa restrição e vale para todos os
  //    tipos: título pago é dinheiro recebido em qualquer modalidade, e as
  //    rotas já bloqueavam isso antes desta spec.
  const emAberto = isFamiliaFaturado(cobranca.tipo_cobranca) ? titulos.filter(isTituloEmAberto) : [];
  if (emAberto.length > 0) {
    const titulo = emAberto[0];
    const parcela = rotuloParcela(titulo);
    const valor = titulo.valor != null ? formatCurrency(Number(titulo.valor)) : "";
    const vence = formatarDataIso(titulo.vencimento);
    const detalhe = [valor, vence ? `vence ${vence}` : ""].filter(Boolean).join(", ");
    const sufixo = emAberto.length > 1 ? ` e mais ${emAberto.length - 1} em aberto` : "";
    recusas.push({
      code: "TITULO_EM_ABERTO",
      message:
        `Esta cobrança tem o título${parcela ? ` ${parcela}` : ""}` +
        `${detalhe ? ` (${detalhe})` : ""} em aberto no banco${sufixo}. ` +
        "Cancele o título primeiro em Contas a Receber — a cobrança continua ativa " +
        "e volta para o Registro de Recebíveis.",
      acao: "CANCELAR_TITULO"
    });
  }

  return recusas;
}

const VEREDITO_OK: Recusa = {
  code: "OK",
  message: "Cobrança pode ser cancelada."
};

/**
 * Avalia o dossiê e devolve o veredito.
 *
 * `aplicaveis` permite ao chamador respeitar só um subconjunto das recusas —
 * hoje só `cancelar-proposta` usa isso (`RECUSAS_DE_DINHEIRO`). A ordem de
 * `TODAS_AS_RECUSAS` continua valendo dentro do subconjunto. O que nenhum
 * chamador pode fazer é inventar recusa própria: regra nova nasce aqui.
 */
export function avaliarCancelamento(
  dossie: DossieCancelamento,
  aplicaveis: readonly CodigoVeredito[] = TODAS_AS_RECUSAS
): VereditoCancelamento {
  const { cobranca, titulos } = dossie;
  const titulosEmAberto = titulos.filter(isTituloEmAberto);

  // Roteamento, não permissão: diz QUAL rota/formulário atende, mesmo quando
  // o veredito recusa.
  const fluxo: "NORMAL" | "PAGO" = cobrancaFoiRecebida(cobranca) ? "PAGO" : "NORMAL";

  // Idempotência primeiro: cobrança já inativa não é recusa, é no-op. Vem
  // antes de tudo para o duplo clique nunca produzir mensagem de erro.
  if (STATUS_INATIVOS.includes(normalizar(cobranca.status))) {
    return {
      pode: false,
      code: "JA_INATIVA",
      message: "Cobrança já estava cancelada. Nenhuma ação executada.",
      fluxo,
      titulosEmAberto,
      recusas: [],
      jaInativa: true
    };
  }

  const todas = montarRecusas(dossie);
  const respeitadas = todas.filter((r) => aplicaveis.includes(r.code));
  const primeira = respeitadas[0] ?? VEREDITO_OK;

  return {
    pode: respeitadas.length === 0,
    code: primeira.code,
    message: primeira.message,
    ...(primeira.acao ? { acao: primeira.acao } : {}),
    fluxo,
    titulosEmAberto,
    // Todas as aplicáveis, não só as respeitadas: quem aplica um subconjunto
    // ainda consegue registrar em log o que ignorou.
    recusas: todas,
    jaInativa: false
  };
}
