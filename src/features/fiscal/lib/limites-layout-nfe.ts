/**
 * Os campos da NF-e que tem limite de tamanho no layout, e a conferencia deles
 * ANTES de a nota ir para a Focus.
 *
 * POR QUE EXISTE
 *   A NFE-21518-001 saiu com complemento de 63 caracteres. A Focus recusou com
 *   HTTP 422 na validacao de schema — antes da SEFAZ —, a consulta seguinte nao
 *   achou a nota e o operador viu "nao encontrada" em vez do motivo. Tres
 *   tentativas, o mesmo erro, e o motivo real so existia no log do n8n.
 *
 *   Esta conferencia diz o motivo antes: le o payload que vai sair e, se algum
 *   campo passa do limite, a emissao nao e disparada.
 *
 * NADA E TRUNCADO. O payload e montado no banco (`fn_montar_payload_nfe`, pela
 * `fn_preparar_envio_nfe` que o n8n chama), e cortar um nome ou um logradouro
 * em silencio pode apagar o numero de um endereco ou metade de uma razao
 * social. Barrar e mandar corrigir o cadastro nao perde nada.
 *
 * O QUE ENTRA NA LISTA
 *   Os campos do payload que a Focus valida e que dependem de dado digitado,
 *   todos com limite de 60 caracteres na referencia oficial dela
 *   (campos.focusnfe.com.br/nfe/NotaFiscalXML.html).
 *
 *   O E-MAIL FICA DE FORA de proposito: o payload o manda na chave `email`, e a
 *   Focus so conhece `email_destinatario` — ela descarta o valor, e o XML
 *   autorizado sai sem ele (conferido na NFE-22269-001 e na NFE-22255-001).
 *   Conferir o tamanho dele barraria nota por um campo que nunca chega a nota.
 *   Quando a chave for corrigida, o e-mail entra aqui.
 *
 * O TAMANHO E O DO TEXTO COMO SAI, sem aparar: e esse que a Focus mede. Conta
 * caracteres, e nao unidades de UTF-16 — "º" e um, como no schema.
 */

export type CampoComLimite = {
  /** A chave no payload de `fn_montar_payload_nfe`. */
  chave: string;
  /** Como o campo aparece na mensagem ao operador. */
  rotulo: string;
  limite: number;
  /** Onde o dado se corrige, ja na forma da frase: "Corrija no cadastro do cliente." */
  ondeCorrigir: string;
};

export const CAMPOS_COM_LIMITE_NFE: readonly CampoComLimite[] = [
  { chave: "nome_destinatario", rotulo: "Nome do destinatário", limite: 60, ondeCorrigir: "no cadastro do cliente" },
  { chave: "logradouro_destinatario", rotulo: "Logradouro do endereço", limite: 60, ondeCorrigir: "no cadastro do cliente" },
  { chave: "numero_destinatario", rotulo: "Número do endereço", limite: 60, ondeCorrigir: "no cadastro do cliente" },
  { chave: "complemento_destinatario", rotulo: "Complemento do endereço", limite: 60, ondeCorrigir: "no cadastro do cliente" },
  { chave: "bairro_destinatario", rotulo: "Bairro do endereço", limite: 60, ondeCorrigir: "no cadastro do cliente" },
  { chave: "municipio_destinatario", rotulo: "Município do endereço", limite: 60, ondeCorrigir: "no cadastro do cliente" },
  { chave: "nome_transportador", rotulo: "Nome da transportadora", limite: 60, ondeCorrigir: "no cadastro da transportadora" },
  { chave: "endereco_transportador", rotulo: "Endereço da transportadora", limite: 60, ondeCorrigir: "no cadastro da transportadora" },
  { chave: "municipio_transportador", rotulo: "Município da transportadora", limite: 60, ondeCorrigir: "no cadastro da transportadora" },
  { chave: "natureza_operacao", rotulo: "Natureza da operação", limite: 60, ondeCorrigir: "no campo Natureza da operação, na nota" }
];

export type EstouroDeLayout = CampoComLimite & { tamanho: number; mensagem: string };

const tamanhoEmCaracteres = (valor: unknown) => Array.from(String(valor)).length;

/**
 * Todos os campos do payload que passam do limite, na ordem da lista — de uma
 * vez, para o operador corrigir tudo numa ida so. Vazio quando nada estoura.
 */
export function estourosDeLayoutNfe(payload: Record<string, unknown> | null | undefined): EstouroDeLayout[] {
  if (!payload) return [];
  const estouros: EstouroDeLayout[] = [];
  for (const campo of CAMPOS_COM_LIMITE_NFE) {
    const valor = payload[campo.chave];
    if (valor === null || valor === undefined) continue;
    const tamanho = tamanhoEmCaracteres(valor);
    if (tamanho <= campo.limite) continue;
    estouros.push({
      ...campo,
      tamanho,
      mensagem: `${campo.rotulo} com ${tamanho} caracteres; o máximo da NF-e é ${campo.limite}. Corrija ${campo.ondeCorrigir}.`
    });
  }
  return estouros;
}
