/**
 * POST /api/pedidos/modelos-ordem — grava a ordem nova dos lotes de um produto,
 * arrastados na lista da aba Pedido (24/11/2026). Regra em
 * features/orcamentos/lib/ordem-dos-modelos.ts.
 *
 * Corpo: { idInt, idProdutoProposta, ids } — `ids` são os `pedidos_modelos.id`
 * do produto, na ordem nova.
 *
 * A MESMA TRAVA DA EDIÇÃO DOS LOTES
 *   Sem cobrança ativa, quem edita os lotes reordena (a rota da grade,
 *   lotes-em-massa, também só confere a sessão). Com cobrança ativa, a lista
 *   só é editável para quem tem Editar Proposta Paga ou Editar Faturado
 *   (`isFormBloqueadoPorCobranca` da edição); aqui vale a mesma exigência.
 *   A tela ainda esconde a alça quando a lista está só para ver (pendência de
 *   revisão aberta, avulsa paga, pedido entregue travado).
 *
 * Só a coluna `ordem` é gravada: nada de numeração, quantidade ou status.
 */
import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { verificarPermissaoServerSide } from "@/lib/auth/verificar-permissao";
import { novaOrdemDoPedido, type ModeloParaOrdenar } from "@/features/orcamentos/lib/ordem-dos-modelos";

const STATUS_COBRANCA_INATIVA = ["CANCELADO", "CANCELADA", "EXTORNADO", "RECUSADO"];

function erro(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export async function POST(request: Request) {
  const corpo = (await request.json().catch(() => null)) as
    | { idInt?: number; idProdutoProposta?: number; ids?: unknown[] }
    | null;
  const idInt = Number(corpo?.idInt);
  const idItem = Number(corpo?.idProdutoProposta);
  const ids = Array.isArray(corpo?.ids) ? corpo!.ids.map(Number) : [];
  if (!Number.isFinite(idInt) || idInt <= 0) return erro("DADOS", "Proposta nao informada.", 400);
  if (!Number.isFinite(idItem) || idItem <= 0) return erro("DADOS", "Item da proposta nao informado.", 400);
  if (ids.length === 0 || ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    return erro("DADOS", "Lista de modelos invalida.", 400);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return erro("INTERNO", "Erro interno no servidor.", 500);
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return erro("SESSAO", "Sessao nao encontrada.", 401);
  const supabase = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData.user) return erro("SESSAO", "Sessao invalida.", 401);

  // 1. A trava da edição dos lotes.
  const { data: cobrancas, error: erroCobrancas } = await supabase
    .from("pagamentos_v2")
    .select("status")
    .eq("id_int", idInt)
    .returns<{ status: string | null }[]>();
  if (erroCobrancas) return erro("INTERNO", "Nao foi possivel verificar as cobrancas da proposta.", 500);
  const temCobrancaAtiva = (cobrancas || []).some(
    (c) => !STATUS_COBRANCA_INATIVA.includes(String(c.status || "").trim().toUpperCase())
  );
  if (temCobrancaAtiva) {
    const uid = authData.user.id;
    const pode =
      (await verificarPermissaoServerSide(supabase, uid, "propostas.editar_paga")) ||
      (await verificarPermissaoServerSide(supabase, uid, "propostas.editar_faturado"));
    if (!pode) {
      return erro(
        "BLOQUEADO",
        "Esta proposta tem cobrança e os modelos estão só para consulta. A ordem não foi alterada.",
        403
      );
    }
  }

  // 2. O item é desta proposta.
  const { data: item, error: erroItem } = await supabase
    .from("produtos_proposta")
    .select("id, id_int")
    .eq("id", idItem)
    .maybeSingle<{ id: number; id_int: number }>();
  if (erroItem) return erro("INTERNO", "Nao foi possivel ler o item da proposta.", 500);
  if (!item) return erro("ITEM_NAO_ENCONTRADO", "Este item nao existe mais nesta proposta. Recarregue a pagina.", 409);
  if (Number(item.id_int) !== idInt) return erro("ITEM_DE_OUTRA_PROPOSTA", "Este item pertence a outra proposta.", 409);

  // 3. A ordem nova do pedido inteiro, conferida contra o banco.
  const { data: modelos, error: erroModelos } = await supabase
    .from("pedidos_modelos")
    .select("id, id_produto_proposta_origem, ordem")
    .eq("id_int", idInt)
    .returns<{ id: number; id_produto_proposta_origem: number | null; ordem: number | null }[]>();
  if (erroModelos) return erro("INTERNO", "Nao foi possivel ler os modelos do pedido.", 500);
  const paraOrdenar: ModeloParaOrdenar[] = (modelos || []).map((m) => ({
    id: Number(m.id),
    idItem: m.id_produto_proposta_origem == null ? null : Number(m.id_produto_proposta_origem),
    ordem: m.ordem
  }));
  const resultado = novaOrdemDoPedido(paraOrdenar, idItem, ids);
  if (!resultado.ok) return erro(resultado.code, resultado.message, 409);

  // 4. Grava só a coluna `ordem`, linha a linha (poucas linhas por pedido).
  for (const m of resultado.mudancas) {
    const { error } = await supabase.from("pedidos_modelos").update({ ordem: m.ordem }).eq("id", m.id).eq("id_int", idInt);
    if (error) {
      console.error("[modelos-ordem] falha ao gravar a ordem", idInt, m.id, error.message);
      return erro("GRAVACAO", "A ordem foi gravada só em parte. Recarregue a página e arraste de novo.", 500);
    }
  }

  return NextResponse.json({ success: true, alterados: resultado.mudancas.length });
}
