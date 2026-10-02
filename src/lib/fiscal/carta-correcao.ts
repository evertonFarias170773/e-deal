/**
 * Carta de Correção (CC-e): leitura da resposta da integração fiscal e montagem
 * do evento da nota. Funções puras, usadas pela rota
 * `POST /api/fiscal/carta-correcao` (e a leitura da resposta também pela tela, no
 * cancelamento).
 *
 * Saíram de `NotasFiscaisPage` em 02/10/2026, quando o envio da carta deixou de
 * partir do navegador: a tela chamava o webhook direto, sem sessão e sem
 * permissão, e gravava o evento ela mesma.
 */

/** O mínimo que a SEFAZ aceita no texto da correção. */
export const MINIMO_CORRECAO = 15;
/** O máximo que a SEFAZ aceita no texto da correção. */
export const MAXIMO_CORRECAO = 1000;

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function parseFocusResponse(data: any): { success: boolean; message: string } {
  if (!data) {
    return { success: false, message: "Resposta do servidor vazia." };
  }

  const normalized = Array.isArray(data) ? data[0] : data;
  const body = normalized?.body ?? normalized;

  const statusCode = Number(normalized?.statusCode ?? body?.statusCode ?? normalized?.status_code ?? body?.status_code ?? 200);
  if (statusCode >= 400) {
    const errMsg = body?.erro?.mensagem || body?.error || body?.message || body?.mensagem || "Erro processado pelo webhook.";
    return { success: false, message: `${errMsg} (Status: ${statusCode})` };
  }

  if (body.erro) {
    if (typeof body.erro === "object") {
      return { success: false, message: body.erro.mensagem || body.erro.message || JSON.stringify(body.erro) };
    }
    return { success: false, message: String(body.erro) };
  }

  if (body.error || body.errors) {
    const err = body.error || body.errors;
    return { success: false, message: typeof err === "object" ? (err.message || JSON.stringify(err)) : String(err) };
  }

  if (body.status === "erro" || body.status === "rejeitado" || body.status === "erro_autorizacao") {
    return { success: false, message: body.mensagem || body.mensagem_sefaz || "Erro retornado pela SEFAZ/Focus API." };
  }

  if (body.codigo) {
    const lowerCode = String(body.codigo).toLowerCase();
    const successCodes = ["100", "135", "sucesso", "autorizado", "cancelado", "cce_registrada"];
    if (!successCodes.includes(lowerCode)) {
      return { success: false, message: body.mensagem || body.mensagem_sefaz || `Erro retornado pela API (Código: ${body.codigo})` };
    }
  }

  if (body.mensagem_sefaz && (body.mensagem_sefaz.toLowerCase().includes("rejeicao") || body.mensagem_sefaz.toLowerCase().includes("rejeição"))) {
    return { success: false, message: body.mensagem_sefaz };
  }

  return { success: true, message: "Operação realizada com sucesso." };
}

/**
 * O miolo da resposta da Focus, onde quer que a integração o tenha embrulhado:
 * em `body`, em `payload_retorno`, em `data` (objeto ou texto JSON) ou direto.
 * A mesma sequência que a tela aplicava antes de gravar o evento.
 */
/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
export function dadosDaFocusNaResposta(data: any): any {
  const normalized = Array.isArray(data) ? data[0] : data;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  let focusData: any = normalized;

  if (normalized && normalized.body) focusData = normalized.body;
  if (focusData && focusData.payload_retorno) focusData = focusData.payload_retorno;

  if (focusData && typeof focusData.data === "string") {
    try {
      focusData = JSON.parse(focusData.data);
    } catch {
      // Texto que não é JSON: fica o objeto que o embrulhava.
    }
  } else if (focusData && focusData.data && typeof focusData.data === "object") {
    focusData = focusData.data;
  }

  if (typeof focusData === "string") {
    try {
      focusData = JSON.parse(focusData);
    } catch {
      // Idem: mantém o texto cru em `payload_retorno`.
    }
  }

  return focusData;
}

export type EventoCartaCorrecao = {
  tipo_documento: "NFE";
  ref: string;
  tipo_evento: "CARTA_CORRECAO";
  sequencia_evento: number | null;
  status_evento: string | null;
  status_sefaz: string | null;
  mensagem_sefaz: string | null;
  caminho_xml: string | null;
  caminho_pdf: string | null;
  correcao: string;
  payload_envio: { id_empresa: number; referencia: string; correcao: string };
  payload_retorno: unknown;
  origem: "FOCUS_CCE";
  criado_por: string | null;
  criado_por_nome: string | null;
};

/** A linha de `notas_eventos` de uma carta de correção — os mesmos campos de sempre. */
export function montarEventoCartaCorrecao(entrada: {
  ref: string;
  idEmpresa: number;
  correcao: string;
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  respostaDaIntegracao: any;
  criadoPor: string | null;
  criadoPorNome: string | null;
}): EventoCartaCorrecao {
  const focusData = dadosDaFocusNaResposta(entrada.respostaDaIntegracao);
  return {
    tipo_documento: "NFE",
    ref: entrada.ref,
    tipo_evento: "CARTA_CORRECAO",
    sequencia_evento: focusData?.numero_carta_correcao ? Number(focusData.numero_carta_correcao) : null,
    status_evento: focusData?.status || null,
    status_sefaz: focusData?.status_sefaz || focusData?.codigo_status_sefaz || null,
    mensagem_sefaz: focusData?.mensagem_sefaz || null,
    caminho_xml: focusData?.caminho_xml_carta_correcao || null,
    caminho_pdf: focusData?.caminho_pdf_carta_correcao || null,
    correcao: entrada.correcao,
    payload_envio: { id_empresa: entrada.idEmpresa, referencia: entrada.ref, correcao: entrada.correcao },
    payload_retorno: focusData,
    origem: "FOCUS_CCE",
    criado_por: entrada.criadoPor,
    criado_por_nome: entrada.criadoPorNome
  };
}
