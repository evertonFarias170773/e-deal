import { getSupabaseClient } from "@/lib/supabase/client";
import { sendPropostaChatMessage } from "@/features/orcamentos/services/orcamentos.service";

export interface PropostaPendencia {
  id: number;
  id_int: number;
  id_cliente: number | null;
  chat_id: number | null;
  pagamento_id: string | number | null;
  id_empresa: number | null;
  titulo: string;
  descricao: string;
  categoria: "CREDITO" | "DOCUMENTO" | "PAGAMENTO" | "COMERCIAL" | "PRODUCAO" | "FISCAL" | "OUTRO";
  status: "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA";
  prioridade: "BAIXA" | "MEDIA" | "ALTA" | "URGENTE";
  responsavel_setor: string;
  responsavel_user_id: string | null;
  criado_por_user_id: string;
  criado_por_nome: string;
  concluido_por_user_id: string | null;
  concluido_por_nome: string | null;
  concluido_at: string | null;
  cancelado_por_user_id: string | null;
  cancelado_por_nome: string | null;
  cancelado_at: string | null;
  data_limite: string | null;
  origem: string;
  created_at: string;
  updated_at: string;
}

export async function listPropostasPendencias(idInt: number): Promise<{
  success: boolean;
  data: PropostaPendencia[];
  errorMessage?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, data: [], errorMessage: "Cliente Supabase não configurado." };
  }
  try {
    const { data, error } = await client
      .from("propostas_pendencias")
      .select("*")
      .eq("id_int", idInt)
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, data: [], errorMessage: error.message };
    }
    return { success: true, data: data as PropostaPendencia[] };
  } catch (err) {
    return {
      success: false,
      data: [],
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao listar pendências."
    };
  }
}

export async function createPropostaPendencia(
  payload: Omit<
    PropostaPendencia,
    | "id"
    | "created_at"
    | "updated_at"
    | "concluido_por_user_id"
    | "concluido_por_nome"
    | "concluido_at"
    | "cancelado_por_user_id"
    | "cancelado_por_nome"
    | "cancelado_at"
  >,
  user: { id: string; name: string; email: string; sector: string | null }
): Promise<{ success: boolean; data?: PropostaPendencia; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    console.error("[PENDENCIAS SERVICE] Cliente Supabase não configurado.");
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }
  try {
    // 5. & 6. Fetch session.user.id to guarantee authenticity of auth.uid()
    const { data: sessionData } = await client.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id || null;

    const finalCriadoPorUserId = sessionUserId || user.id;

    const insertData = {
      id_int: payload.id_int,
      id_cliente: payload.id_cliente ? Number(payload.id_cliente) : null,
      chat_id: payload.chat_id ? Number(payload.chat_id) : null,
      pagamento_id: payload.pagamento_id,
      id_empresa: payload.id_empresa ? Number(payload.id_empresa) : null,
      titulo: payload.titulo.trim(),
      descricao: payload.descricao.trim(),
      categoria: payload.categoria,
      status: payload.status || "ABERTA",
      prioridade: payload.prioridade || "MEDIA",
      responsavel_setor: payload.responsavel_setor,
      responsavel_user_id: payload.responsavel_user_id || null,
      criado_por_user_id: finalCriadoPorUserId,
      criado_por_nome: user.name,
      data_limite: payload.data_limite || null,
      origem: payload.origem || "MANUAL"
    };

    // --- DIAGNOSTIC CHECKS ---
    console.log("========================================");
    console.log("[PENDENCIAS SERVICE] createPropostaPendencia: Diagnostics starting...");
    console.log("[PENDENCIAS SERVICE] session.user.id:", sessionUserId);
    console.log("[PENDENCIAS SERVICE] app user.id:", user.id);
    console.log("[PENDENCIAS SERVICE] criado_por_user_id sent:", finalCriadoPorUserId);
    console.log("[PENDENCIAS SERVICE] id_empresa sent:", insertData.id_empresa);
    console.log("[PENDENCIAS SERVICE] responsavel_setor sent:", insertData.responsavel_setor);
    console.log("[PENDENCIAS SERVICE] Logged in User Name:", user.name);
    console.log("[PENDENCIAS SERVICE] Logged in User Email:", user.email);
    console.log("[PENDENCIAS SERVICE] Logged in User Sector:", user.sector);
    console.log("[PENDENCIAS SERVICE] Payload received:", payload);
    console.log("[PENDENCIAS SERVICE] Final insertData structure:", insertData);

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUserUuidValid = uuidRegex.test(finalCriadoPorUserId);
    console.log(`[PENDENCIAS SERVICE] Is criado_por_user_id (${finalCriadoPorUserId}) a valid UUID format?`, isUserUuidValid);

    let isPagamentoUuidValid = true;
    if (insertData.pagamento_id !== null && insertData.pagamento_id !== undefined) {
      isPagamentoUuidValid = uuidRegex.test(String(insertData.pagamento_id));
      console.log(`[PENDENCIAS SERVICE] Is pagamento_id (${insertData.pagamento_id}) a valid UUID format?`, isPagamentoUuidValid);
    } else {
      console.log("[PENDENCIAS SERVICE] pagamento_id is null/undefined (valid)");
    }

    const validCategorias = ["CREDITO", "DOCUMENTO", "PAGAMENTO", "COMERCIAL", "PRODUCAO", "FISCAL", "OUTRO"];
    const validStatuses = ["ABERTA", "EM_ANDAMENTO", "CONCLUIDA", "CANCELADA"];
    const validPrioridades = ["BAIXA", "MEDIA", "ALTA", "URGENTE"];

    const isCategoriaValid = validCategorias.includes(insertData.categoria);
    const isStatusValid = validStatuses.includes(insertData.status);
    const isPrioridadeValid = validPrioridades.includes(insertData.prioridade);

    console.log(`[PENDENCIAS SERVICE] Categoria "${insertData.categoria}" is valid?`, isCategoriaValid);
    console.log(`[PENDENCIAS SERVICE] Status "${insertData.status}" is valid?`, isStatusValid);
    console.log(`[PENDENCIAS SERVICE] Prioridade "${insertData.prioridade}" is valid?`, isPrioridadeValid);
    console.log(`[PENDENCIAS SERVICE] id_empresa:`, insertData.id_empresa);
    console.log(`[PENDENCIAS SERVICE] responsavel_setor:`, insertData.responsavel_setor);
    console.log(`[PENDENCIAS SERVICE] origem:`, insertData.origem);

    // Verify if id_int exists in public.propostas
    let propostasExists = false;
    try {
      const { data: propData, error: propErr } = await client
        .from("propostas")
        .select("id_int")
        .eq("id_int", insertData.id_int)
        .maybeSingle();

      if (propErr) {
        console.warn("[PENDENCIAS SERVICE] Error querying public.propostas:", propErr.message);
      } else {
        propostasExists = !!propData;
      }
    } catch (err) {
      console.warn("[PENDENCIAS SERVICE] Exception querying public.propostas:", err);
    }
    console.log(`[PENDENCIAS SERVICE] Does id_int ${insertData.id_int} exist in public.propostas?`, propostasExists);

    // Verify if user exists in public.usuarios
    let userProfileExists = false;
    let userProfile = null;
    try {
      const { data: profileData, error: profileErr } = await client
        .from("usuarios")
        .select("*")
        .eq("user_id", finalCriadoPorUserId);

      if (profileErr) {
        console.warn("[PENDENCIAS SERVICE] Error querying public.usuarios:", profileErr.message);
      } else if (profileData && profileData.length > 0) {
        userProfileExists = true;
        userProfile = profileData[0];
      }
    } catch (err) {
      console.warn("[PENDENCIAS SERVICE] Exception querying public.usuarios:", err);
    }
    console.log(`[PENDENCIAS SERVICE] Does user profile exist in public.usuarios?`, userProfileExists);
    if (userProfileExists) {
      console.log("[PENDENCIAS SERVICE] User profile details:", userProfile);
    }
    console.log("========================================");

    // Perform database insertion
    const { data, error } = await client
      .from("propostas_pendencias")
      .insert([insertData])
      .select("*")
      .single();

    if (error) {
      console.error("[PENDENCIAS SERVICE] Supabase INSERT error:", error);
      let detailedMessage = error.message;

      if (error.code === "42501") {
        detailedMessage = `Erro de RLS (Permissão): O usuário autenticado (${finalCriadoPorUserId}) não possui permissão para criar pendências. Motivos prováveis: 1) Não possui cadastro correspondente na tabela 'public.usuarios'; ou 2) O 'id_empresa' informado (${insertData.id_empresa}) não coincide com o de seu perfil.`;
      } else if (error.code === "23503") {
        detailedMessage = `Erro de Chave Estrangeira: Algum ID referenciado (id_int, id_cliente, chat_id ou pagamento_id) não existe no banco. Detalhe: ${error.details || error.message}`;
      } else if (error.code === "22P02") {
        detailedMessage = `Erro de Formato: Tipo de dados incompatível (ex: UUID inválido). Detalhe: ${error.message}`;
      } else if (error.code === "23514") {
        detailedMessage = `Erro de Restrição (CHECK): Um ou mais campos violam restrições do banco. Categoria/Prioridade/Status inválido. Detalhe: ${error.message}`;
      }

      return { success: false, errorMessage: detailedMessage };
    }

    const createdPendencia = data as PropostaPendencia;
    console.log("[PENDENCIAS SERVICE] Insertion succeeded. Created pendency record:", createdPendencia);

    // Registrar mensagem do tipo SISTEMA no chat/timeline
    const systemMsg = `${user.name} criou a pendência "${createdPendencia.titulo}" (Categoria: ${createdPendencia.categoria}, Prioridade: ${createdPendencia.prioridade}, Setor: ${createdPendencia.responsavel_setor})`;
    await sendPropostaChatMessage({
      id_int: createdPendencia.id_int,
      mensagem: systemMsg,
      tipo: "SISTEMA",
      autor_uid: finalCriadoPorUserId,
      autor_nome: user.name,
      autor_email: user.email,
      setor: user.sector,
      avatar: null,
      visivel_externo: false,
      anexos: null,
      id_cliente: createdPendencia.id_cliente ? Number(createdPendencia.id_cliente) : null
    });

    return { success: true, data: createdPendencia };
  } catch (err) {
    console.error("[PENDENCIAS SERVICE] Unexpected exception in createPropostaPendencia:", err);
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao criar pendência."
    };
  }
}

export async function updatePropostaPendenciaStatus(
  id: number,
  idInt: number,
  idCliente: number | null,
  status: "ABERTA" | "EM_ANDAMENTO" | "CONCLUIDA" | "CANCELADA",
  titulo: string,
  user: { id: string; name: string; email: string; sector: string | null }
): Promise<{ success: boolean; data?: PropostaPendencia; errorMessage?: string }> {
  const client = getSupabaseClient();
  if (!client) {
    console.error("[PENDENCIAS SERVICE] Cliente Supabase não configurado.");
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }
  try {
    // 5. & 6. Fetch session.user.id to guarantee authenticity of auth.uid()
    const { data: sessionData } = await client.auth.getSession();
    const sessionUserId = sessionData?.session?.user?.id || null;

    const finalUserId = sessionUserId || user.id;

    const updateData: Record<string, string | number | null | undefined> = {
      status,
      updated_at: new Date().toISOString()
    };

    let systemMsg = "";
    if (status === "EM_ANDAMENTO") {
      updateData.responsavel_user_id = finalUserId;
      systemMsg = `${user.name} assumiu a pendência "${titulo}"`;
    } else if (status === "CONCLUIDA") {
      updateData.concluido_por_user_id = finalUserId;
      updateData.concluido_por_nome = user.name;
      updateData.concluido_at = new Date().toISOString();
      systemMsg = `${user.name} concluiu a pendência "${titulo}"`;
    } else if (status === "CANCELADA") {
      updateData.cancelado_por_user_id = finalUserId;
      updateData.cancelado_por_nome = user.name;
      updateData.cancelado_at = new Date().toISOString();
      systemMsg = `${user.name} cancelou a pendência "${titulo}"`;
    } else if (status === "ABERTA") {
      systemMsg = `${user.name} reabriu a pendência "${titulo}"`;
    }

    console.log(`[PENDENCIAS SERVICE] updatePropostaPendenciaStatus: ID=${id}, Status=${status}, User=${finalUserId}, sessionUserId=${sessionUserId}`);

    const { data, error } = await client
      .from("propostas_pendencias")
      .update(updateData)
      .eq("id", id)
      .select("*")
      .single();

    if (error) {
      console.error("[PENDENCIAS SERVICE] Supabase UPDATE error:", error);
      let detailedMessage = error.message;

      if (error.code === "42501") {
        detailedMessage = `Erro de RLS (Permissão): O usuário autenticado (${finalUserId}) não possui permissão para atualizar esta pendência.`;
      }

      return { success: false, errorMessage: detailedMessage };
    }

    const updatedPendencia = data as PropostaPendencia;
    console.log("[PENDENCIAS SERVICE] Update succeeded. Updated record:", updatedPendencia);

    // Registrar mensagem do tipo SISTEMA no chat/timeline
    await sendPropostaChatMessage({
      id_int: idInt,
      mensagem: systemMsg,
      tipo: "SISTEMA",
      autor_uid: finalUserId,
      autor_nome: user.name,
      autor_email: user.email,
      setor: user.sector,
      avatar: null,
      visivel_externo: false,
      anexos: null,
      id_cliente: idCliente ? Number(idCliente) : null
    });

    return { success: true, data: updatedPendencia };
  } catch (err) {
    console.error("[PENDENCIAS SERVICE] Unexpected exception in updatePropostaPendenciaStatus:", err);
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao atualizar status."
    };
  }
}

export interface PropostaPendenciaJoined extends PropostaPendencia {
  propostas?: {
    cliente: string | null;
    empresa: string | null;
  } | null;
}

export async function listAllPropostasPendencias(options?: {
  limit?: number;
  offset?: number;
}): Promise<{
  success: boolean;
  data: PropostaPendenciaJoined[];
  count?: number;
  errorMessage?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, data: [], errorMessage: "Cliente Supabase não configurado." };
  }
  try {
    let query = client
      .from("propostas_pendencias")
      .select(`
        *,
        propostas (
          cliente,
          empresa
        )
      `, { count: "exact" });

    // Order by created_at desc
    query = query.order("created_at", { ascending: false });

    if (options?.limit !== undefined) {
      if (options?.offset !== undefined) {
        query = query.range(options.offset, options.offset + options.limit - 1);
      } else {
        query = query.limit(options.limit);
      }
    }

    const { data, error, count } = await query;

    if (error) {
      return { success: false, data: [], errorMessage: error.message };
    }
    return { success: true, data: data as PropostaPendenciaJoined[], count: count ?? undefined };
  } catch (err) {
    return {
      success: false,
      data: [],
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao listar todas as pendências."
    };
  }
}

export async function getActiveUserPendenciasCount(userId: string): Promise<{
  success: boolean;
  count: number;
  errorMessage?: string;
}> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, count: 0, errorMessage: "Cliente Supabase não configurado." };
  }
  try {
    const { count, error } = await client
      .from("propostas_pendencias")
      .select("*", { count: "exact", head: true })
      .eq("responsavel_user_id", userId)
      .in("status", ["ABERTA", "EM_ANDAMENTO"]);

    if (error) {
      return { success: false, count: 0, errorMessage: error.message };
    }
    return { success: true, count: count || 0 };
  } catch (err) {
    return {
      success: false,
      count: 0,
      errorMessage: err instanceof Error ? err.message : "Erro inesperado ao obter contagem de pendências."
    };
  }
}
