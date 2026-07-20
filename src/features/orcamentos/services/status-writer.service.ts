import { getSupabaseClient } from "@/lib/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendPropostaChatMessage } from "./orcamentos.service";
import { validarStatusProposta } from "./status-shadow.service";

export type OrigemAutomacao = "AUTO_FINANCEIRO" | "AUTO_ARTE" | "AUTO_MODELOS";

export interface AplicarStatusUsuario {
  uid: string;
  nome: string;
  email: string;
}

export async function aplicarStatusRecomendadoProposta(
  idInt: number,
  usuario: AplicarStatusUsuario,
  client: SupabaseClient,
  origemAutomacao?: OrigemAutomacao
): Promise<{ success: boolean; errorMessage?: string }> {
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não fornecido." };
  }

  // 1. Fetch current proposal state
  const { data: propData, error: propError } = await client
    .from("propostas")
    .select("status_interno, is_avulso")
    .eq("id_int", idInt)
    .single();

  if (propError || !propData) {
    return { success: false, errorMessage: "Proposta não encontrada." };
  }

  const statusAtual = propData.status_interno || "NOVO";
  const isAvulso = propData.is_avulso || false;

  // 2. Calcular o status via Engine Oficial
  // Repassa o client recebido (autenticado server-side quando chamado de uma rota
  // Route Handler) — sem isso, validarStatusProposta cairia no client de navegador
  // (getSupabaseClient()), que não existe em contexto de servidor.
  const diagnostic = await validarStatusProposta(idInt, isAvulso, statusAtual, client);

  if (!diagnostic) {
    return { success: false, errorMessage: "Falha ao calcular o diagnóstico na engine." };
  }

  if (!diagnostic.mudariaStatus) {
    return { success: false, errorMessage: "Nenhuma divergência encontrada. O status já está alinhado." };
  }

  const statusRecomendado = diagnostic.statusRecomendado;
  const motivo = diagnostic.motivo;

  // 3. Log Inicial (Tentativa)
  const firstLogMessage = origemAutomacao 
    ? `Tentativa de automação de status via ${origemAutomacao}.`
    : `Status atualizado automaticamente pela Engine Fase 4A de ${statusAtual} para ${statusRecomendado}.`;
    
  const setor = origemAutomacao || "STATUS_ENGINE_FASE_4A";

  const firstChatResult = await sendPropostaChatMessage({
    id_int: idInt,
    mensagem: firstLogMessage,
    tipo: "SISTEMA",
    autor_uid: usuario.uid || null,
    autor_nome: usuario.nome || "Sistema",
    autor_email: usuario.email || null,
    setor,
    avatar: null,
    visivel_externo: false,
    anexos: null,
    id_cliente: null
  });

  if (!firstChatResult.success) {
    return { success: false, errorMessage: `Falha ao registrar log de tentativa: ${firstChatResult.errorMessage}` };
  }

  // 5. Optimistic Locking (Escrita real no banco)
  const { data: updateData, error: updateError } = await client
    .from("propostas")
    .update({ status_interno: statusRecomendado })
    .eq("id_int", idInt)
    .eq("status_interno", statusAtual)
    .select("id_int");

  if (updateError) {
    console.error("[StatusWriterService] Erro ao atualizar status_interno:", updateError);
    return { success: false, errorMessage: `Erro ao atualizar banco: ${updateError.message}` };
  }

  if (!updateData || updateData.length === 0) {
    return { 
      success: false, 
      errorMessage: `Conflito de atualização (Race Condition). O status no banco mudou enquanto a engine processava. Abortado.` 
    };
  }

  // 5.5 Leitura Confirmatória
  const { data: checkData, error: checkError } = await client
    .from("propostas")
    .select("status_interno")
    .eq("id_int", idInt)
    .single();

  if (checkError || !checkData) {
    return {
      success: false,
      errorMessage: `Update retornou sucesso, mas falhou ao ler confirmação do status. Log final não gravado.`
    };
  }

  if (checkData.status_interno !== statusRecomendado) {
    console.error(`[CRÍTICO] Inconsistência de DB na Proposta #${idInt}: Update tentou ${statusRecomendado}, mas leitura retornou ${checkData.status_interno}.`);
    return {
      success: false,
      errorMessage: `Falha silenciosa de persistência: o update foi executado, mas o status no banco continuou [${checkData.status_interno}]. Log final não foi gravado.`
    };
  }

  // 6. Log Final (Confirmação)
  if (origemAutomacao) {
    await sendPropostaChatMessage({
      id_int: idInt,
      mensagem: `Automacao: Transicao realizada (${statusAtual} -> ${statusRecomendado})`,
      tipo: "SISTEMA",
      autor_uid: usuario.uid || null,
      autor_nome: usuario.nome || "Sistema",
      autor_email: usuario.email || null,
      setor,
      avatar: null,
      visivel_externo: false,
      anexos: null,
      id_cliente: null
    });

    return { success: true };
  }

  const finalLogMessage = `Status alterado pela Engine Fase 4A de [${statusAtual}] para [${statusRecomendado}].\n\nMotivo Técnico: ${motivo}`;
  
  const finalChatResult = await sendPropostaChatMessage({
    id_int: idInt,
    mensagem: finalLogMessage,
    tipo: "SISTEMA",
    autor_uid: usuario.uid || null,
    autor_nome: usuario.nome || "Sistema",
    autor_email: usuario.email || null,
    setor,
    avatar: null,
    visivel_externo: false,
    anexos: null,
    id_cliente: null
  });

  if (!finalChatResult.success) {
    console.error(`[CRÍTICO] Status alterado para ${idInt} mas o log final falhou! Erro: ${finalChatResult.errorMessage}`);
    return { 
      success: false, 
      errorMessage: `Status foi atualizado com sucesso, MAS ocorreu uma falha ao registrar o log final de confirmação: ${finalChatResult.errorMessage}. (O log de tentativa foi registrado)` 
    };
  }

  return { success: true };
}
