/**
 * Segredo dos webhooks do n8n chamados pelo servidor do Vibe (02/10/2026).
 *
 * Os webhooks `boletos-vibe` e `carta-correcao` aceitavam chamada de qualquer
 * origem. Passam a exigir este cabeçalho, com o valor guardado na variável de
 * ambiente `N8N_WEBHOOK_SECRET` (só no servidor: sem `NEXT_PUBLIC_`, o navegador
 * nunca a recebe) e numa credencial do n8n.
 *
 * Enquanto a variável não existe, o cabeçalho simplesmente não é enviado: a
 * chamada sai como sempre saiu. Isso é o que permite publicar o código ANTES de
 * o n8n passar a exigir o segredo, sem janela com o registro de boleto quebrado.
 */

/** Nome do cabeçalho conferido pela credencial "Header Auth" do n8n. */
export const CABECALHO_SEGREDO_N8N = "x-vibe-webhook-secret";

/** Nome da variável de ambiente (Vercel e `.env.local`). */
export const VARIAVEL_SEGREDO_N8N = "N8N_WEBHOOK_SECRET";

/** Cabeçalhos de uma chamada JSON a um webhook do n8n, com o segredo quando configurado. */
export function cabecalhosWebhookN8n(): Record<string, string> {
  const segredo = String(process.env[VARIAVEL_SEGREDO_N8N] ?? "").trim();
  return {
    "Content-Type": "application/json",
    ...(segredo ? { [CABECALHO_SEGREDO_N8N]: segredo } : {})
  };
}

/** O servidor tem o segredo configurado? Para diagnóstico; nunca devolve o valor. */
export function segredoWebhookN8nConfigurado(): boolean {
  return String(process.env[VARIAVEL_SEGREDO_N8N] ?? "").trim().length > 0;
}
