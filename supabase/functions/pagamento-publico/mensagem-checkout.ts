/**
 * O que a página de pagamento mostra ao cliente quando o webhook do cartão
 * recusa (23/11/2026).
 *
 * Os fluxos do n8n devolvem a falha como `{ success: false, causa, http_status,
 * error }`. Até aqui a página lia só `erro` e `message`, e o cliente via
 * "Erro ao criar checkout no C6. Status: 422". Agora:
 *   - telefone (causa TELEFONE_INVALIDO): texto simples para o cliente;
 *   - outra falha: a explicação do fluxo (`erro`, `message`, `error`, `mensagem`);
 *   - nada disso: o texto genérico de antes.
 *
 * A função vai para dentro do <script> da página com `toString()`: por isso não
 * usa nada de fora dela (nem constante do módulo). O mesmo texto do telefone
 * está em `MENSAGEM_CARTAO_SEM_CELULAR` (src/lib/telefone/telefone-br.ts), e o
 * teste `scripts/testes/cartao-telefone-conversa.test.mts` confere os dois.
 */
export function mensagemDaFalhaDoCheckout(data: any, status: number): string {
  const corpo = data && typeof data === "object" ? data : {};
  if (corpo.causa === "TELEFONE_INVALIDO") {
    return "Não encontramos um celular válido para o pagamento com cartão. Fale com o seu vendedor.";
  }
  const candidatos = [corpo.erro, corpo.message, corpo.error, corpo.mensagem];
  for (let i = 0; i < candidatos.length; i++) {
    const c = candidatos[i];
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object" && typeof c.message === "string" && c.message.trim()) return c.message.trim();
  }
  return "Erro ao criar checkout no C6. Status: " + status;
}
