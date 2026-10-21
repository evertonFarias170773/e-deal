/**
 * QUANDO A ROTA DE PREPOSTAGEM PODE CRIAR OUTRA (21/10/2026).
 *
 * Prepostagem e escrita externa que cobra do contrato, e ate hoje a rota criava uma nova a cada chamada
 * ("SEM LIMITE DE GERACOES", 24/08). A unica protecao era a confirmacao da tela — que deixava de valer
 * depois do primeiro clique na mesma sessao. Resultado: 28 pedidos com dois codigos. A regra agora mora
 * no SERVIDOR, e a tela so a espelha:
 *
 *   - sem prepostagem viva: gera, como sempre;
 *   - com prepostagem viva: recusa com 409 e devolve o codigo atual, a menos que a chamada traga
 *     `substituir: true` E o codigo que o usuario viu, e esse codigo seja o gravado agora.
 *
 * "Viva" = ha codigo (`correios_codigo_objeto` ou `correios_id_prepostagem`) e ela nao foi marcada como
 * cancelada no portal (`prepostagem_cancelada_em`). Cancelada nao pede confirmacao: quem cancelou ja disse
 * que o objeto morreu.
 *
 * Funcao pura: nao le banco nem fala com os Correios.
 */

export type ExpedicaoDaPrepostagem = {
  correios_codigo_objeto?: string | null;
  correios_id_prepostagem?: string | null;
  prepostagem_cancelada_em?: string | null;
};

export type DecisaoPrepostagem =
  | { acao: "gerar" }
  | {
      acao: "recusar";
      code: "PREPOSTAGEM_JA_EXISTE" | "CODIGO_VISTO_DIFERENTE";
      /** O codigo gravado agora: e o que a tela deve mostrar na confirmacao. */
      codigoAtual: string;
      message: string;
    };

/** O codigo que a tela mostra: o do objeto, senao o id da prepostagem. Mesma precedencia do modal. */
export function codigoAtualDaPrepostagem(exp: ExpedicaoDaPrepostagem | null | undefined): string {
  return String(exp?.correios_codigo_objeto ?? "").trim() || String(exp?.correios_id_prepostagem ?? "").trim();
}

/** Ha prepostagem que ainda vale (nao marcada como cancelada no portal). */
export function prepostagemVivaDoRegistro(exp: ExpedicaoDaPrepostagem | null | undefined): boolean {
  if (!codigoAtualDaPrepostagem(exp)) return false;
  return !String(exp?.prepostagem_cancelada_em ?? "").trim();
}

export function decidirGeracaoPrepostagem(entrada: {
  exp: ExpedicaoDaPrepostagem | null | undefined;
  substituir: boolean;
  codigoVisto: string | null | undefined;
}): DecisaoPrepostagem {
  if (!prepostagemVivaDoRegistro(entrada.exp)) return { acao: "gerar" };

  const codigoAtual = codigoAtualDaPrepostagem(entrada.exp);
  if (!entrada.substituir) {
    return {
      acao: "recusar",
      code: "PREPOSTAGEM_JA_EXISTE",
      codigoAtual,
      message: `Este pedido já tem prepostagem dos Correios (${codigoAtual}). Para gerar outra, confirme a substituição.`
    };
  }
  if (String(entrada.codigoVisto ?? "").trim() !== codigoAtual) {
    return {
      acao: "recusar",
      code: "CODIGO_VISTO_DIFERENTE",
      codigoAtual,
      message: `A prepostagem do pedido mudou: o código gravado agora é ${codigoAtual}. Confira e confirme de novo.`
    };
  }
  return { acao: "gerar" };
}

/** Origem da trilha em `os_status_log` de cada geracao. */
export const ORIGEM_LOG_PREPOSTAGEM = "EXPEDICAO_PREPOSTAGEM";

/** Texto do `os_status_log.motivo`: servico, codigo novo e, quando substitui, o que saiu. */
export function motivoDaGeracaoPrepostagem(entrada: {
  servico: "SEDEX" | "PAC";
  codigoNovo: string;
  codigoSubstituido: string | null;
}): string {
  const base = `Prepostagem ${entrada.servico} gerada: ${entrada.codigoNovo}`;
  return entrada.codigoSubstituido ? `${base} (substitui ${entrada.codigoSubstituido})` : base;
}
