import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPropostaDetailById } from "@/features/orcamentos/services/orcamentos.service";
import { resolveEmpresaIdFromTexto } from "@/features/cobrancas/cobrancas-utils";

const PERMISSOES_FALLBACK_ADMIN: string[] = [
  "propostas.editar_paga", "financeiro.resolver_credito", "financeiro.bonificar",
  "financeiro.devolver", "financeiro.debito_futuro", "credito.usar"
];

async function verificarPermissaoEditarPaga(
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<{ autorizado: boolean; motivo?: string; is_super_adm?: boolean; is_admin?: boolean; id_empresa_usuario?: number | null; nome_usuario?: string }> {
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin, id_empresa, nome_usuario")
    .eq("user_id", userId)
    .maybeSingle();

  if (usuarioError || !usuarioData) {
    return { autorizado: false, motivo: "Usuário não encontrado em public.usuarios." };
  }

  const row = usuarioData as any;

  if (row.is_super_adm) {
    return { autorizado: true, is_super_adm: true, id_empresa_usuario: row.id_empresa, nome_usuario: row.nome_usuario };
  }

  if (row.id_perfil != null) {
    const { data: perfilData, error: perfilError } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (!perfilError && perfilData) {
      const perfil = perfilData as any;
      const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
      if (permissoes.includes("*") || permissoes.includes("propostas.editar_paga")) {
        return { autorizado: true, is_admin: row.is_admin, id_empresa_usuario: row.id_empresa, nome_usuario: row.nome_usuario };
      }
      return { autorizado: false, motivo: "Perfil sem permissão propostas.editar_paga." };
    }
  }

  if (row.is_admin) {
    const temPermissao = PERMISSOES_FALLBACK_ADMIN.includes("propostas.editar_paga");
    return { autorizado: temPermissao, is_admin: true, id_empresa_usuario: row.id_empresa, nome_usuario: row.nome_usuario };
  }

  return { autorizado: false, motivo: "Sem permissão para editar proposta paga." };
}

export async function POST(request: NextRequest) {
  // ── 1. Extrair JWT e Iniciar Auth ──────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return NextResponse.json({ success: false, error: "Configuração de ambiente incompleta." }, { status: 500 });
  }

  if (!token) {
    return NextResponse.json({ success: false, error: "Sessão não encontrada. Faça login para continuar." }, { status: 401 });
  }
  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError || !authData?.user) {
    return NextResponse.json({ success: false, error: "Token inválido ou expirado. Faça login novamente." }, { status: 401 });
  }
  const userId = authData.user.id;

  // ── 2. Parse Payload ───────────────────────────────────────────────────────
  let payload: any;
  try {
    payload = await request.json();
  } catch (err) {
    return NextResponse.json({ success: false, error: "Payload JSON inválido." }, { status: 400 });
  }

  const idIntStr = payload?.idInt;
  if (!idIntStr) {
    return NextResponse.json({ success: false, error: "Faltando idInt da proposta." }, { status: 400 });
  }
  const idInt = Number(idIntStr);
  if (isNaN(idInt)) {
    return NextResponse.json({ success: false, error: "idInt inválido." }, { status: 400 });
  }

  // ── 3. Verificar Proposta no Banco ──────────────────────────────────────────
  const { data: propostaRow, error: propErr } = await supabase
    .from("propostas")
    .select("id, id_int, id_cliente, empresa, valor_total")
    .eq("id_int", idInt)
    .single();

  if (propErr || !propostaRow) {
    return NextResponse.json({ success: false, error: `Proposta #${idInt} não encontrada.` }, { status: 404 });
  }

  if (propostaRow.valor_total !== null) {
    return NextResponse.json({ success: false, error: "A proposta já possui um valor_total consolidado.", jaConsolidada: true }, { status: 409 });
  }

  // ── 4. Validar Empresa do Usuário e Permissão Editar Paga ────────────────
  const idEmpresaProposta = resolveEmpresaIdFromTexto(propostaRow.empresa);
  let nomeUsuario = "Sistema";

  const perm = await verificarPermissaoEditarPaga(supabase, userId);
  if (!perm.autorizado) {
    return NextResponse.json({ success: false, error: perm.motivo ?? "Sem permissão para editar proposta paga." }, { status: 403 });
  }
  nomeUsuario = perm.nome_usuario || "Sistema";

  if (!perm.is_super_adm) {
    if (perm.id_empresa_usuario != null && perm.id_empresa_usuario !== idEmpresaProposta) {
       return NextResponse.json({ success: false, error: "A empresa desta proposta não corresponde à empresa autorizada do seu usuário." }, { status: 403 });
    }
  }

  // ── 5. Validar se a proposta está realmente paga ──────────────────────────
  const { data: cobrancas } = await supabase
    .from("pagamentos_v2")
    .select("status, valor, confirmado")
    .eq("id_empresa", idEmpresaProposta)
    .eq("id_int", idInt)
    .not("status", "in", '("CANCELADO","CANCELED","REFUNDED")');

  const pagamentosConfirmados = (cobrancas || []).filter(c => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado));
  const valorPagoTotal = pagamentosConfirmados.reduce((sum, c) => sum + Number(c.valor || 0), 0);
  
  if (pagamentosConfirmados.length === 0 || valorPagoTotal <= 0) {
    return NextResponse.json({ success: false, error: "Esta operação requer que a proposta tenha pagamentos confirmados." }, { status: 400 });
  }

  // ── 6. Verificar Pendência ────────────────────────────────────────────────
  const { data: pendenciaExistente } = await supabase
    .from("propostas_pendencias")
    .select("id, status")
    .eq("id_int", idInt)
    .eq("status", "ABERTA")
    .eq("origem", "SISTEMA")
    .eq("id_cliente", propostaRow.id_cliente)
    .eq("id_empresa", idEmpresaProposta)
    .maybeSingle();

  if (!pendenciaExistente) {
    return NextResponse.json({ success: false, error: "Nenhuma pendência financeira do sistema ABERTA encontrada para esta proposta. Consolidação desnecessária." }, { status: 400 });
  }

  // ── 7. Reutilizar exatamente a função oficial server-side ───────────────
  // getPropostaDetailById busca todos os dados, refaz os mapeamentos, refaz
  // regras de descontos (is_bonus, percentual_bunus) sem nenhuma duplicação.
  const propostaOficial = await getPropostaDetailById(idInt, supabase);
  
  if (!propostaOficial || !propostaOficial.resumo) {
      return NextResponse.json({ success: false, error: "Falha ao calcular a proposta oficial através do serviço." }, { status: 500 });
  }

  const totalCalculado = propostaOficial.resumo.valorTotal;

  if (!Number.isFinite(totalCalculado) || totalCalculado < 0) {
     return NextResponse.json({ success: false, error: "Cálculo oficial de total financeiro resultou em valor inválido." }, { status: 500 });
  }

  // ── 8. Persistir valor_total ──────────────────────────────────────────────
  const { error: updateTotalErr } = await supabase
    .from("propostas")
    .update({ valor_total: totalCalculado })
    .eq("id_int", idInt);

  if (updateTotalErr) {
    return NextResponse.json({ success: false, error: "Falha ao gravar o total no banco." }, { status: 500 });
  }

  // ── 9. Log de Auditoria ───────────────────────────────────────────────────
  await supabase.from("propostas_chat").insert([{
    id_int: idInt,
    mensagem: `CONSOLIDAÇÃO FINANCEIRA OFICIAL: O valor total financeiro da proposta foi consolidado de 'nulo' para R$ ${totalCalculado.toFixed(2)}.`,
    tipo: "LOG",
    autor_uid: userId,
    autor_nome: nomeUsuario,
    id_cliente: propostaRow.id_cliente,
    visivel_externo: false
  }]);

  return NextResponse.json({
    success: true,
    message: "Total financeiro consolidado com sucesso.",
    valor_total: totalCalculado
  });
}
