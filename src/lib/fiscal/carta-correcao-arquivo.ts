/**
 * Carta de correção (CC-e) para baixar no menu da nota: quais cartas a nota
 * tem, onde está o XML de cada uma e a leitura desse XML para o PDF que o Vibe
 * gera (17/11/2026, pedido da Edina, NF 41390).
 *
 * POR QUE O PDF É DO VIBE
 *   A Focus devolve `caminho_pdf_carta_correcao` (`/notas_fiscais/NFe<chave>/
 *   cartas_correcao/<n>.pdf`), mas esse arquivo só sai com o token da empresa:
 *   sem ele a Focus responde "Arquivo não encontrado". O token fica só no n8n,
 *   e o fluxo "Focus NFe - Copia XML de eventos" copia para o Vibe apenas o XML
 *   (`nfe-documentos/<ref>/cce-NN.xml`). O PDF é montado aqui a partir desse
 *   XML, como o comprovante de cancelamento; o documento fiscal é o XML.
 *
 * Sem dependências: a tela e a rota usam as mesmas regras.
 */
import { campo, secao } from "./comprovante-cancelamento";

export const TP_EVENTO_CARTA_CORRECAO = "110110";
export const CSTAT_CARTA_REGISTRADA = "135";

/** O mínimo de `notas_eventos` que a lista de cartas precisa. */
export type EventoDaNota = {
  tipo_evento?: string | null;
  status_evento?: string | null;
  status_sefaz?: string | null;
  sequencia_evento?: number | string | null;
  caminho_xml?: string | null;
  payload_retorno?: Record<string, unknown> | null;
  created_at?: string | null;
};

/** A sequência da carta: a coluna, o retorno da Focus ou o nome do XML. */
export function sequenciaDaCarta(evento: EventoDaNota): number | null {
  const candidatos = [
    evento.sequencia_evento,
    evento.payload_retorno?.numero_carta_correcao,
    String(evento.caminho_xml ?? "").match(/-cce-(\d+)\.xml$/)?.[1]
  ];
  for (const valor of candidatos) {
    const n = Number(String(valor ?? "").trim());
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

/**
 * As cartas registradas pela SEFAZ (135), uma por sequência, em ordem. Se a
 * mesma sequência aparece duas vezes, vale a mais recente.
 */
export function cartasDaNota(eventos: readonly EventoDaNota[] | null | undefined): number[] {
  const vistas = new Set<number>();
  for (const evento of eventos ?? []) {
    if (String(evento.tipo_evento ?? "").toUpperCase() !== "CARTA_CORRECAO") continue;
    if (String(evento.status_sefaz ?? "").trim() !== CSTAT_CARTA_REGISTRADA) continue;
    const seq = sequenciaDaCarta(evento);
    if (seq !== null) vistas.add(seq);
  }
  return [...vistas].sort((a, b) => a - b);
}

/** Onde o n8n guarda o XML da carta: `<ref>/cce-01.xml`. */
export function caminhoDoXmlDaCarta(ref: string, sequencia: number): string {
  return `${ref}/cce-${String(sequencia).padStart(2, "0")}.xml`;
}

/** "Carta-de-Correcao-2-NF-e-41390-Pedido-24253.pdf". */
export function nomeDaCartaDeCorrecao(
  entrada: { numero: string | number | null | undefined; idInt: number | null | undefined; ref: string; sequencia: number },
  formato: "xml" | "pdf"
): string {
  const numero = String(entrada.numero ?? "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  const pedido = Number(entrada.idInt) > 0 ? String(Math.trunc(Number(entrada.idInt))) : "";
  const partes = ["Carta-de-Correcao", String(entrada.sequencia), "NF-e", numero || String(entrada.ref).replace(/[^0-9A-Za-z-]+/g, "")];
  if (pedido) partes.push("Pedido", pedido);
  return `${partes.join("-")}.${formato}`;
}

/** Rótulos do menu: "(PDF)" com uma carta; "nº N (PDF)" com mais de uma. */
export function rotulosDaCarta(sequencia: number, total: number): { pdf: string; xml: string } {
  const qual = total > 1 ? ` nº ${sequencia}` : "";
  return { pdf: `Baixar carta de correção${qual} (PDF)`, xml: `Baixar carta de correção${qual} (XML)` };
}

export type EventoCartaCorrecao = {
  chave: string;
  cnpjEmitente: string;
  sequencia: string;
  dataEvento: string;
  dataRegistro: string;
  protocolo: string;
  cStat: string;
  motivo: string;
  correcao: string;
  condicoesDeUso: string;
  ambiente: "producao" | "homologacao" | null;
};

/** Lê o procEventoNFe da carta. Só aceita 110110 registrado (135) com chave e protocolo. */
export function lerEventoCartaCorrecao(xml: string | null | undefined):
  | { ok: true; evento: EventoCartaCorrecao }
  | { ok: false; motivo: string } {
  const texto = String(xml ?? "");
  const pedido = secao(texto, "evento");
  const resposta = secao(texto, "retEvento");
  if (!pedido || !resposta) return { ok: false, motivo: "O XML guardado não é um evento com a resposta da SEFAZ." };
  const infPedido = secao(pedido, "infEvento");
  const infResposta = secao(resposta, "infEvento");
  const detalhe = secao(pedido, "detEvento");

  const tpEvento = campo(infPedido, "tpEvento");
  if (tpEvento !== TP_EVENTO_CARTA_CORRECAO) {
    return { ok: false, motivo: `O XML guardado não é de carta de correção (evento ${tpEvento || "sem tipo"}).` };
  }
  const cStat = campo(infResposta, "cStat");
  if (cStat !== CSTAT_CARTA_REGISTRADA) {
    return { ok: false, motivo: `A SEFAZ não registrou esta carta (código ${cStat || "ausente"}).` };
  }
  const chave = campo(infPedido, "chNFe");
  const chaveResposta = campo(infResposta, "chNFe");
  if (!/^\d{44}$/.test(chave) || (chaveResposta && chaveResposta !== chave)) {
    return { ok: false, motivo: "A chave de acesso do XML da carta está ausente ou não confere." };
  }
  const protocolo = campo(infResposta, "nProt");
  if (!protocolo) return { ok: false, motivo: "O XML da carta não tem o protocolo da SEFAZ." };
  const tpAmb = campo(infPedido, "tpAmb");
  return {
    ok: true,
    evento: {
      chave,
      cnpjEmitente: campo(infPedido, "CNPJ") || campo(infPedido, "CPF"),
      sequencia: campo(infPedido, "nSeqEvento"),
      dataEvento: campo(infPedido, "dhEvento"),
      dataRegistro: campo(infResposta, "dhRegEvento"),
      protocolo,
      cStat,
      motivo: campo(infResposta, "xMotivo"),
      correcao: campo(detalhe, "xCorrecao"),
      condicoesDeUso: campo(detalhe, "xCondUso"),
      ambiente: tpAmb === "1" ? "producao" : tpAmb === "2" ? "homologacao" : null
    }
  };
}
