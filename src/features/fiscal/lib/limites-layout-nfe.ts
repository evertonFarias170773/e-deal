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
 * social. Barrar e dizer onde encurtar nao perde nada — e quem encurta e o
 * operador, quase sempre no campo "so nesta nota", sem tocar no cadastro.
 *
 * TRES LUGARES AVISAM, COM A MESMA FRASE
 *   O painel de pendencias, quando a nota abre; o modal, no clique de emitir; e
 *   a rota `/api/fiscal/emitir-nfe`, no servidor. Os tres leem `ondeCorrigir`
 *   daqui: a orientacao nasce num lugar so.
 *
 * O QUE ENTRA NA LISTA
 *   Os campos do payload que a Focus valida e que dependem de dado digitado,
 *   com o limite da referencia oficial dela
 *   (campos.focusnfe.com.br/nfe/NotaFiscalXML.html): 60 caracteres nos dez
 *   campos do cabecalho e 120 na descricao do item, que e o `xProd`.
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
  /**
   * Onde o dado se corrige, ja na forma da frase — entra depois de "Corrija".
   *
   * E a FONTE UNICA da orientacao: o painel de pendencias, o modal de emissao e
   * a rota `/api/fiscal/emitir-nfe` leem daqui. Mudar a saida de um campo e
   * mudar esta linha, e mais nada.
   */
  ondeCorrigir: string;
};

/**
 * A SAÍDA DE CADA CAMPO — e ela é UMA SÓ, para os três lugares que avisam.
 *
 * Os cinco primeiros campos do destinatário têm versão "só nesta nota" na aba
 * Destinatário: encurtam o que sai no documento sem tocar no cadastro do
 * cliente, que segue inteiro na proposta, na etiqueta e na cobrança. É para
 * ELES que a mensagem manda — não para o cadastro.
 *
 * Isto já era o que o painel de pendências dizia. A mensagem daqui, que o modal
 * e a rota devolvem, dizia o contrário ("corrija no cadastro do cliente") e
 * mandava o operador abreviar a razão social. Agora a frase nasce num lugar só.
 *
 * Município é a exceção declarada: não tem versão da nota, porque precisa casar
 * com o nome oficial do município. Esse manda mesmo para o cadastro.
 */
export const CAMPOS_COM_LIMITE_NFE: readonly CampoComLimite[] = [
  {
    chave: "nome_destinatario",
    rotulo: "Nome do destinatário",
    limite: 60,
    ondeCorrigir: 'no campo "Nome / Razão Social (só nesta nota)", na aba Destinatário — o cadastro do cliente não muda'
  },
  {
    chave: "logradouro_destinatario",
    rotulo: "Logradouro do endereço",
    limite: 60,
    ondeCorrigir: 'no campo "Logradouro (só nesta nota)", na aba Destinatário — o cadastro do cliente não muda'
  },
  {
    chave: "numero_destinatario",
    rotulo: "Número do endereço",
    limite: 60,
    ondeCorrigir: 'no campo "Número (só nesta nota)", na aba Destinatário — o cadastro do cliente não muda'
  },
  {
    chave: "complemento_destinatario",
    rotulo: "Complemento do endereço",
    limite: 60,
    ondeCorrigir: 'no campo "Complemento (só nesta nota)", na aba Destinatário — o cadastro do cliente não muda'
  },
  {
    chave: "bairro_destinatario",
    rotulo: "Bairro do endereço",
    limite: 60,
    ondeCorrigir: 'no campo "Bairro (só nesta nota)", na aba Destinatário — o cadastro do cliente não muda'
  },
  {
    chave: "municipio_destinatario",
    rotulo: "Município do endereço",
    limite: 60,
    ondeCorrigir: "no cadastro do cliente — este campo não tem versão só desta nota"
  },
  { chave: "nome_transportador", rotulo: "Nome da transportadora", limite: 60, ondeCorrigir: "no cadastro da transportadora" },
  { chave: "endereco_transportador", rotulo: "Endereço da transportadora", limite: 60, ondeCorrigir: "no cadastro da transportadora" },
  { chave: "municipio_transportador", rotulo: "Município da transportadora", limite: 60, ondeCorrigir: "no cadastro da transportadora" },
  { chave: "natureza_operacao", rotulo: "Natureza da operação", limite: 60, ondeCorrigir: "no campo Natureza da operação, na nota" }
];

/**
 * O item tem um campo de texto com limite PRÓPRIO, e maior: a descrição é o
 * `xProd` do layout, que vai até 120. Ela não mora no primeiro nível do
 * payload — vive dentro de `items` —, por isso não entra na lista acima e é
 * conferida item a item.
 *
 * Hoje a maior descrição em nota é de 52 caracteres e o maior `nomeReal` do
 * catálogo tem 60, então a folga é grande. Está aqui porque a folga não é
 * garantia: produto novo com nome longo passaria sem ninguém medir.
 */
export const CAMPO_DESCRICAO_ITEM: CampoComLimite = {
  chave: "descricao",
  rotulo: "Descrição do item",
  limite: 120,
  ondeCorrigir: "na aba Itens da nota"
};

export type EstouroDeLayout = CampoComLimite & {
  tamanho: number;
  mensagem: string;
  /** Só nos estouros de item: qual linha da nota, para o operador achar. */
  item?: { numero: string | null; codigo: string | null };
};

const tamanhoEmCaracteres = (valor: unknown) => Array.from(String(valor)).length;

const texto = (valor: unknown): string | null => {
  if (valor === null || valor === undefined) return null;
  const limpo = String(valor).trim();
  return limpo === "" ? null : limpo;
};

/**
 * Todos os campos do payload que passam do limite, na ordem da lista — de uma
 * vez, para o operador corrigir tudo numa ida so. Vazio quando nada estoura.
 *
 * Os campos do cabeçalho vêm primeiro, os itens depois, na ordem em que a nota
 * os lista.
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

  const itens = Array.isArray(payload.items) ? payload.items : [];
  for (const bruto of itens) {
    if (!bruto || typeof bruto !== "object") continue;
    const item = bruto as Record<string, unknown>;
    const valor = item[CAMPO_DESCRICAO_ITEM.chave];
    if (valor === null || valor === undefined) continue;
    const tamanho = tamanhoEmCaracteres(valor);
    if (tamanho <= CAMPO_DESCRICAO_ITEM.limite) continue;

    const numero = texto(item.numero_item);
    const codigo = texto(item.codigo_produto);
    const qual = numero ? ` ${numero}` : codigo ? ` (código ${codigo})` : "";
    estouros.push({
      ...CAMPO_DESCRICAO_ITEM,
      tamanho,
      item: { numero, codigo },
      mensagem: `${CAMPO_DESCRICAO_ITEM.rotulo}${qual} com ${tamanho} caracteres; o máximo da NF-e é ${CAMPO_DESCRICAO_ITEM.limite}. Corrija ${CAMPO_DESCRICAO_ITEM.ondeCorrigir}.`
    });
  }

  return estouros;
}
