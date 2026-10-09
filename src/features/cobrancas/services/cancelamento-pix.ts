/**
 * Cancelamento de PIX no banco pelo webhook `del-pix-vibe` — PASSO A (09/10/2026).
 *
 * O DEFEITO (provado nas execuções do n8n de 27/09 a 09/10/2026)
 *   A rota `cancelar-externo` chamava o webhook e só conferia o HTTP. O fluxo
 *   do n8n responde 200 SEMPRE, mesmo quando o banco recusa: os nós do banco
 *   seguem em frente em caso de erro. Resultado: o Vibe gravava CANCELADO e o
 *   PIX continuava valendo no banco.
 *     - Birô (Inter): 8 recusas em 8 — o Inter exige `motivoCancelamento`, que o
 *       fluxo tira de `body.motivo`, e a rota não mandava esse campo;
 *     - C6 (empresas 1 e 3): 2 recusas em 71 — uma delas a 23411-A, paga 15
 *       segundos depois de "cancelada".
 *
 * O QUE ESTE PASSO FAZ
 *   - manda `motivo` (texto FIXO, nunca o que o usuário digitou) e o cabeçalho
 *     do segredo;
 *   - teto de tempo na chamada;
 *   - PIX do C6: só é cancelado no Vibe quando a resposta confirma
 *     (`cancelado: true`). Recusa, erro, resposta sem confirmação, rede ou tempo
 *     esgotado deixam a cobrança ATIVA;
 *   - PIX do Inter: a decisão continua pelo HTTP, como antes, e a rota só
 *     REGISTRA o que a regra nova decidiria. Motivo: o fluxo do Inter hoje
 *     devolve `cancelado: false` até quando o banco cancela; a regra rígida ali
 *     depende de o n8n ser corrigido antes (passo B).
 *
 * Sem `next/server` e sem variável de ambiente: roda em teste.
 */

export const WEBHOOK_CANCELA_PIX = "https://10074.hostoo.net.br/webhook/del-pix-vibe";

/** Teto da chamada ao n8n. Estouro deixa a cobrança ativa. */
export const TEMPO_LIMITE_CANCELAMENTO_PIX_MS = 25_000;

/**
 * Motivo enviado ao banco. FIXO: 70 cancelamentos têm "." como motivo digitado,
 * e texto livre do usuário não vai para o banco.
 *
 * "ACERTOS" porque serve nas duas leituras possíveis do campo
 * `motivoCancelamento` do Inter: é um dos valores da lista da API antiga de
 * boletos e, onde o campo é texto livre, é só um texto curto. O formato que o
 * Inter aceita na cobrança v3 NÃO foi testado (não se chama o banco em
 * investigação): confirmar com um PIX de teste.
 */
export const MOTIVO_FIXO_DE_CANCELAMENTO = "ACERTOS";

export const MENSAGEM_PIX_NAO_CANCELADO_NO_BANCO =
  "Não foi possível cancelar o PIX no banco. A cobrança continua ativa: não gere outra cobrança para este pedido.";

/** Empresa cujo PIX sai pelo Banco Inter. As outras (1 e 3) saem pelo C6. */
const EMPRESA_INTER = 2;

export type RegraDoCancelamentoPix = "CONFIRMACAO_DO_BANCO" | "HTTP";

/** A regra que DECIDE, por empresa, neste passo. */
export function regraDoCancelamentoPix(idEmpresa: number | null | undefined): RegraDoCancelamentoPix {
  return Number(idEmpresa) === EMPRESA_INTER ? "HTTP" : "CONFIRMACAO_DO_BANCO";
}

/** O corpo do webhook: os dois campos de sempre, na mesma forma, mais o motivo fixo. */
export function corpoDoCancelamentoPix(entrada: { codigoDoBanco: string; idEmpresa: number }) {
  return {
    cod_validador: entrada.codigoDoBanco,
    id_empresa: String(entrada.idEmpresa),
    motivo: MOTIVO_FIXO_DE_CANCELAMENTO
  };
}

export type RespostaDoWebhookPix =
  | { tipo: "RESPOSTA"; ok: boolean; status: number; texto: string }
  /** Não houve resposta: rede ou tempo esgotado. O estado no banco é desconhecido. */
  | { tipo: "INDISPONIVEL"; tempoEsgotado: boolean };

/** Chama o webhook, com teto de tempo. Nunca lança. */
export async function chamarCancelamentoDePix(entrada: {
  corpo: Record<string, unknown>;
  cabecalhos: Record<string, string>;
  tempoLimiteMs?: number;
  buscar?: typeof fetch;
}): Promise<RespostaDoWebhookPix> {
  const buscar = entrada.buscar ?? fetch;
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), entrada.tempoLimiteMs ?? TEMPO_LIMITE_CANCELAMENTO_PIX_MS);
  try {
    const resposta = await buscar(WEBHOOK_CANCELA_PIX, {
      method: "POST",
      headers: entrada.cabecalhos,
      body: JSON.stringify(entrada.corpo),
      signal: controle.signal
    });
    const texto = await resposta.text();
    return { tipo: "RESPOSTA", ok: resposta.ok, status: resposta.status, texto };
  } catch {
    return { tipo: "INDISPONIVEL", tempoEsgotado: controle.signal.aborted };
  } finally {
    clearTimeout(relogio);
  }
}

export type ConfirmacaoDoBanco = "CANCELOU" | "NAO_CANCELOU" | "SEM_INFORMACAO";

/**
 * O que a resposta diz sobre o cancelamento no banco.
 *
 * O fluxo monta `{ success, cancelado, status, txid, mensagem }`. O corpo chega
 * como TEXTO, e o n8n pode entregá-lo como JSON puro ou embrulhado
 * (`=[Object: {...}]`), conforme a versão. Por isso a leitura procura o campo
 * `cancelado` no texto, em vez de exigir JSON válido.
 *
 * `SEM_INFORMACAO`: o campo não aparece. Não é confirmação.
 */
export function confirmacaoDoBancoNaResposta(texto: string): ConfirmacaoDoBanco {
  const achado = /"?\bcancelado\b"?\s*:\s*(true|false)\b/i.exec(String(texto ?? ""));
  if (!achado) return "SEM_INFORMACAO";
  return achado[1].toLowerCase() === "true" ? "CANCELOU" : "NAO_CANCELOU";
}

export type DecisaoDoCancelamentoPix = {
  /** Pode gravar CANCELADO no Vibe? */
  cancelarNoVibe: boolean;
  regra: RegraDoCancelamentoPix;
  /** O que a regra rígida (confirmação do banco) decidiria. Igual a `cancelarNoVibe` no C6. */
  cancelariaPelaConfirmacao: boolean;
  confirmacao: ConfirmacaoDoBanco | "SEM_RESPOSTA";
  /** Status HTTP para devolver à tela quando NÃO cancela. */
  statusHttp: number;
  /** Uma palavra para o log, sem dado de cliente. */
  desfecho:
    | "BANCO_CONFIRMOU"
    | "BANCO_RECUSOU"
    | "RESPOSTA_SEM_CONFIRMACAO"
    | "ERRO_HTTP"
    | "REDE"
    | "TEMPO_ESGOTADO"
    | "HTTP_OK_SEM_CONFERIR";
};

export function decidirCancelamentoDePix(idEmpresa: number | null | undefined, resposta: RespostaDoWebhookPix): DecisaoDoCancelamentoPix {
  const regra = regraDoCancelamentoPix(idEmpresa);

  // Sem resposta: ninguém cancela, em regra nenhuma. O estado no banco é desconhecido.
  if (resposta.tipo === "INDISPONIVEL") {
    return {
      cancelarNoVibe: false,
      regra,
      cancelariaPelaConfirmacao: false,
      confirmacao: "SEM_RESPOSTA",
      statusHttp: 502,
      desfecho: resposta.tempoEsgotado ? "TEMPO_ESGOTADO" : "REDE"
    };
  }

  const confirmacao = confirmacaoDoBancoNaResposta(resposta.texto);
  const cancelariaPelaConfirmacao = resposta.ok && confirmacao === "CANCELOU";

  // Erro HTTP já era recusa antes, nos dois bancos.
  if (!resposta.ok) {
    return { cancelarNoVibe: false, regra, cancelariaPelaConfirmacao: false, confirmacao, statusHttp: resposta.status || 502, desfecho: "ERRO_HTTP" };
  }

  if (regra === "HTTP") {
    // Inter, neste passo: decide como antes. O que a regra nova diria vai só para o log.
    return { cancelarNoVibe: true, regra, cancelariaPelaConfirmacao, confirmacao, statusHttp: 200, desfecho: "HTTP_OK_SEM_CONFERIR" };
  }

  if (confirmacao === "CANCELOU") {
    return { cancelarNoVibe: true, regra, cancelariaPelaConfirmacao: true, confirmacao, statusHttp: 200, desfecho: "BANCO_CONFIRMOU" };
  }
  return {
    cancelarNoVibe: false,
    regra,
    cancelariaPelaConfirmacao: false,
    confirmacao,
    statusHttp: 409,
    desfecho: confirmacao === "NAO_CANCELOU" ? "BANCO_RECUSOU" : "RESPOSTA_SEM_CONFIRMACAO"
  };
}
