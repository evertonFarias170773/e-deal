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
 * AJUSTE DE 13/10/2026 (pedido 23481)
 *   De 09 a 13/10 o C6 respondeu REMOVIDA_PELO_USUARIO_RECEBEDOR em TODAS as
 *   tentativas (6 cobranças, 16 chamadas) e o Vibe recusou todas: o nó de
 *   resposta do n8n devolve TEXTO montado com um objeto, e o texto chega sem o
 *   campo `cancelado`. O PIX saía do banco e a cobrança ficava ativa aqui.
 *   - O STATUS do banco passa a valer como confirmação, junto de `cancelado`:
 *     REMOVIDA_PELO_USUARIO_RECEBEDOR é cancelamento, inclusive quando o PIX já
 *     estava removido de uma tentativa anterior (a repetição devolve o mesmo
 *     status, só com a `revisao` maior) e quando estava vencido e não pago.
 *   - CONCLUIDA (pago) e ATIVA nunca cancelam, digam o que disserem os outros
 *     campos.
 *   - Cada desfecho tem a sua mensagem (`mensagemDoDesfechoPix`).
 *   Isto só passa a destravar a tela quando o n8n devolver o status no corpo —
 *   a correção do nó está descrita em scratch/cancelar-pix-no-banco.
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

/** Texto genérico, de quando o desfecho não tem mensagem própria. */
export const MENSAGEM_PIX_NAO_CANCELADO_NO_BANCO =
  "Não foi possível cancelar o PIX no banco. A cobrança continua ativa: não gere outra cobrança para este pedido.";

/** Status da cobrança PIX no C6 (API `/v2/pix/cob`), como chegam na resposta. */
export const STATUS_PIX_REMOVIDO = "REMOVIDA_PELO_USUARIO_RECEBEDOR";
export const STATUS_PIX_PAGO = "CONCLUIDA";
export const STATUS_PIX_ATIVO = "ATIVA";

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
 * O status da cobrança que o banco devolveu, quando o texto o traz.
 * Mesma leitura tolerante de `cancelado`: procura o campo no texto.
 */
export function statusDoPixNaResposta(texto: string): string | null {
  const achado = /"?\bstatus\b"?\s*:\s*"([A-Z_]+)"/.exec(String(texto ?? ""));
  return achado ? achado[1] : null;
}

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
  // O status do banco manda. Pago ou ativo NUNCA é cancelamento, mesmo que o
  // texto traga `cancelado: true`; removido é cancelamento, mesmo sem o campo.
  const status = statusDoPixNaResposta(texto);
  if (status === STATUS_PIX_PAGO || status === STATUS_PIX_ATIVO) return "NAO_CANCELOU";
  if (status === STATUS_PIX_REMOVIDO) return "CANCELOU";
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
    | "PIX_PAGO_NO_BANCO"
    | "PIX_ATIVO_NO_BANCO"
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
  const status = statusDoPixNaResposta(resposta.texto);
  return {
    cancelarNoVibe: false,
    regra,
    cancelariaPelaConfirmacao: false,
    confirmacao,
    statusHttp: 409,
    desfecho:
      status === STATUS_PIX_PAGO
        ? "PIX_PAGO_NO_BANCO"
        : status === STATUS_PIX_ATIVO
          ? "PIX_ATIVO_NO_BANCO"
          : confirmacao === "NAO_CANCELOU"
            ? "BANCO_RECUSOU"
            : "RESPOSTA_SEM_CONFIRMACAO"
  };
}

const NAO_GERE_OUTRA = "A cobrança continua ativa: não gere outra cobrança para este pedido.";

/**
 * O que a tela mostra quando o PIX NÃO é cancelado, por desfecho.
 *
 * Até 13/10/2026 os cinco desfechos mostravam o mesmo texto, e quem lia não
 * sabia se o banco tinha recusado, se o PIX estava pago ou se a resposta nem
 * tinha chegado. Todas terminam dizendo que a cobrança segue ativa aqui.
 */
export function mensagemDoDesfechoPix(desfecho: DecisaoDoCancelamentoPix["desfecho"]): string {
  switch (desfecho) {
    case "BANCO_RECUSOU":
      return `O banco não cancelou o PIX. ${NAO_GERE_OUTRA}`;
    case "PIX_PAGO_NO_BANCO":
      return "Este PIX consta como pago no banco e não pode ser cancelado. A cobrança continua ativa: aguarde a baixa do pagamento e não gere outra cobrança.";
    case "PIX_ATIVO_NO_BANCO":
      return `O banco respondeu que o PIX continua ativo. ${NAO_GERE_OUTRA}`;
    case "RESPOSTA_SEM_CONFIRMACAO":
      return "O cancelamento foi enviado ao banco, mas a resposta veio sem a confirmação: o PIX pode já ter sido removido no banco. A cobrança continua ativa no sistema: não gere outra cobrança e avise o administrador para conferir.";
    case "ERRO_HTTP":
      return `O serviço de cancelamento respondeu com erro. ${NAO_GERE_OUTRA}`;
    case "REDE":
      return `Não foi possível falar com o serviço de cancelamento. ${NAO_GERE_OUTRA}`;
    case "TEMPO_ESGOTADO":
      return "O banco não respondeu a tempo, e não se sabe se o PIX foi cancelado. A cobrança continua ativa no sistema: não gere outra cobrança e tente de novo em alguns minutos.";
    default:
      return MENSAGEM_PIX_NAO_CANCELADO_NO_BANCO;
  }
}
