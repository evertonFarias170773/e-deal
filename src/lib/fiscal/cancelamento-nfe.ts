/**
 * Cancelamento de NF-e — a regra de quando a nota vira CANCELADA no Vibe.
 *
 * POR QUE EXISTE (27/10/2026)
 *   Até aqui a tela de Notas fiscais lia a resposta da integração com
 *   `parseFocusResponse` (feita para a carta de correção), que só procura sinal
 *   de ERRO. A Focus que recusa um cancelamento devolve a nota como ela está —
 *   `status: "autorizado"`, `status_sefaz: "100"` — e isso não é erro: passou
 *   como sucesso, e a tela gravou CANCELADA. Foi o que aconteceu com 3 notas em
 *   outubro (NFE-23138-001, NFE-23564-002 e NFE-23702-001), que seguem
 *   autorizadas na SEFAZ.
 *
 *   A regra agora é positiva: só é cancelamento o que a Focus confirma com
 *   `status: "cancelado"`, `status_sefaz` 135 (evento registrado e vinculado) ou
 *   155 (cancelamento homologado fora de prazo) E o caminho do XML do evento.
 *   Qualquer outra resposta é falha — a nota continua AUTORIZADA.
 *
 *   Módulo sem dependências: a rota decide com ele e o teste prova com os
 *   retornos reais gravados (scripts/testes/cancelamento-nfe.test.mts).
 */

/** Códigos da SEFAZ que confirmam o evento de cancelamento. */
export const CSTAT_CANCELAMENTO_CONFIRMADO = ["135", "155"] as const;

/** Prazo de cancelamento contado da autorização (regra autorizada em 27/10/2026). */
export const PRAZO_CANCELAMENTO_HORAS = 24;

export const MENSAGEM_FORA_DO_PRAZO =
  `O prazo de ${PRAZO_CANCELAMENTO_HORAS} horas para cancelar esta NF-e já passou. ` +
  "O Vibe não envia o pedido à SEFAZ fora do prazo. Procure a contabilidade para definir o caminho " +
  "(por exemplo, nota de devolução ou cancelamento extemporâneo junto à SEFAZ).";

export const MENSAGEM_SEM_DATA_AUTORIZACAO =
  "Esta NF-e não tem a data de autorização registrada no Vibe, então não dá para conferir o prazo de cancelamento. " +
  "O Vibe não envia o pedido à SEFAZ sem essa conferência. Procure a contabilidade.";

export const MENSAGEM_JA_CANCELADA =
  "Esta nota já tem cancelamento confirmado pela SEFAZ registrado no Vibe. Nada foi enviado de novo.";

export type PrazoDoCancelamento =
  | { dentro: true; limite: Date }
  | { dentro: false; motivo: "SEM_DATA_AUTORIZACAO"; mensagem: string }
  | { dentro: false; motivo: "FORA_DO_PRAZO"; limite: Date; mensagem: string };

/** A nota pode ter o cancelamento pedido agora? Sem data de autorização, não. */
export function prazoDoCancelamento(dataAutorizacao: string | null | undefined, agora: Date): PrazoDoCancelamento {
  const texto = String(dataAutorizacao ?? "").trim();
  const autorizada = texto ? new Date(texto) : null;
  if (!autorizada || Number.isNaN(autorizada.getTime())) {
    return { dentro: false, motivo: "SEM_DATA_AUTORIZACAO", mensagem: MENSAGEM_SEM_DATA_AUTORIZACAO };
  }
  const limite = new Date(autorizada.getTime() + PRAZO_CANCELAMENTO_HORAS * 60 * 60 * 1000);
  if (agora.getTime() >= limite.getTime()) {
    return { dentro: false, motivo: "FORA_DO_PRAZO", limite, mensagem: MENSAGEM_FORA_DO_PRAZO };
  }
  return { dentro: true, limite };
}

/** Os campos da Focus que a decisão e o registro usam. */
export type RetornoFocus = Record<string, unknown> & {
  status?: unknown;
  status_sefaz?: unknown;
  codigo_status_sefaz?: unknown;
  mensagem_sefaz?: unknown;
  caminho_xml_cancelamento?: unknown;
};

function tentarJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

/**
 * Desembrulha o que o webhook devolve até chegar ao objeto da Focus.
 * Os mesmos embrulhos que a tela tratava: lista, `body`, `payload_retorno`,
 * `data` (texto JSON ou objeto) e o próprio texto JSON.
 */
export function retornoDaFocus(bruto: unknown): RetornoFocus | null {
  let atual: unknown = typeof bruto === "string" ? tentarJson(bruto) : bruto;
  if (Array.isArray(atual)) atual = atual[0];
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

  if (obj(atual)?.body !== undefined) atual = obj(atual)!.body;
  if (typeof atual === "string") atual = tentarJson(atual);
  if (obj(atual)?.payload_retorno !== undefined) atual = obj(atual)!.payload_retorno;
  const dado = obj(atual)?.data;
  if (typeof dado === "string") atual = tentarJson(dado);
  else if (dado && typeof dado === "object") atual = dado;
  if (typeof atual === "string") atual = tentarJson(atual);
  if (Array.isArray(atual)) atual = atual[0];

  return obj(atual) as RetornoFocus | null;
}

const texto = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v).trim();
  return s || null;
};

export type DesfechoDoCancelamento =
  | {
      confirmado: true;
      focus: RetornoFocus;
      statusFocus: string;
      statusSefaz: string;
      mensagemSefaz: string | null;
      caminhoXml: string;
    }
  | {
      confirmado: false;
      focus: RetornoFocus | null;
      statusFocus: string | null;
      statusSefaz: string | null;
      mensagemSefaz: string | null;
      /** O que a tela mostra: diz que a nota continua autorizada e o motivo da Focus. */
      mensagem: string;
    };

/** A decisão: só é cancelamento o que a Focus confirma por inteiro. */
export function desfechoDoCancelamento(bruto: unknown): DesfechoDoCancelamento {
  const focus = retornoDaFocus(bruto);
  const statusFocus = texto(focus?.status)?.toLowerCase() ?? null;
  const statusSefaz = texto(focus?.status_sefaz) ?? texto(focus?.codigo_status_sefaz);
  const mensagemSefaz =
    texto(focus?.mensagem_sefaz) ?? texto((focus as Record<string, unknown> | null)?.mensagem) ?? null;
  const caminhoXml = texto(focus?.caminho_xml_cancelamento);

  if (
    focus &&
    statusFocus === "cancelado" &&
    statusSefaz !== null &&
    (CSTAT_CANCELAMENTO_CONFIRMADO as readonly string[]).includes(statusSefaz) &&
    caminhoXml
  ) {
    return { confirmado: true, focus, statusFocus, statusSefaz, mensagemSefaz, caminhoXml };
  }

  return {
    confirmado: false,
    focus,
    statusFocus,
    statusSefaz,
    mensagemSefaz,
    mensagem: mensagemDaRecusa(statusFocus, statusSefaz, mensagemSefaz, caminhoXml)
  };
}

function mensagemDaRecusa(
  statusFocus: string | null,
  statusSefaz: string | null,
  mensagemSefaz: string | null,
  caminhoXml: string | null
): string {
  const base = "A SEFAZ não confirmou o cancelamento. A nota continua AUTORIZADA.";
  if (!statusFocus && !statusSefaz && !mensagemSefaz) {
    return `${base} A integração fiscal não devolveu o resultado do pedido. Confira a nota antes de tentar de novo.`;
  }
  const partes: string[] = [];
  if (statusFocus) partes.push(`status na Focus: ${statusFocus}`);
  if (statusSefaz) partes.push(`código SEFAZ: ${statusSefaz}`);
  if (mensagemSefaz) partes.push(`mensagem: ${mensagemSefaz}`);
  if (statusFocus === "cancelado" && !caminhoXml) partes.push("sem o XML do evento de cancelamento");
  return `${base} Resposta recebida — ${partes.join("; ")}.`;
}

/** Status do evento gravado quando o cancelamento não se confirma. */
export const STATUS_EVENTO_FALHA = "falha";

export type EventoCancelamento = {
  tipo_documento: "NFE";
  ref: string;
  tipo_evento: "CANCELAMENTO";
  status_evento: string;
  status_sefaz: string | null;
  mensagem_sefaz: string | null;
  caminho_xml: string | null;
  caminho_pdf: string | null;
  justificativa: string;
  payload_envio: { id_empresa: number; referencia: string; justificativa: string };
  payload_retorno: Record<string, unknown> | null;
  origem: "FOCUS_CANCELAMENTO";
  criado_por: string | null;
  criado_por_nome: string | null;
};

/**
 * A linha de `notas_eventos`. Confirmado: `status_evento` "cancelado" com o
 * caminho do XML (é o que o relatório e o fluxo de cópia do XML leem). Falha:
 * `status_evento` "falha", sem caminho — nenhum dos dois lê essa linha como
 * cancelamento.
 */
export function montarEventoCancelamento(entrada: {
  ref: string;
  idEmpresa: number;
  justificativa: string;
  desfecho: DesfechoDoCancelamento;
  /** Quando a integração nem respondeu com corpo legível (rede, HTTP de erro). */
  respostaSemCorpo?: { motivo: string } | null;
  criadoPor: string | null;
  criadoPorNome: string | null;
}): EventoCancelamento {
  const { desfecho } = entrada;
  const payloadRetorno: Record<string, unknown> | null =
    desfecho.focus ?? (entrada.respostaSemCorpo ? { erro_integracao: entrada.respostaSemCorpo.motivo } : null);
  return {
    tipo_documento: "NFE",
    ref: entrada.ref,
    tipo_evento: "CANCELAMENTO",
    status_evento: desfecho.confirmado ? "cancelado" : STATUS_EVENTO_FALHA,
    status_sefaz: desfecho.statusSefaz,
    mensagem_sefaz: desfecho.confirmado ? desfecho.mensagemSefaz : desfecho.mensagemSefaz ?? entrada.respostaSemCorpo?.motivo ?? null,
    caminho_xml: desfecho.confirmado ? desfecho.caminhoXml : null,
    caminho_pdf: desfecho.confirmado ? texto(desfecho.focus.caminho_danfe) : null,
    justificativa: entrada.justificativa,
    payload_envio: { id_empresa: entrada.idEmpresa, referencia: entrada.ref, justificativa: entrada.justificativa },
    payload_retorno: payloadRetorno,
    origem: "FOCUS_CANCELAMENTO",
    criado_por: entrada.criadoPor,
    criado_por_nome: entrada.criadoPorNome
  };
}
