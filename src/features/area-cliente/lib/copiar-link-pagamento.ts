import { getSupabaseClient } from "@/lib/supabase/client";

/**
 * "Link pgto. externo" — copia o link da área do cliente (/p/<token>) de um
 * pedido para a área de transferência.
 *
 * Um lugar só para as duas portas da tela: o menu Ações de dentro da proposta e
 * o menu Ações de cada linha da lista de Pedidos (29/09/2026). Até aqui a ação
 * vivia dentro do OrcamentoFormPage, com o nome "Copiar link da área do
 * cliente". O comportamento é o de sempre: o token só existe no servidor
 * (`/api/area-cliente/link`, que exige sessão do ERP), e o link nasce no
 * domínio em que a tela está aberta. Nenhuma permissão nova: quem está logado
 * e vê o pedido copia o link, como antes.
 *
 * O parceiro que precisa do mesmo link sem sessão usa
 * `GET /api/v1/parceiro/link-pagamento/{id_int}` — ver docs/api/link-pagamento.md.
 */
export async function copiarLinkPagamentoExterno(
  idInt: number,
  avisar: (aviso: { type: "success" | "error"; title: string; description?: string }) => void
): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    avisar({ type: "error", title: "Cliente Supabase indisponível." });
    return;
  }
  const sessao = await client.auth.getSession();
  const bearer = sessao.data.session?.access_token ?? "";
  if (!bearer) {
    avisar({ type: "error", title: "Sessão expirada. Entre novamente." });
    return;
  }
  try {
    const resposta = await fetch("/api/area-cliente/link", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${bearer}` },
      body: JSON.stringify({ idInt })
    });
    const json = (await resposta.json().catch(() => null)) as { ok?: boolean; caminho?: string; mensagem?: string } | null;
    if (!resposta.ok || !json?.ok || !json.caminho) {
      avisar({ type: "error", title: "Não foi possível gerar o link.", description: json?.mensagem });
      return;
    }
    await navigator.clipboard.writeText(`${window.location.origin}${json.caminho}`);
    avisar({ type: "success", title: "Link de pagamento externo copiado." });
  } catch {
    avisar({ type: "error", title: "Não foi possível copiar o link." });
  }
}
