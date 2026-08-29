/**
 * Pendências do rascunho de NF-e — módulo PURO.
 *
 * POR QUE EXISTE
 *   Hoje o operador só descobre o que impede a emissão depois de clicar em
 *   "Emitir NF-e": a tela salva, chama `fn_alertas_nfe` e devolve um modal com
 *   textos soltos. Este módulo antecipa a MESMA conferência no cliente, para o
 *   painel do topo listar o que falta e o botão de emitir já nascer desabilitado
 *   com o motivo à vista.
 *
 * DE ONDE VEM CADA REGRA
 *   Nada aqui é regra nova. Cada pendência espelha uma trava que JÁ existe:
 *     - `fn_alertas_nfe`                        → alertas nível ERRO / AVISO
 *     - `vw_notas_fiscais_validacao`            → pode_emitir_basico
 *     - `vw_notas_fiscais_validacao_destinatario` → destinatario_ok
 *     - `vw_notas_fiscais_validacao_itens`      → itens_ok
 *     - `vw_nfe_itens_conferencia_valores`      → erro_valor_comercial/tributável
 *     - `NfeDetailPage.handleConcludeDraft`     → vencimento anterior à emissão
 *   O servidor continua sendo a autoridade: `fn_preparar_envio_nfe` bloqueia do
 *   mesmo jeito. Isto é uma antecipação da resposta, não uma substituição dela.
 *
 * O QUE ESTE MÓDULO NÃO SABE
 *   `PAYLOAD_NULL` (fn_montar_payload_nfe não devolveu JSON) só existe no
 *   servidor, na hora de preparar o envio. Para esse caso — e para qualquer
 *   alerta novo que o banco venha a criar — use `pendenciasDoServidor()`.
 *
 * PURO DE PROPÓSITO
 *   Sem React, sem Supabase, sem Date.now(): tudo que a conferência precisa
 *   entra por parâmetro. É o que permite testar a lista sem subir a tela.
 */

/** Abas da tela de NF-e. Mesmos rótulos de `TabName` em NfeDetailPage. */
export type BlocoNfe =
  | "Resumo"
  | "Emitente"
  | "Destinatário"
  | "Itens"
  | "Transporte/Frete"
  | "Pagamentos"
  | "Totais"
  | "Informações adicionais"
  | "Validação"
  | "Documentos/Preview";

/** `impede` trava a emissão; `aviso` só informa. Espelha `bloqueia_envio`. */
export type SeveridadePendencia = "impede" | "aviso";

/**
 * Para onde o link da pendência leva.
 *
 * `sem-destino` não é preguiça: natureza da operação, finalidade, presença do
 * comprador e tipo de documento bloqueiam a emissão e NÃO têm campo nesta tela
 * (são gravados na criação do rascunho); status não editável é estado, não
 * campo. A pendência aparece assim mesmo — a lista tem que ser a verdade
 * completa do que trava.
 */
export type DestinoPendencia =
  | { tipo: "aba"; bloco: BlocoNfe; campo?: string; idItem?: string }
  | { tipo: "cadastro-cliente"; idCliente: number | null; campo?: string }
  | { tipo: "sem-destino" };

export interface Pendencia {
  /** Código estável, para log e teste. Reaproveita o código do banco quando há. */
  codigo: string;
  /** Bloco de origem — a aba onde o problema nasce. */
  bloco: BlocoNfe;
  severidade: SeveridadePendencia;
  /** Uma linha, direta, do que está errado. */
  texto: string;
  destino: DestinoPendencia;
}

type Texto = string | number | null | undefined;

export interface NotaParaPendencias {
  ref?: Texto;
  id_int?: number | null;
  id_cliente?: number | null;
  status?: Texto;
  natureza_operacao?: Texto;
  tipo_documento?: Texto;
  finalidade_emissao?: Texto;
  consumidor_final?: Texto;
  presenca_comprador?: Texto;
  tipo_contribuinte?: Texto;
  modalidade_frete?: Texto;
  valor_produtos?: number | null;
  valor_frete?: number | null;
  valor_total_nf?: number | null;
  peso_liquido?: number | null;
  informacoes_complementares?: Texto;
  /** Data de emissão usada na conferência de vencimento (ISO). */
  created_at?: string | null;
  /**
   * A natureza escolhida é uma em que o CATÁLOGO NÃO DECIDE a tributação —
   * hoje, a devolução de saída (5202/6202).
   *
   * Só muda o TEXTO das pendências de CST: o impeditivo é o mesmo, campo vazio
   * continua barrando a emissão. Serve para o operador não procurar um erro de
   * cadastro onde o que falta é uma decisão dele.
   *
   * Vem calculado de fora — este módulo não conhece o catálogo e não vai
   * conhecer: ele confere um rascunho, não consulta tabela.
   */
  naturezaSemTributacaoPadrao?: boolean | null;
}

export interface ItemParaPendencias {
  id?: string;
  numero_item?: number | null;
  descricao?: Texto;
  ncm?: Texto;
  cfop?: Texto;
  unidade_comercial?: Texto;
  unidade_tributavel?: Texto;
  quantidade?: number | null;
  quantidade_tributavel?: number | null;
  valor_unitario?: number | null;
  valor_unitario_tributavel?: number | null;
  valor_bruto?: number | null;
  icms_origem?: Texto;
  icms_situacao_tributaria?: Texto;
  pis_situacao_tributaria?: Texto;
  cofins_situacao_tributaria?: Texto;
  peso_total_gramas?: number | null;
  ativo?: boolean | null;
}

export interface PagamentoParaPendencias {
  numero_parcela?: number | null;
  valor?: number | null;
  data_vencimento?: string | null;
  ativo?: boolean | null;
}

export interface ClienteParaPendencias {
  id_cliente?: number | null;
  nome?: Texto;
  documento?: Texto;
  /** `clientes.ins_estadual` é a coluna que o banco confere. */
  ins_estadual?: Texto;
  /** Alguns componentes carregam a mesma informação com este nome. */
  inscricao_estadual?: Texto;
}

export interface EnderecoParaPendencias {
  id?: string | number | null;
  cep?: Texto;
  endereco?: Texto;
  numero?: Texto;
  bairro?: Texto;
  cidade?: Texto;
  uf?: Texto;
}

export interface RascunhoParaPendencias {
  nota: NotaParaPendencias;
  itens: ItemParaPendencias[];
  pagamentos: PagamentoParaPendencias[];
  cliente: ClienteParaPendencias | null;
  /** Endereço `tipo_endereco = 'principal'` do cliente — o que a NF-e usa. */
  enderecoPrincipal: EnderecoParaPendencias | null;
}

/* ------------------------------------------------------------------ *
 * Helpers — espelham a semântica do Postgres, não a do JavaScript.
 * ------------------------------------------------------------------ */

/** Vazio como o banco entende: null, undefined ou texto que só tem espaço. */
function vazio(valor: Texto): boolean {
  if (valor === null || valor === undefined) return true;
  if (typeof valor === "number") return false;
  return String(valor).trim() === "";
}

function texto(valor: Texto): string {
  return String(valor ?? "").trim();
}

function numero(valor: number | null | undefined): number {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** `round(x, casas)` do Postgres. */
function arred(valor: number, casas: number): number {
  const fator = Math.pow(10, casas);
  return Math.round((valor + Number.EPSILON) * fator) / fator;
}

function digitos(valor: Texto): string {
  return texto(valor).replace(/\D/g, "");
}

/** IE ausente ou literalmente "ISENTO" — a mesma conferência do banco. */
function ieAusente(cliente: ClienteParaPendencias | null): boolean {
  const ie = cliente?.ins_estadual ?? cliente?.inscricao_estadual;
  if (vazio(ie)) return true;
  return texto(ie).toUpperCase() === "ISENTO";
}

function itemAtivo(item: ItemParaPendencias): boolean {
  return item.ativo !== false;
}

function pagamentoAtivo(pagamento: PagamentoParaPendencias): boolean {
  return pagamento.ativo !== false;
}

/** "Item 3" quando há número; senão a descrição; senão "Item sem número". */
function rotuloItem(item: ItemParaPendencias): string {
  if (item.numero_item !== null && item.numero_item !== undefined) {
    return `Item ${item.numero_item}`;
  }
  if (!vazio(item.descricao)) return texto(item.descricao);
  return "Item sem número";
}

function moeda(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

/* ------------------------------------------------------------------ *
 * Campos de destino — os `id` que a tela precisa expor nos inputs.
 * ------------------------------------------------------------------ */

export const CAMPO_CONSUMIDOR_FINAL = "nfe-campo-consumidor-final";
export const CAMPO_TIPO_CONTRIBUINTE = "nfe-campo-tipo-contribuinte";
export const CAMPO_MODALIDADE_FRETE = "nfe-campo-modalidade-frete";

/** Id do input de um campo do item, na tabela da aba Itens. */
export function campoDoItem(idItem: string | undefined, campo: string): string | undefined {
  if (!idItem) return undefined;
  return `nfe-item-${idItem}-${campo}`;
}

/* ------------------------------------------------------------------ *
 * A conferência
 * ------------------------------------------------------------------ */

const STATUS_NAO_EDITAVEIS = ["AUTORIZADA", "PROCESSANDO", "CANCELADA", "DENEGADA"];

/**
 * Lista tudo que hoje impede (ou merece aviso) na emissão deste rascunho.
 * Impeditivas primeiro, na ordem em que o operador conserta.
 */
export function levantarPendencias(rascunho: RascunhoParaPendencias): Pendencia[] {
  const { nota, cliente, enderecoPrincipal } = rascunho;
  const itens = rascunho.itens.filter(itemAtivo);
  const pagamentos = rascunho.pagamentos.filter(pagamentoAtivo);
  const idCliente = cliente?.id_cliente ?? nota.id_cliente ?? null;

  const impeditivas: Pendencia[] = [];
  const avisos: Pendencia[] = [];

  const impede = (codigo: string, bloco: BlocoNfe, texto: string, destino: DestinoPendencia) => {
    impeditivas.push({ codigo, bloco, severidade: "impede", texto, destino });
  };
  const avisa = (codigo: string, bloco: BlocoNfe, texto: string, destino: DestinoPendencia) => {
    avisos.push({ codigo, bloco, severidade: "aviso", texto, destino });
  };
  const semDestino: DestinoPendencia = { tipo: "sem-destino" };
  const noCadastro = (campo?: string): DestinoPendencia => ({
    tipo: "cadastro-cliente",
    idCliente,
    campo
  });

  /* --- Estado da nota (fn_alertas_nfe) --- */

  const status = texto(nota.status).toUpperCase();
  if (STATUS_NAO_EDITAVEIS.includes(status)) {
    impede(
      "STATUS_NAO_EDITAVEL",
      "Resumo",
      `A nota está ${status} e não pode ser editada nem reenviada.`,
      semDestino
    );
  }
  if (status === "ERRO_AUTORIZACAO") {
    avisa(
      "RETORNO_SEFAZ_ANTERIOR",
      "Resumo",
      "Esta nota já teve uma rejeição da SEFAZ. Revise a mensagem antes de reenviar.",
      semDestino
    );
  }

  /* --- Cabeçalho (vw_notas_fiscais_validacao) --- */

  if (nota.id_int === null || nota.id_int === undefined) {
    impede("ID_INT_AUSENTE", "Resumo", "A nota está sem número interno (id_int).", semDestino);
  }
  if (vazio(nota.ref)) {
    impede("REF_VAZIA", "Resumo", "A nota está sem ref.", semDestino);
  }
  if (vazio(nota.natureza_operacao)) {
    impede(
      "NATUREZA_OPERACAO_VAZIA",
      "Resumo",
      "Natureza da operação não informada. Não há campo para ela nesta tela — é gravada na criação do rascunho.",
      semDestino
    );
  }
  if (vazio(nota.tipo_documento)) {
    impede(
      "TIPO_DOCUMENTO_VAZIO",
      "Resumo",
      "Tipo de documento não informado. Sem campo nesta tela.",
      semDestino
    );
  }
  if (vazio(nota.finalidade_emissao)) {
    impede(
      "FINALIDADE_EMISSAO_VAZIA",
      "Resumo",
      "Finalidade da emissão não informada. Sem campo nesta tela.",
      semDestino
    );
  }
  if (vazio(nota.presenca_comprador)) {
    impede(
      "PRESENCA_COMPRADOR_VAZIA",
      "Resumo",
      "Presença do comprador não informada. Sem campo nesta tela.",
      semDestino
    );
  }
  if (vazio(nota.consumidor_final)) {
    impede("CONSUMIDOR_FINAL_VAZIO", "Destinatário", "Consumidor final não informado.", {
      tipo: "aba",
      bloco: "Destinatário",
      campo: CAMPO_CONSUMIDOR_FINAL
    });
  }
  if (vazio(nota.tipo_contribuinte)) {
    impede("TIPO_CONTRIBUINTE_VAZIO", "Destinatário", "Tipo de contribuinte não informado.", {
      tipo: "aba",
      bloco: "Destinatário",
      campo: CAMPO_TIPO_CONTRIBUINTE
    });
  }
  if (numero(nota.valor_total_nf) <= 0) {
    impede("VALOR_TOTAL_NF_INVALIDO", "Totais", "O total da nota está zerado.", {
      tipo: "aba",
      bloco: "Totais"
    });
  }

  /* --- Destinatário (vw_..._destinatario + fn_alertas_nfe) --- */

  if (idCliente === null) {
    impede("DESTINATARIO_SEM_CLIENTE", "Destinatário", "A nota não aponta para um cliente.", semDestino);
  } else if (!cliente) {
    impede(
      "DESTINATARIO_NAO_LOCALIZADO",
      "Destinatário",
      "Cliente da nota não localizado no cadastro.",
      noCadastro()
    );
  }

  if (cliente) {
    if (vazio(cliente.nome)) {
      impede(
        "DESTINATARIO_SEM_NOME",
        "Destinatário",
        "Cliente sem nome/razão social no cadastro.",
        noCadastro("nome")
      );
    }
    if (vazio(cliente.documento)) {
      impede(
        "DESTINATARIO_SEM_DOCUMENTO",
        "Destinatário",
        "Cliente sem CPF/CNPJ no cadastro.",
        noCadastro("documento")
      );
    }
  }

  if (idCliente !== null) {
    if (!enderecoPrincipal || vazio(enderecoPrincipal.id)) {
      impede(
        "ENDERECO_PRINCIPAL_AUSENTE",
        "Destinatário",
        "Cliente sem endereço Principal cadastrado.",
        noCadastro("enderecos")
      );
    } else {
      const camposEndereco: Array<[keyof EnderecoParaPendencias, string, string]> = [
        ["cep", "ENDERECO_PRINCIPAL_SEM_CEP", "CEP"],
        ["endereco", "ENDERECO_PRINCIPAL_SEM_LOGRADOURO", "logradouro"],
        ["numero", "ENDERECO_PRINCIPAL_SEM_NUMERO", "número"],
        ["bairro", "ENDERECO_PRINCIPAL_SEM_BAIRRO", "bairro"],
        ["cidade", "ENDERECO_PRINCIPAL_SEM_CIDADE", "cidade"],
        ["uf", "ENDERECO_PRINCIPAL_SEM_UF", "UF"]
      ];
      for (const [campo, codigo, rotulo] of camposEndereco) {
        if (vazio(enderecoPrincipal[campo] as Texto)) {
          impede(
            codigo,
            "Destinatário",
            `Endereço Principal do cliente sem ${rotulo}.`,
            noCadastro("enderecos")
          );
        }
      }
    }
  }

  const documentoDigitos = digitos(cliente?.documento);
  const tipoContribuinte = texto(nota.tipo_contribuinte);
  const consumidorFinal = texto(nota.consumidor_final);

  if (documentoDigitos.length === 11 && (tipoContribuinte !== "9" || consumidorFinal !== "1")) {
    impede(
      "CPF_COM_TIPO_CONTRIBUINTE_INVALIDO",
      "Destinatário",
      "Destinatário com CPF precisa ser tipo 9 (não contribuinte) e consumidor final 1. Os dois campos estão aqui, na aba Destinatário.",
      { tipo: "aba", bloco: "Destinatário", campo: CAMPO_TIPO_CONTRIBUINTE }
    );
  }
  /*
    As duas abaixo dependem do TIPO DE CONTRIBUINTE, que é coluna da própria
    nota (`notas_fiscais.tipo_contribuinte`) e se corrige na aba Destinatário
    desta tela — mudar no cadastro do cliente não reflete aqui nem recarregando.
    Por isso o link vem para a aba, e o texto diz onde fica cada conserto: o
    tipo aqui, a IE no cadastro.
  */
  if (tipoContribuinte === "1" && ieAusente(cliente)) {
    impede(
      "CONTRIBUINTE_SEM_IE",
      "Destinatário",
      "Destinatário marcado como contribuinte de ICMS e sem IE válida. O tipo de contribuinte se corrige aqui, na aba Destinatário; a IE, no cadastro do cliente.",
      { tipo: "aba", bloco: "Destinatário", campo: CAMPO_TIPO_CONTRIBUINTE }
    );
  }
  if (documentoDigitos.length === 14 && tipoContribuinte === "2" && ieAusente(cliente)) {
    impede(
      "CNPJ_CONTRIBUINTE_ISENTO_SEM_IE",
      "Destinatário",
      "CNPJ marcado como contribuinte isento e sem IE — a SEFAZ costuma rejeitar. O tipo de contribuinte se corrige aqui, na aba Destinatário; a IE, no cadastro do cliente.",
      { tipo: "aba", bloco: "Destinatário", campo: CAMPO_TIPO_CONTRIBUINTE }
    );
  }
  if (tipoContribuinte === "9" && consumidorFinal !== "1") {
    impede(
      "NAO_CONTRIBUINTE_SEM_CONSUMIDOR_FINAL",
      "Destinatário",
      "Destinatário não contribuinte precisa ter consumidor final 1.",
      { tipo: "aba", bloco: "Destinatário", campo: CAMPO_CONSUMIDOR_FINAL }
    );
  }

  /* --- Itens (vw_..._itens + fn_alertas_nfe) --- */

  if (itens.length === 0) {
    impede("SEM_ITENS", "Itens", "A nota não tem nenhum item ativo.", {
      tipo: "aba",
      bloco: "Itens"
    });
  }

  for (const item of itens) {
    const rotulo = rotuloItem(item);
    const destinoItem = (campo: string): DestinoPendencia => ({
      tipo: "aba",
      bloco: "Itens",
      campo: campoDoItem(item.id, campo),
      idItem: item.id
    });

    if (vazio(item.descricao)) {
      impede("ITEM_SEM_DESCRICAO", "Itens", `${rotulo} sem descrição.`, destinoItem("descricao"));
    }
    if (vazio(item.ncm)) {
      impede("ITEM_SEM_NCM", "Itens", `${rotulo} sem NCM.`, destinoItem("ncm"));
    }
    if (vazio(item.cfop)) {
      impede("ITEM_SEM_CFOP", "Itens", `${rotulo} sem CFOP.`, destinoItem("cfop"));
    }
    if (item.quantidade === null || item.quantidade === undefined || numero(item.quantidade) <= 0) {
      impede("ITEM_QUANTIDADE_INVALIDA", "Itens", `${rotulo} com quantidade inválida.`, destinoItem("quantidade"));
    }
    if (
      item.valor_unitario === null ||
      item.valor_unitario === undefined ||
      numero(item.valor_unitario) < 0
    ) {
      impede(
        "ITEM_VALOR_UNITARIO_INVALIDO",
        "Itens",
        `${rotulo} com valor unitário inválido.`,
        destinoItem("valor-unitario")
      );
    }
    if (item.valor_bruto === null || item.valor_bruto === undefined || numero(item.valor_bruto) <= 0) {
      impede(
        "ITEM_VALOR_BRUTO_INVALIDO",
        "Itens",
        `${rotulo} com valor bruto zerado ou negativo.`,
        destinoItem("valor-bruto")
      );
    }
    if (vazio(item.unidade_comercial)) {
      impede("ITEM_SEM_UNIDADE_COMERCIAL", "Itens", `${rotulo} sem unidade comercial.`, destinoItem("unidade-comercial"));
    }
    if (vazio(item.unidade_tributavel)) {
      impede("ITEM_SEM_UNIDADE_TRIBUTAVEL", "Itens", `${rotulo} sem unidade tributável.`, destinoItem("unidade-tributavel"));
    }
    if (vazio(item.icms_origem)) {
      impede("ITEM_SEM_ICMS_ORIGEM", "Itens", `${rotulo} sem origem do ICMS.`, destinoItem("icms-origem"));
    }
    // Campo vazio barra a emissão do mesmo jeito nos dois casos. O que muda é o
    // texto: na devolução o vazio é esperado, e o operador precisa saber que a
    // resposta está na nota de origem, não no cadastro.
    const espelhaOrigem = nota.naturezaSemTributacaoPadrao === true;
    const faltaCst = (imposto: string) =>
      espelhaOrigem
        ? `${rotulo} sem ${imposto}. A devolução espelha a nota de origem: informe a situação tributária que consta nela.`
        : `${rotulo} sem situação tributária do ${imposto}.`;

    if (vazio(item.icms_situacao_tributaria)) {
      impede("ITEM_SEM_ICMS_CST", "Itens", faltaCst("ICMS"), destinoItem("icms-cst"));
    }
    if (vazio(item.pis_situacao_tributaria)) {
      impede("ITEM_SEM_PIS_CST", "Itens", faltaCst("PIS"), destinoItem("pis-cst"));
    }
    if (vazio(item.cofins_situacao_tributaria)) {
      impede("ITEM_SEM_COFINS_CST", "Itens", faltaCst("COFINS"), destinoItem("cofins-cst"));
    }

    // vw_nfe_itens_conferencia_valores: bruto x (qtd x unitário), comercial e tributável.
    const bruto = numero(item.valor_bruto);
    const comercial = arred(numero(item.quantidade) * numero(item.valor_unitario), 2);
    const qtdTributavel = item.quantidade_tributavel ?? item.quantidade;
    const unitTributavel = item.valor_unitario_tributavel ?? item.valor_unitario;
    const tributavel = arred(numero(qtdTributavel) * numero(unitTributavel), 2);

    if (
      Math.abs(arred(bruto - comercial, 2)) > 0.01 ||
      Math.abs(arred(bruto - tributavel, 2)) > 0.01
    ) {
      impede(
        "ITEM_VALOR_TRIBUTAVEL_DIVERGENTE",
        "Itens",
        `${rotulo}: o valor bruto não bate com quantidade x valor unitário.`,
        destinoItem("valor-bruto")
      );
    }
  }

  /* --- Totais (fn_alertas_nfe) --- */

  const totalItens = arred(
    itens.reduce((soma, item) => soma + numero(item.valor_bruto), 0),
    2
  );
  if (arred(numero(nota.valor_produtos), 2) !== totalItens) {
    impede(
      "TOTAL_PRODUTOS_DIVERGENTE",
      "Totais",
      `Total de produtos da nota (${moeda(numero(nota.valor_produtos))}) não bate com a soma dos itens (${moeda(totalItens)}). Salve para recalcular.`,
      { tipo: "aba", bloco: "Totais" }
    );
  }

  /* --- Pagamentos (fn_alertas_nfe + trava da tela) --- */

  const totalPagamentos = arred(
    pagamentos.reduce((soma, pagamento) => soma + numero(pagamento.valor), 0),
    2
  );
  const diferencaPagamento = arred(numero(nota.valor_total_nf) - totalPagamentos, 2);

  if (pagamentos.length === 0) {
    avisa(
      "SEM_PAGAMENTOS",
      "Pagamentos",
      "A nota não tem parcelas. É permitido, mas nada aparece no DANFE.",
      { tipo: "aba", bloco: "Pagamentos" }
    );
  } else if (Math.abs(diferencaPagamento) > 0.01) {
    impede(
      "PAGAMENTOS_DIVERGENTES",
      "Pagamentos",
      `As parcelas somam ${moeda(totalPagamentos)} e a nota fecha em ${moeda(numero(nota.valor_total_nf))} — diferença de ${moeda(Math.abs(diferencaPagamento))}.`,
      { tipo: "aba", bloco: "Pagamentos" }
    );
  }

  // Espelha a trava de `handleConcludeDraft`, que continua valendo no clique.
  const dataEmissao = texto(nota.created_at).split("T")[0];
  if (dataEmissao) {
    const vencidas = pagamentos.filter((pagamento) => {
      if (!pagamento.data_vencimento) return false;
      return String(pagamento.data_vencimento).split("T")[0] < dataEmissao;
    });
    if (vencidas.length > 0) {
      impede(
        "PAGAMENTO_VENCIMENTO_ANTERIOR_EMISSAO",
        "Pagamentos",
        vencidas.length === 1
          ? "Há uma parcela com vencimento anterior à data de emissão."
          : `Há ${vencidas.length} parcelas com vencimento anterior à data de emissão.`,
        { tipo: "aba", bloco: "Pagamentos" }
      );
    }
  }

  /* --- Transporte / Frete (fn_alertas_nfe) --- */

  if (vazio(nota.modalidade_frete)) {
    impede("MODALIDADE_FRETE_VAZIA", "Transporte/Frete", "Modalidade do frete não informada.", {
      tipo: "aba",
      bloco: "Transporte/Frete",
      campo: CAMPO_MODALIDADE_FRETE
    });
  }
  if (numero(nota.valor_frete) > 0 && texto(nota.modalidade_frete) === "9") {
    avisa(
      "FRETE_COM_MODALIDADE_SEM_TRANSPORTE",
      "Transporte/Frete",
      "Há valor de frete, mas a modalidade está como 9 (sem ocorrência de transporte).",
      { tipo: "aba", bloco: "Transporte/Frete", campo: CAMPO_MODALIDADE_FRETE }
    );
  }

  const pesoItensKg = arred(
    itens.reduce((soma, item) => soma + numero(item.peso_total_gramas), 0) / 1000,
    3
  );
  const diferencaPeso = arred(numero(nota.peso_liquido) - pesoItensKg, 3);
  if (Math.abs(diferencaPeso) > 0.1) {
    avisa(
      "PESO_LIQUIDO_DIVERGENTE",
      "Transporte/Frete",
      `Peso líquido do cabeçalho (${numero(nota.peso_liquido)} kg) difere da soma dos itens (${pesoItensKg} kg).`,
      { tipo: "aba", bloco: "Transporte/Frete" }
    );
  }

  /* --- Informações adicionais (fn_alertas_nfe) --- */

  if (texto(nota.informacoes_complementares).toLowerCase() === "false") {
    avisa(
      "INFORMACOES_COMPLEMENTARES_FALSE",
      "Informações adicionais",
      'As informações complementares estão gravadas com o texto "false".',
      { tipo: "aba", bloco: "Informações adicionais" }
    );
  }

  return [...impeditivas, ...avisos];
}

/** Só as que travam o botão de emitir. */
export function pendenciasQueImpedem(pendencias: Pendencia[]): Pendencia[] {
  return pendencias.filter((pendencia) => pendencia.severidade === "impede");
}

/** Atalho de leitura para desabilitar o botão. */
export function impedeEmissao(pendencias: Pendencia[]): boolean {
  return pendencias.some((pendencia) => pendencia.severidade === "impede");
}

/**
 * Converte mensagens bloqueantes devolvidas pelo servidor em pendências.
 *
 * Serve para o que o cliente não tem como saber — `PAYLOAD_NULL` é o caso de
 * hoje — e para qualquer alerta que o banco passe a emitir sem que este módulo
 * saiba. Sem destino: a mensagem é do servidor, não de um campo da tela.
 */
export function pendenciasDoServidor(mensagens: string[]): Pendencia[] {
  return mensagens
    .map((mensagem) => texto(mensagem))
    .filter((mensagem) => mensagem !== "")
    .map((mensagem, indice) => ({
      codigo: `VALIDACAO_SERVIDOR_${indice + 1}`,
      bloco: "Validação" as BlocoNfe,
      severidade: "impede" as SeveridadePendencia,
      texto: mensagem,
      destino: { tipo: "sem-destino" } as DestinoPendencia
    }));
}
