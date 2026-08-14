/**
 * Regras puras da edição de proposta com cobrança FATURADA a vencer.
 *
 * POR QUE ESTE FLUXO EXISTE
 *   Faturado a vencer é receita autorizada, não dinheiro recebido. Enquanto o
 *   título não é liquidado, o pedido ainda pode mudar — trocar o frete,
 *   incluir ou excluir produto — e o valor do faturado simplesmente acompanha.
 *   Sem esta regra a proposta caía no fluxo de "proposta paga": o
 *   `editar-paga` conta `A_VENCER + confirmado` como pago, abre pendência de
 *   Conta Corrente pela diferença e trava novas edições. Isso criava crédito
 *   ou débito de um dinheiro que nunca entrou.
 *
 * O QUE A EDIÇÃO FAZ
 *   Ajusta `pagamentos_v2.valor` da cobrança faturada. Como o faturamento sai
 *   de `pagamentos_v2`, o número do mês acompanha sozinho — não existe outro
 *   lugar para corrigir.
 *
 * O QUE ELA NÃO FAZ
 *   Não toca em dinheiro já recebido. Numa proposta mista (PIX pago + faturado
 *   a vencer) o faturado absorve toda a diferença; a parte paga fica intacta.
 *   Se a diferença não couber no faturado, o fluxo é recusado — a sobra é
 *   assunto da Conta Corrente, não daqui.
 *
 * Sem I/O de propósito: a tela decide se destrava o formulário e a rota
 * `editar-paga` revalida antes de gravar, os dois a partir daqui.
 */

/** Tolerância de centavo, igual à usada em `editar-paga`. */
const TOLERANCIA = 0.02;

const STATUS_COBRANCA_INATIVA = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

export type CobrancaParaFaturado = {
  id: string;
  id_pagamento?: string | null;
  tipo_cobranca?: string | null;
  status?: string | null;
  paid_at?: string | null;
  valor?: number | string | null;
};

export type TituloParaFaturado = {
  id: string;
  id_pagamento?: string | null;
  parcela?: number | null;
  total_parcelas?: number | null;
  valor?: number | string | null;
  vencimento?: string | null;
  status?: string | null;
  paid_at?: string | null;
  deposito_conta?: boolean | null;
  id_boleto_c6?: string | null;
  id_empresa?: number | null;
};

export type MotivoInelegivel =
  | "SEM_FATURADO"
  | "MAIS_DE_UM_FATURADO"
  | "FATURADO_LIQUIDADO"
  | "TITULO_QUITADO"
  | "TITULO_AMBIGUO"
  | "VALOR_NAO_CABE";

export type Inelegivel = { elegivel: false; motivo: MotivoInelegivel; mensagem: string };

/** Elegibilidade ESTRUTURAL: não depende do novo total. */
export type ElegibilidadeFaturado =
  | Inelegivel
  | {
      elegivel: true;
      /** `pagamentos_v2.id` da cobrança faturada que absorve a diferença. */
      faturadoId: string;
      /** Soma das demais cobranças ativas — a parte que NÃO se mexe. */
      valorOutrasCobrancas: number;
      /** Títulos do Contas a Receber que precisam sair antes da edição. */
      titulosParaExcluir: TituloParaFaturado[];
    };

export type AvaliacaoFaturado =
  | Inelegivel
  | {
      elegivel: true;
      faturadoId: string;
      /** Novo `valor` da cobrança faturada, já arredondado a 2 casas. */
      novoValorFaturado: number;
      valorOutrasCobrancas: number;
      titulosParaExcluir: TituloParaFaturado[];
    };

function numero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function centavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function normalizar(texto: unknown): string {
  return String(texto ?? "").trim().toUpperCase();
}

export function isCobrancaAtiva(cobranca: CobrancaParaFaturado): boolean {
  return !STATUS_COBRANCA_INATIVA.includes(normalizar(cobranca.status));
}

/** `E-FATURADO` e `E-Faturado` convivem na base; o underline aparece em import antigo. */
export function isTipoFaturado(tipoCobranca: unknown): boolean {
  return normalizar(tipoCobranca).replace(/_/g, "-") === "E-FATURADO";
}

/**
 * Faturado que ainda pode absorver mudança: a vencer e sem liquidação.
 * `confirmado` NÃO entra — confirmar é conferência, não recebimento, e é
 * justamente o estado em que o financeiro precisa de flexibilidade.
 */
export function isFaturadoAjustavel(cobranca: CobrancaParaFaturado): boolean {
  if (!isTipoFaturado(cobranca.tipo_cobranca)) return false;
  if (normalizar(cobranca.status) !== "A_VENCER") return false;
  return !cobranca.paid_at;
}

export function isTituloAtivo(titulo: TituloParaFaturado): boolean {
  return normalizar(titulo.status) !== "CANCELADO";
}

export function isTituloQuitado(titulo: TituloParaFaturado): boolean {
  return normalizar(titulo.status) === "PAID" || Boolean(titulo.paid_at);
}

/** Boleto registrado no banco precisa ser cancelado lá antes de sair daqui. */
export function tituloExigeCancelamentoBancario(titulo: TituloParaFaturado): boolean {
  if (titulo.deposito_conta === true) return false;
  return Boolean(String(titulo.id_boleto_c6 ?? "").trim());
}

export function rotuloTitulo(titulo: TituloParaFaturado): string {
  const parcela = titulo.parcela ?? 1;
  const total = titulo.total_parcelas ?? 1;
  const tipo = titulo.deposito_conta === true ? "Depósito" : "Boleto";
  return `${tipo} ${parcela}/${total}`;
}

/**
 * Elegibilidade estrutural: esta proposta entra no caminho do faturado?
 *
 * Não olha o novo total DE PROPÓSITO. É o que a tela usa para destravar o
 * formulário, e destravar não pode depender do que o usuário acabou de
 * digitar — senão baixar o total abaixo do já pago congelaria a edição no
 * meio, sem como desfazer. O valor é conferido na hora de salvar, por
 * `avaliarEdicaoFaturado`.
 */
export function avaliarElegibilidadeFaturado(entrada: {
  cobrancas: CobrancaParaFaturado[];
  titulos: TituloParaFaturado[];
}): ElegibilidadeFaturado {
  const ativas = entrada.cobrancas.filter(isCobrancaAtiva);
  const faturados = ativas.filter(isFaturadoAjustavel);

  if (faturados.length === 0) {
    // Faturado ativo porém já liquidado é caso diferente de não ter faturado:
    // ali houve recebimento e a mensagem precisa dizer isso.
    const liquidado = ativas.find(
      (c) => isTipoFaturado(c.tipo_cobranca) && (Boolean(c.paid_at) || normalizar(c.status) === "PAID")
    );
    if (liquidado) {
      return {
        elegivel: false,
        motivo: "FATURADO_LIQUIDADO",
        mensagem: "A cobrança faturada desta proposta já foi liquidada. Alterações após o recebimento seguem pela Conta Corrente."
      };
    }
    return {
      elegivel: false,
      motivo: "SEM_FATURADO",
      mensagem: "Esta proposta não tem cobrança faturada a vencer."
    };
  }

  if (faturados.length > 1) {
    return {
      elegivel: false,
      motivo: "MAIS_DE_UM_FATURADO",
      mensagem: "Esta proposta tem mais de uma cobrança faturada a vencer. Deixe apenas uma ativa antes de alterar o pedido."
    };
  }

  const faturado = faturados[0];
  const titulosAtivos = entrada.titulos.filter(isTituloAtivo);
  const referencia = String(faturado.id_pagamento ?? "").trim();

  // Com uma única cobrança na proposta, todo título dela é do faturado —
  // inclusive os antigos, gravados antes de `id_pagamento` existir (quase
  // metade da base). Havendo outras cobranças, só o vínculo explícito serve:
  // apagar título de outra cobrança seria destruir recebível alheio.
  const propostaTemSoUmaCobranca = ativas.length === 1;
  const titulosDoFaturado = propostaTemSoUmaCobranca
    ? titulosAtivos
    : titulosAtivos.filter((t) => referencia !== "" && String(t.id_pagamento ?? "").trim() === referencia);

  if (!propostaTemSoUmaCobranca) {
    const semVinculo = titulosAtivos.filter((t) => !String(t.id_pagamento ?? "").trim());
    if (semVinculo.length > 0) {
      return {
        elegivel: false,
        motivo: "TITULO_AMBIGUO",
        mensagem: `Esta proposta tem ${semVinculo.length} título(s) no Contas a Receber sem vínculo com uma cobrança específica, e ela tem mais de uma cobrança. Regularize o vínculo antes de alterar o pedido.`
      };
    }
  }

  const quitado = titulosDoFaturado.find(isTituloQuitado);
  if (quitado) {
    return {
      elegivel: false,
      motivo: "TITULO_QUITADO",
      mensagem: `${rotuloTitulo(quitado)} já está quitado no Contas a Receber. Proposta com título liquidado não pode ser alterada por aqui.`
    };
  }

  const valorOutrasCobrancas = centavos(
    ativas.filter((c) => c.id !== faturado.id).reduce((soma, c) => soma + numero(c.valor), 0)
  );

  return {
    elegivel: true,
    faturadoId: faturado.id,
    valorOutrasCobrancas,
    titulosParaExcluir: titulosDoFaturado
  };
}

/**
 * Elegibilidade estrutural MAIS o valor: qual passa a ser o `valor` da
 * cobrança faturada depois da alteração.
 *
 * `novoTotal` é o total da proposta DEPOIS da alteração. O faturado absorve
 * toda a diferença; as demais cobranças ficam intactas.
 */
export function avaliarEdicaoFaturado(entrada: {
  cobrancas: CobrancaParaFaturado[];
  titulos: TituloParaFaturado[];
  novoTotal: number;
}): AvaliacaoFaturado {
  const elegibilidade = avaliarElegibilidadeFaturado(entrada);
  if (!elegibilidade.elegivel) return elegibilidade;

  const novoValorFaturado = centavos(centavos(entrada.novoTotal) - elegibilidade.valorOutrasCobrancas);

  if (novoValorFaturado <= TOLERANCIA) {
    return {
      elegivel: false,
      motivo: "VALOR_NAO_CABE",
      mensagem: elegibilidade.valorOutrasCobrancas > 0
        ? `O novo total da proposta não cobre as outras cobranças (R$ ${elegibilidade.valorOutrasCobrancas.toFixed(2).replace(".", ",")}), então não sobra valor para o faturado. Cancele a cobrança faturada ou resolva a diferença pelas outras cobranças.`
        : "O novo total da proposta é zero ou negativo. Cancele a cobrança faturada em vez de zerá-la."
    };
  }

  return { ...elegibilidade, novoValorFaturado };
}
