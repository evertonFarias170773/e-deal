/**
 * /api/orcamentos/editar-paga/route.ts
 *
 * Rota server-side para salvar propostas.
 *
 * SEGURANÇA:
 * - Valida JWT via Authorization: Bearer <token> (padrão Maestro)
 * - Identifica soberanamente se a proposta é paga (possui pagamentos confirmados)
 * - Se for paga, exige a permissão `propostas.editar_paga`
 * - Valida server-side se o id_int existe no banco
 * - Valida server-side se o id_cliente coincide com o da proposta no banco
 * - `saveProposta` é executada com o cliente autenticado injetado (sem bypass de RLS)
 *
 * CONSISTÊNCIA FINANCEIRA:
 * - Se diferença financeira ≠ 0 após o salvamento, cria uma pendência de lock (two-phase commit)
 * - A pendência impede novas edições e força a resolução da diferença
 *
 * IDEMPOTÊNCIA:
 * - Se já houver pendência de revisão financeira ABERTA para a proposta, retorna-a diretamente
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { saveProposta } from "@/features/orcamentos/services/orcamentos.service";
import type { PropostaFormState } from "@/features/orcamentos/types";
import { resolveEmpresaIdFromTexto } from "@/features/cobrancas/cobrancas-utils";

// ---------------------------------------------------------------------------
// Configurações e Tipagens
// ---------------------------------------------------------------------------

const PERMISSOES_FALLBACK_ADMIN: string[] = [
  "propostas.editar_paga", "financeiro.resolver_credito", "financeiro.bonificar",
  "financeiro.devolver", "financeiro.debito_futuro", "credito.usar"
];

type UsuarioMinRow = {
  id_perfil: number | null;
  is_super_adm: boolean;
  is_admin: boolean;
};

type PerfilMinRow = {
  permissoes: string[];
};

/**
 * Verifica se o usuário tem permissão para editar proposta paga
 */
async function verificarPermissaoEditarPaga(
  supabase: SupabaseClient<any, any, any>,
  userId: string
): Promise<{ autorizado: boolean; motivo?: string }> {
  const { data: usuarioData, error: usuarioError } = await supabase
    .from("usuarios")
    .select("id_perfil, is_super_adm, is_admin")
    .eq("user_id", userId)
    .maybeSingle();

  if (usuarioError || !usuarioData) {
    return { autorizado: false, motivo: "Usuário não encontrado em public.usuarios." };
  }

  const row = usuarioData as UsuarioMinRow;

  if (row.is_super_adm) {
    return { autorizado: true };
  }

  if (row.id_perfil != null) {
    const { data: perfilData, error: perfilError } = await supabase
      .from("perfis")
      .select("permissoes")
      .eq("id", row.id_perfil)
      .eq("ativo", true)
      .maybeSingle();

    if (!perfilError && perfilData) {
      const perfil = perfilData as PerfilMinRow;
      const permissoes: string[] = Array.isArray(perfil.permissoes) ? perfil.permissoes : [];
      if (permissoes.includes("*") || permissoes.includes("propostas.editar_paga")) {
        return { autorizado: true };
      }
      return { autorizado: false, motivo: "Perfil sem permissão propostas.editar_paga." };
    }
  }

  if (row.is_admin) {
    const temPermissao = PERMISSOES_FALLBACK_ADMIN.includes("propostas.editar_paga");
    return { autorizado: temPermissao };
  }

  return { autorizado: false, motivo: "Sem permissão para editar proposta paga." };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  // ── 1. Extrair e validar JWT ──────────────────────────────────────────────
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

  // ── Validar variáveis de ambiente ────────────────────────────────────────
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    console.error("[editar-paga] ENV AUSENTE:", {
      hasUrl: Boolean(url),
      hasAnonKey: Boolean(anonKey),
    });
    return NextResponse.json(
      { success: false, error: "Configuração de ambiente incompleta. Contate o administrador." },
      { status: 500 }
    );
  }

  if (!token) {
    return NextResponse.json(
      { success: false, error: "Sessão não encontrada. Faça login para continuar." },
      { status: 401 }
    );
  }

  const supabase: SupabaseClient<any, any, any> = createSupabaseClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();

  console.info("[editar-paga] Auth:", {
    bearerPresent: Boolean(token),
    authOk: Boolean(authData?.user),
    authErrorCode: authError?.message ?? null,
    userId: authData?.user?.id ?? null,
  });

  if (authError || !authData.user) {
    return NextResponse.json(
      { success: false, error: "Sessão inválida ou expirada. Faça login novamente." },
      { status: 401 }
    );
  }
  const user = { id: authData.user.id, email: authData.user.email ?? "" };

  // ── 3. Ler payload ────────────────────────────────────────────────────────
  let body: {
    formState?: PropostaFormState;
    idInt?: number;
    idCliente?: number;
    valorPagoConfirmado?: number;
    novoTotal?: number;
    userEmail?: string;
    userName?: string;
  };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Payload inválido." }, { status: 400 });
  }

  const { formState, idInt, idCliente, valorPagoConfirmado, novoTotal, userEmail, userName } = body;

  if (!formState || !idInt || !idCliente) {
    return NextResponse.json(
      { success: false, error: "formState, idInt e idCliente são obrigatórios." },
      { status: 400 }
    );
  }

  // ── 4. Validação Server-Side da Proposta no Banco ────────────────────────
  const { data: propostaBanco, error: propostaError } = await supabase
    .from("propostas")
    .select("id_int, id_cliente, valor_total, empresa")
    .eq("id_int", idInt)
    .maybeSingle();

  if (propostaError) {
    return NextResponse.json(
      { success: false, error: `Falha interna ao buscar proposta #${idInt}. Detalhe: ${propostaError.message}` },
      { status: 500 }
    );
  }

  if (!propostaBanco) {
    return NextResponse.json(
      { success: false, error: `Proposta #${idInt} não encontrada no banco de dados.` },
      { status: 404 }
    );
  }

  // ── 4a. Resolver id_empresa da proposta (helper oficial compartilhado) ───
  const idEmpresaProposta = resolveEmpresaIdFromTexto(propostaBanco.empresa);

  console.info(`[editar-paga] Proposta #${idInt} — empresa bruta: '${propostaBanco.empresa}' → id_empresa resolvido: ${idEmpresaProposta}`);

  if (!idEmpresaProposta) {
    return NextResponse.json(
      { success: false, error: `A proposta #${idInt} possui uma empresa inválida ou não reconhecida ('${propostaBanco.empresa}'). Não é possível determinar o id_empresa financeiro com segurança.` },
      { status: 422 }
    );
  }

  // Validar se o cliente coincide
  if (propostaBanco.id_cliente !== idCliente) {
    return NextResponse.json(
      { success: false, error: `Inconsistência: cliente informado (${idCliente}) difere do cliente da proposta (${propostaBanco.id_cliente}).` },
      { status: 400 }
    );
  }

  // ── 5. Buscar cobranças e re-calcular valor pago confirmado (servidor) ───
  const { data: cobrancasBanco, error: cobrancasError } = await supabase
    .from("pagamentos_v2")
    .select("status, confirmado, valor")
    .eq("id_int", idInt)
    .neq("status", "CANCELADO");

  if (cobrancasError) {
    return NextResponse.json(
      { success: false, error: "Erro ao buscar cobranças da proposta no servidor." },
      { status: 500 }
    );
  }

  const cobrancas = cobrancasBanco || [];
  const temCobrancasAtivas = cobrancas.length > 0;

  // Regra oficial de pagamento confirmado
  const valorPagoReal = cobrancas
    .filter(c => c.status === "PAID" || (c.status === "A_VENCER" && c.confirmado))
    .reduce((sum, c) => sum + (Number(c.valor) || 0), 0);

  const valorPagoRealArredondado = Math.round(valorPagoReal * 100) / 100;

  const ehPropostaPaga = temCobrancasAtivas && valorPagoRealArredondado > 0;

  // Se houver cobranças mas nenhum pagamento confirmado, impede gravação
  if (temCobrancasAtivas && valorPagoRealArredondado <= 0) {
    return NextResponse.json(
      { success: false, error: "Esta proposta possui cobranças ativas mas não possui pagamento confirmado de fato. Cancele as cobranças antes de editar." },
      { status: 400 }
    );
  }

  // ── 6. Verificar permissão de edição se for proposta paga ────────────────
  if (ehPropostaPaga) {
    const { autorizado, motivo } = await verificarPermissaoEditarPaga(supabase, user.id);
    if (!autorizado) {
      console.warn(`[editar-paga] Acesso negado para user ${user.id}: ${motivo}`);
      return NextResponse.json(
        { success: false, error: motivo ?? "Sem permissão para editar proposta paga." },
        { status: 403 }
      );
    }
  }

  // ── 7. Verificar pendência existente (idempotência nível 1) ───────────────
  const { data: pendenciaExistente, error: pendExistErr } = await supabase
    .from("propostas_pendencias")
    .select("id, titulo, descricao, status, created_at, origem, id_cliente, id_empresa")
    .eq("id_int", idInt)
    .eq("status", "ABERTA")
    .eq("origem", "SISTEMA")
    .like("titulo", "Revisão financeira pendente%")
    .eq("id_cliente", idCliente)
    .eq("id_empresa", idEmpresaProposta)
    .maybeSingle();

  if (pendExistErr) {
    console.warn(`[editar-paga] Erro ao buscar pendência existente: ${pendExistErr.message}`);
  }

  if (pendenciaExistente) {
    console.info(`[editar-paga] Pendência ABERTA já existe para proposta #${idInt} (id: ${pendenciaExistente.id}). Retornando 409.`);
    return NextResponse.json(
      { 
        success: false, 
        error: "Há uma conciliação financeira pendente. Resolva a pendência atual antes de realizar novas edições.",
        pendenciaAtiva: pendenciaExistente
      },
      { status: 409 }
    );
  }

  // ── 8. Salvar proposta ────────────────────────────────────────────────────
  const saveResult = await saveProposta(
    formState,
    supabase as unknown as import("@supabase/supabase-js").SupabaseClient,
    user.id,
    { force: ehPropostaPaga }
  );

  if (!saveResult.success) {
    return NextResponse.json(
      { success: false, error: saveResult.errorMessage ?? "Erro ao salvar proposta." },
      { status: 500 }
    );
  }

  // ── 9. Buscar o total atualizado no servidor após a gravação ──────────────
  const novoTotalReal = saveResult.valor_total ?? 0;
  const novoTotalRealArredondado = Math.round(novoTotalReal * 100) / 100;

  console.info(`[editar-paga] Pós-save: valor_total (retornado pelo saveProposta) = ${novoTotalRealArredondado}`);

  // ── 10. Atualizar a pendência com o valor real ou remover se não houver diferença ──
  let diferenca = 0;
  let pendenciaCriada = null;

  if (ehPropostaPaga) {
    diferenca = Math.round((novoTotalRealArredondado - valorPagoRealArredondado) * 100) / 100;

    if (Math.abs(diferenca) >= 0.01) {
      const sinal = diferenca < 0 ? "crédito" : "débito";
      const valorAbs = Math.abs(diferenca).toFixed(2).replace(".", ",");
      const pago = valorPagoRealArredondado.toFixed(2).replace(".", ",");
      const novo = novoTotalRealArredondado.toFixed(2).replace(".", ",");

      const finalDescricao = [
        `Proposta #${idInt} foi alterada após pagamento confirmado.`,
        `Valor pago: R$ ${pago} | Novo total: R$ ${novo} | Diferença: R$ ${valorAbs} (${sinal}).`,
        `Operador: ${userEmail ?? user.email} | User ID: ${user.id}`,
        `Data: ${new Date().toISOString()}`,
      ].join(" ");

      const pendenciaPayload = {
        id_int: idInt,
        id_cliente: idCliente,
        titulo: `Revisão financeira pendente — Proposta #${idInt}`,
        descricao: finalDescricao,
        categoria: "CREDITO",
        status: "ABERTA",
        prioridade: "ALTA",
        responsavel_setor: "FINANCEIRO",
        responsavel_user_id: null,
        criado_por_user_id: user.id,
        criado_por_nome: userName ?? user.email ?? "Sistema",
        origem: "SISTEMA",
        data_limite: null,
        chat_id: null,
        pagamento_id: null,
        id_empresa: idEmpresaProposta,
      };

      const { data: createdPend, error: createdError } = await supabase
        .from("propostas_pendencias")
        .insert([pendenciaPayload])
        .select("*")
        .single();
        
      if (createdError) {
        console.error("[editar-paga] Erro ao criar pendência financeira:", createdError);
      } else {
        pendenciaCriada = createdPend;
      }
    }
  }

  return NextResponse.json({
    success: true,
    novoTotal: novoTotalRealArredondado,
    diferenca: diferenca,
    ehPropostaPaga,
    valorPagoReal: valorPagoRealArredondado,
    pendenciaAtiva: pendenciaCriada,
  });
}
