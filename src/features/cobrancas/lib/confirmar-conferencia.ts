/**
 * O passo a passo do botão "Confirmar Liberação" da Conferência.
 *
 * A ORDEM É A REGRA
 *   1. uma chamada só: clique repetido enquanto a primeira não voltou não sai;
 *   2. a rota respondeu com sucesso -> a janela FECHA na hora. A confirmação já
 *      valeu no servidor; nada do que vem depois pode segurar a tela;
 *   3. a mensagem do chat é gravada DEPOIS de fechar, sem esperar. Se falhar,
 *      fica só no log: não reabre a janela nem vira erro de confirmação;
 *   4. a rota falhou -> a janela continua aberta, com o erro.
 *
 * Fica fora do componente para ser testado sem React: o componente só entrega
 * as funções.
 */

export type TravaDeEnvio = { ocupada: boolean };

export type PassosDaConfirmacao = {
  /** Chama a rota. `true` = confirmada; `false` ou erro lançado = não confirmada. */
  confirmar: () => Promise<boolean>;
  /** Liga e desliga o estado "Confirmando..." do botão. */
  aoMudarEnvio: (enviando: boolean) => void;
  /** A rota confirmou: avisa e fecha a janela. */
  aoConfirmar: () => void;
  /** A rota não confirmou. `erro` é `null` quando ela respondeu sem sucesso e sem lançar. */
  aoFalhar: (erro: unknown) => void;
  /** Grava a mensagem do chat. Roda depois de `aoConfirmar`, sem bloquear. */
  gravarChat: () => Promise<unknown>;
  /** Onde a falha do chat é registrada. */
  registrarFalhaDoChat: (erro: unknown) => void;
};

export type DesfechoDaConfirmacao = "CONFIRMADA" | "FALHOU" | "IGNORADA";

export async function executarConfirmacaoDaConferencia(
  trava: TravaDeEnvio,
  passos: PassosDaConfirmacao
): Promise<DesfechoDaConfirmacao> {
  if (trava.ocupada) return "IGNORADA";
  trava.ocupada = true;
  passos.aoMudarEnvio(true);

  try {
    let confirmada: boolean;
    try {
      confirmada = await passos.confirmar();
    } catch (erro) {
      passos.aoFalhar(erro);
      return "FALHOU";
    }

    if (!confirmada) {
      passos.aoFalhar(null);
      return "FALHOU";
    }

    passos.aoConfirmar();

    // Depois de fechar, e sem `await`: a gravação do chat não segura nada.
    void Promise.resolve()
      .then(() => passos.gravarChat())
      .catch((erro) => passos.registrarFalhaDoChat(erro));

    return "CONFIRMADA";
  } finally {
    trava.ocupada = false;
    passos.aoMudarEnvio(false);
  }
}
