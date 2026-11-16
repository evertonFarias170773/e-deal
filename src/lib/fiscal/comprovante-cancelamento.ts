/**
 * Comprovante de cancelamento da NF-e: nome do arquivo e leitura do XML do
 * evento (procEventoNFe) para o PDF que o Vibe gera (16/11/2026).
 *
 * POR QUE O PDF É DO VIBE
 *   A Focus não gera PDF do cancelamento da NF-e: devolve só o XML do evento,
 *   que o n8n guarda em `nfe-documentos/<ref>/cancelamento.xml`. O cliente não
 *   lê XML, e a Edina precisa mandar algo legível. O PDF é uma representação
 *   desse XML; o documento com valor fiscal continua sendo o XML.
 *
 * Sem dependências (nem DOM, nem biblioteca de XML): o procEventoNFe tem
 * estrutura fixa do leiaute da SEFAZ, e cada campo é lido dentro da sua seção
 * (o pedido em `<evento>`, a resposta da SEFAZ em `<retEvento>`), porque
 * `nProt` aparece nas duas com sentidos diferentes.
 */

export type FormatoDoComprovante = "xml" | "pdf";

export function nomeDoComprovanteDeCancelamento(
  entrada: {
    numero: string | number | null | undefined;
    idInt: number | null | undefined;
    ref: string;
  },
  formato: FormatoDoComprovante = "xml"
): string {
  const numero = String(entrada.numero ?? "").replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
  const pedido = Number(entrada.idInt) > 0 ? String(Math.trunc(Number(entrada.idInt))) : "";
  const partes = ["Cancelamento", "NF-e", numero || String(entrada.ref).replace(/[^0-9A-Za-z-]+/g, "")];
  if (pedido) partes.push("Pedido", pedido);
  return `${partes.join("-")}.${formato}`;
}

/** Tipo do evento de cancelamento de NF-e no leiaute da SEFAZ. */
export const TP_EVENTO_CANCELAMENTO = "110111";
const CSTAT_CONFIRMADO = ["135", "155"];

/** O que o PDF mostra do evento, lido do XML. */
export type EventoDeCancelamento = {
  chave: string;
  cnpjEmitente: string;
  /** Data e hora do pedido de cancelamento (dhEvento), como está no XML. */
  dataEvento: string;
  /** Data e hora do registro na SEFAZ (dhRegEvento). */
  dataRegistro: string;
  /** Protocolo do evento de cancelamento (retEvento/nProt). */
  protocoloCancelamento: string;
  /** Protocolo de autorização da nota, citado no evento (detEvento/nProt). */
  protocoloAutorizacao: string;
  cStat: string;
  motivo: string;
  justificativa: string;
  sequencia: string;
  ambiente: "producao" | "homologacao" | null;
};

function secao(xml: string, tag: string): string | null {
  const achado = xml.match(new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`));
  return achado ? achado[0] : null;
}

function campo(xml: string | null, tag: string): string {
  if (!xml) return "";
  const achado = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return achado ? desfazerEntidades(achado[1].trim()) : "";
}

function desfazerEntidades(texto: string): string {
  return texto
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/**
 * Lê o procEventoNFe. Só aceita cancelamento confirmado (tpEvento 110111,
 * cStat 135 ou 155, chave e protocolo presentes); qualquer outra coisa volta
 * com o motivo, e o PDF não é gerado.
 */
export function lerEventoDeCancelamento(xml: string | null | undefined):
  | { ok: true; evento: EventoDeCancelamento }
  | { ok: false; motivo: string } {
  const texto = String(xml ?? "");
  const pedido = secao(texto, "evento");
  const resposta = secao(texto, "retEvento");
  if (!pedido || !resposta) return { ok: false, motivo: "O XML guardado não é um evento com a resposta da SEFAZ." };

  const infPedido = secao(pedido, "infEvento");
  const infResposta = secao(resposta, "infEvento");
  const detalhe = secao(pedido, "detEvento");

  const tpEvento = campo(infPedido, "tpEvento");
  if (tpEvento !== TP_EVENTO_CANCELAMENTO) {
    return { ok: false, motivo: `O XML guardado não é de cancelamento (evento ${tpEvento || "sem tipo"}).` };
  }
  const cStat = campo(infResposta, "cStat");
  if (!CSTAT_CONFIRMADO.includes(cStat)) {
    return { ok: false, motivo: `A SEFAZ não confirmou este evento (código ${cStat || "ausente"}).` };
  }
  const chave = campo(infPedido, "chNFe");
  const chaveResposta = campo(infResposta, "chNFe");
  if (!/^\d{44}$/.test(chave) || (chaveResposta && chaveResposta !== chave)) {
    return { ok: false, motivo: "A chave de acesso do XML do evento está ausente ou não confere." };
  }
  const protocoloCancelamento = campo(infResposta, "nProt");
  if (!protocoloCancelamento) return { ok: false, motivo: "O XML do evento não tem o protocolo do cancelamento." };

  const tpAmb = campo(infPedido, "tpAmb");
  return {
    ok: true,
    evento: {
      chave,
      cnpjEmitente: campo(infPedido, "CNPJ") || campo(infPedido, "CPF"),
      dataEvento: campo(infPedido, "dhEvento"),
      dataRegistro: campo(infResposta, "dhRegEvento"),
      protocoloCancelamento,
      protocoloAutorizacao: campo(detalhe, "nProt"),
      cStat,
      motivo: campo(infResposta, "xMotivo"),
      justificativa: campo(detalhe, "xJust"),
      sequencia: campo(infPedido, "nSeqEvento"),
      ambiente: tpAmb === "1" ? "producao" : tpAmb === "2" ? "homologacao" : null
    }
  };
}

/** Destinatário e emitente lidos do XML da própria NF-e (`<ref>/nfe.xml`). */
export function lerPartesDaNfe(xml: string | null | undefined): {
  emitente: { nome: string; documento: string } | null;
  destinatario: { nome: string; documento: string } | null;
  serie: string;
  numero: string;
} {
  const texto = String(xml ?? "");
  const emit = secao(texto, "emit");
  const dest = secao(texto, "dest");
  const ide = secao(texto, "ide");
  const parte = (bloco: string | null) =>
    bloco ? { nome: campo(bloco, "xNome"), documento: campo(bloco, "CNPJ") || campo(bloco, "CPF") || campo(bloco, "idEstrangeiro") } : null;
  return { emitente: parte(emit), destinatario: parte(dest), serie: campo(ide, "serie"), numero: campo(ide, "nNF") };
}

/** Série e número que a própria chave carrega (posições do leiaute). */
export function serieENumeroDaChave(chave: string): { serie: string; numero: string } {
  if (!/^\d{44}$/.test(chave)) return { serie: "", numero: "" };
  return {
    serie: String(Number(chave.slice(22, 25))),
    numero: String(Number(chave.slice(25, 34)))
  };
}

/** Chave em blocos de 4, como no DANFE. */
export function chaveEmBlocos(chave: string): string {
  return String(chave).replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** CNPJ ou CPF com máscara; outro texto volta como está. */
export function documentoFormatado(documento: string): string {
  const d = String(documento ?? "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return String(documento ?? "");
}

/**
 * Data e hora em Brasília, "dd/mm/aaaa hh:mm:ss". Aceita o formato do XML
 * (com fuso, -03:00) e o timestamptz do banco.
 */
export function dataHoraDeBrasilia(valor: string | null | undefined): string {
  const data = new Date(String(valor ?? ""));
  if (!valor || Number.isNaN(data.getTime())) return "";
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(data);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("day")}/${p("month")}/${p("year")} ${p("hour")}:${p("minute")}:${p("second")}`;
}
