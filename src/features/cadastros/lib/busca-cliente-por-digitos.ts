/**
 * Busca de cliente por dígitos na Nova proposta (campo "1. Cliente"), 04/11/2026.
 *
 * Termo só de dígitos, a partir de 4 (com ou sem o "#" com que o campo nasce):
 * acha ID exato, documento e trecho de telefone fixo, WhatsApp 1 e WhatsApp 2,
 * comparando só os dígitos — o banco tem os dois formatos gravados, e a view
 * `vw_cadastros_lista_completa` já expõe as colunas `*_numeros`. Ordem: ID
 * exato no topo, depois documento, depois telefone/WhatsApp.
 *
 * Abaixo de 4 dígitos, ou com qualquer outro caractere, a busca segue a de
 * antes (ver `buildCadastrosSearchClause`).
 */

export const MIN_DIGITOS_BUSCA_TELEFONE = 4;

/** Os dígitos do termo quando ele é busca por dígitos; senão null. */
export function digitosDaBusca(termoCru: string): string | null {
  const termo = termoCru.replace(/#/g, "").replace(/\s+/g, "");
  if (!/^\d+$/.test(termo)) return null;
  return termo.length >= MIN_DIGITOS_BUSCA_TELEFONE ? termo : null;
}

/**
 * Trechos de telefone a procurar. Sem exigir o 55: quem digita "5531..." acha
 * também o número gravado sem o país.
 */
export function trechosDeTelefone(digitos: string): string[] {
  const trechos = [digitos];
  if (digitos.length >= 12 && digitos.startsWith("55")) trechos.push(digitos.slice(2));
  return trechos;
}

const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const baixo = (v: unknown) => String(v ?? "").trim().toLowerCase();

export type LinhaParaAcerto = {
  id_cliente?: unknown;
  nome?: unknown;
  fantasia?: unknown;
  apelido?: unknown;
  documento?: unknown;
  whatsapp_1?: unknown;
  whatsapp_2?: unknown;
  telefone_fixo?: unknown;
  email?: unknown;
  email_contato?: unknown;
};

/**
 * O campo que trouxe o cliente, quando foi telefone, WhatsApp ou e-mail — para
 * o vendedor entender por que ele apareceu. ID, nome, apelido e documento não
 * precisam de rótulo (já estão na linha): devolve null.
 */
export function campoQueBateu(linha: LinhaParaAcerto, termoCru: string): string | null {
  const termo = baixo(termoCru.replace(/#/g, ""));
  if (!termo) return null;
  const digitos = digitosDaBusca(termoCru);

  if (digitos && so(linha.id_cliente) === digitos) return null;
  if ([linha.nome, linha.fantasia, linha.apelido].some((v) => baixo(v).includes(termo))) return null;
  if (baixo(linha.documento).includes(termo) || (digitos && so(linha.documento).includes(digitos))) return null;

  const telefones: Array<[string, unknown]> = [
    ["WhatsApp 1", linha.whatsapp_1],
    ["WhatsApp 2", linha.whatsapp_2],
    ["Telefone", linha.telefone_fixo]
  ];
  for (const [rotulo, valor] of telefones) {
    const texto = String(valor ?? "").trim();
    if (!texto) continue;
    const porDigitos = digitos ? trechosDeTelefone(digitos).some((t) => so(texto).includes(t)) : false;
    if (porDigitos || baixo(texto).includes(termo)) return `${rotulo}: ${texto}`;
  }

  const emails: Array<[string, unknown]> = [
    ["E-mail", linha.email],
    ["E-mail de contato", linha.email_contato]
  ];
  for (const [rotulo, valor] of emails) {
    const texto = String(valor ?? "").trim();
    if (texto && baixo(texto).includes(termo)) return `${rotulo}: ${texto}`;
  }
  return null;
}
