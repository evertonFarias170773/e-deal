import { createClient } from "@supabase/supabase-js";

/**
 * CLIENTE FINAL DO PEDIDO DA INTEGRAÇÃO LISITON (27/11/2026, decisão do dono).
 *
 * O pedido criado pela POST /api/v1/lisiton/pedidos é da 8469, que também
 * paga. Quem recebe a caixa é o cliente final, guardado em
 * `integracao_lisiton_pedidos.id_cliente_final`. A etiqueta 10x15 (e a prévia
 * do Despachar, que lê o mesmo view model), a Declaração de Conteúdo e a
 * prepostagem dos Correios usam esse id como destinatário
 * (`idDestinatarioEtiquetaVigente`, parâmetro `idClienteFinalIntegracao`).
 *
 * POR QUE A CHAVE DE SERVIÇO: a tabela é fechada (só service_role lê), e as
 * três leituras rodam no servidor com a sessão de quem imprime. Este módulo lê
 * só a coluna `id_cliente_final` do pedido que a rota já autorizou, e nunca
 * vai ao browser (`.server.ts`).
 *
 * FALHA NÃO TRAVA O PAPEL: sem chave ou com erro de leitura, devolve `null` e
 * o documento sai pela regra de sempre (o cadastro da 8469 ou do pagador).
 * Pedido que não é da integração não tem linha na tabela e também dá `null`.
 */
export async function idClienteFinalDaIntegracao(idInt: number): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    console.warn("[expedicao] Sem SUPABASE_SERVICE_ROLE_KEY: o cliente final da Integração Lisiton não foi lido.");
    return null;
  }
  try {
    const banco = createClient(url, chave, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await banco
      .from("integracao_lisiton_pedidos")
      .select("id_cliente_final")
      .eq("id_int", idInt)
      .maybeSingle();
    if (error) {
      console.warn("[expedicao] Falha ao ler o cliente final da Integração Lisiton:", error.message);
      return null;
    }
    const id = Number(data?.id_cliente_final);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch (e) {
    console.warn("[expedicao] Falha ao ler o cliente final da Integração Lisiton:", e);
    return null;
  }
}
