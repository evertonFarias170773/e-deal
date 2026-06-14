// SERVICE: src/features/producao/services/producao-artes.service.ts
// Descrição: Serviço para controle de modelos e upload/versionamento de artes operacionais da Produção

import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoModelo, PedidoArte, StatusArteProducao, StatusProducaoModelo } from "../types";

export interface PropostaChatAnexo {
  url: string;
  name: string;
  type: string;
  size: number;
  bucket?: string;
  path?: string;
  nome_arquivo?: string;
  mime_type?: string | null;
  tamanho_bytes?: number | null;
  versao?: number;
  id_modelo?: string;
}

export interface RegistrarEventoChatParams {
  id_int: number;
  mensagem: string;
  autor_nome: string;
  autor_uid?: string | null;
  autor_email?: string | null;
  id_cliente?: number | null;
  anexos?: Array<{
    bucket: string;
    path: string;
    nome_arquivo: string;
    mime_type: string | null;
    tamanho_bytes: number | null;
    versao: number;
    id_modelo: string;
    url: string;
  }>;
}

export interface UploadNovaVersaoArteParams {
  idInt: number;
  idModelo: string;
  nomeModelo: string;
  file: File;
  autorUid?: string | null;
  autorNome?: string | null;
  autorEmail?: string | null;
  idCliente?: number | null;
  statusInicial?: StatusArteProducao;
}

export interface AtualizarStatusArteParams {
  idInt: number;
  idModelo: string;
  nomeModelo: string;
  idArte: string;
  versao: number;
  novoStatus: StatusArteProducao;
  comentariosRevisao?: string | null;
  autorNome: string;
  autorUid?: string | null;
  autorEmail?: string | null;
  idCliente?: number | null;
}

/**
 * Obtém todos os modelos cadastrados de uma proposta por id_int
 */
export async function listarModelosPorPedido(idInt: number): Promise<PedidoModelo[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado.");
  }

  const { data, error } = await client
    .from("pedidos_modelos")
    .select("*")
    .eq("id_int", idInt)
    .order("ordem", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[producao-artes.service] Erro ao buscar modelos:", error);
    throw error;
  }

  return (data || []) as PedidoModelo[];
}

/**
 * Obtém todo o histórico de artes de um determinado modelo
 */
export async function listarArtesPorModelo(idModelo: string): Promise<PedidoArte[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado.");
  }

  const { data, error } = await client
    .from("pedidos_artes")
    .select("*")
    .eq("id_modelo", idModelo)
    .order("versao", { ascending: false });

  if (error) {
    console.error("[producao-artes.service] Erro ao buscar artes do modelo:", error);
    throw error;
  }

  return (data || []) as PedidoArte[];
}

/**
 * Obtém todo o histórico de artes de uma proposta/pedido por id_int
 */
export async function listarArtesPorPedido(idInt: number): Promise<PedidoArte[]> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado.");
  }

  const { data, error } = await client
    .from("pedidos_artes")
    .select("*")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[producao-artes.service] Erro ao buscar artes da proposta:", error);
    throw error;
  }

  return (data || []) as PedidoArte[];
}

/**
 * Cria um novo modelo de pedido
 */
export async function criarModelo(payload: {
  id_int: number;
  nome_modelo: string;
  descricao?: string | null;
  quantidade: number;
  tipo_numeracao?: string | null;
  numeracao_inicio?: number | null;
  numeracao_fim?: number | null;
  obs_impressao?: string | null;
  status_arte?: StatusArteProducao;
  status_producao?: StatusProducaoModelo;
  id_pedido?: string | null;
  id_item?: string | null;
  id_produto_proposta_origem?: number | null;
  ordem?: number;
}): Promise<PedidoModelo> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado.");
  }

  const { data, error } = await client
    .from("pedidos_modelos")
    .insert({
      ...payload,
      status_arte: payload.status_arte || "PENDENTE",
      status_producao: payload.status_producao || "PENDENTE",
      ordem: payload.ordem ?? 1
    })
    .select()
    .single();

  if (error) {
    console.error("[producao-artes.service] Erro ao criar modelo:", error);
    throw error;
  }

  return data as PedidoModelo;
}

/**
 * Insere uma nota/evento na timeline do chat-ideal (propostas_chat)
 */
export async function registrarEventoProducaoChat(params: RegistrarEventoChatParams): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado.");
  }

  const { id_int, mensagem, autor_nome, autor_uid, autor_email, id_cliente, anexos } = params;

  const anexosFormatados: PropostaChatAnexo[] = anexos?.map(anexo => ({
    url: anexo.url,
    name: anexo.nome_arquivo,
    type: anexo.mime_type || "application/octet-stream",
    size: anexo.tamanho_bytes || 0,
    bucket: anexo.bucket,
    path: anexo.path,
    nome_arquivo: anexo.nome_arquivo,
    mime_type: anexo.mime_type,
    tamanho_bytes: anexo.tamanho_bytes,
    versao: anexo.versao,
    id_modelo: anexo.id_modelo
  })) || [];

  const { error } = await client
    .from("propostas_chat")
    .insert({
      id_int,
      mensagem,
      tipo: "PRODUCAO",
      autor_uid: autor_uid || null,
      autor_nome: autor_nome || "Sistema",
      autor_email: autor_email || null,
      setor: "Pre-impressao",
      visivel_externo: false,
      anexos: anexosFormatados,
      id_cliente: id_cliente || null
    });

  if (error) {
    console.warn("[producao-artes.service] Erro ao gravar mensagem na timeline propostas_chat:", error);
    return false;
  }

  return true;
}

/**
 * Faz upload de nova versão de arte para o storage chat-ideal e grava linha em pedidos_artes.
 * Registra o envio no chat da proposta (propostas_chat).
 */
export async function uploadNovaVersaoArte(
  params: UploadNovaVersaoArteParams
): Promise<{ success: boolean; data?: PedidoArte; errorMessage?: string }> {
  const { idInt, idModelo, nomeModelo, file, autorUid, autorNome, autorEmail, idCliente, statusInicial } = params;
  
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, errorMessage: "Cliente Supabase não configurado." };
  }

  // 1. Sanitizar nome do arquivo
  const parts = file.name.split(".");
  const extension = parts.length > 1 ? parts.pop() : "";
  const baseName = parts.join(".") || "anexo";
  const normalizedBaseName = baseName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const normalizedExtension = extension?.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  const sanitizedName = normalizedExtension 
    ? `${normalizedBaseName}.${normalizedExtension}`
    : normalizedBaseName;

  const timestamp = Date.now();
  const uploadPath = `propostas/${idInt}/artes/${idModelo}/${timestamp}_${sanitizedName}`;

  try {
    // 2. Realizar o upload para o storage chat-ideal
    const { data: uploadData, error: uploadError } = await client.storage
      .from("chat-ideal")
      .upload(uploadPath, file, {
        cacheControl: "3600",
        contentType: file.type
      });

    if (uploadError || !uploadData) {
      console.error("[PRODUCAO_UPLOAD] Erro no upload do arquivo:", uploadError);
      return { success: false, errorMessage: uploadError?.message || "Erro ao salvar arquivo no Storage." };
    }

    // Obter URL pública do anexo
    const publicUrlResult = client.storage
      .from("chat-ideal")
      .getPublicUrl(uploadData.path);

    const publicUrl = publicUrlResult.data?.publicUrl;
    if (!publicUrl) {
      return { success: false, errorMessage: "Falha ao gerar URL pública do arquivo." };
    }

    // 3. Gravar na tabela pedidos_artes tratando concorrência de versão concorrente
    let retryCount = 0;
    let dbSuccess = false;
    let lastError: { code?: string; message?: string } | null = null;
    let nextVersao = 1;
    let newArteRecord: PedidoArte | undefined;

    while (retryCount < 2 && !dbSuccess) {
      // Buscar a maior versão cadastrada no modelo
      const { data: artesExistentes, error: fetchError } = await client
        .from("pedidos_artes")
        .select("versao")
        .eq("id_modelo", idModelo)
        .order("versao", { ascending: false })
        .limit(1);

      if (fetchError) {
        throw new Error(`Erro ao buscar versão da arte: ${fetchError.message}`);
      }

      nextVersao = (artesExistentes && artesExistentes.length > 0) ? (artesExistentes[0].versao + 1) : 1;

      // Inserir nova arte com a versão calculada
      const { data: insertData, error: insertError } = await client
        .from("pedidos_artes")
        .insert({
          id_int: idInt,
          id_modelo: idModelo,
          versao: nextVersao,
          nome_arquivo: file.name,
          storage_bucket: "chat-ideal",
          storage_path: uploadPath,
          url_arquivo: publicUrl,
          tipo_arquivo: extension?.toUpperCase() || null,
          mime_type: file.type || null,
          tamanho_bytes: file.size,
          status: statusInicial || "PENDENTE",
          enviado_por: autorNome || "Sistema",
          enviado_por_uid: autorUid || null
        })
        .select()
        .single();

      if (insertError) {
        if (insertError.code === "23505") {
          retryCount++;
          console.warn(`[PRODUCAO_CONCORRENCIA] Colisão de versão ${nextVersao} no modelo ${idModelo}. Retrying ${retryCount}...`);
          continue;
        }
        lastError = insertError;
        break;
      }

      dbSuccess = true;
      newArteRecord = insertData as PedidoArte;
    }

    if (!dbSuccess) {
      if (lastError && lastError.code === "23505") {
        return { 
          success: false, 
          errorMessage: "Esta versão da arte já foi enviada por outro processo simultâneo. Por favor, tente enviar o arquivo novamente." 
        };
      }
      return { 
        success: false, 
        errorMessage: lastError?.message || "Erro ao registrar informações da arte no banco de dados." 
      };
    }

    // 4. Atualizar o status da arte no modelo correspondente
    const statusModelo = statusInicial || "PENDENTE";
    const { error: updateModeloError } = await client
      .from("pedidos_modelos")
      .update({ status_arte: statusModelo, updated_at: new Date().toISOString() })
      .eq("id", idModelo);

    if (updateModeloError) {
      console.warn("[PRODUCAO_UPLOAD] Erro ao atualizar status de arte do modelo:", updateModeloError);
    }

    // 5. Inserir timeline na tabela propostas_chat
    await registrarEventoProducaoChat({
      id_int: idInt,
      mensagem: `Nova versão de arte (v${nextVersao}) enviada para o modelo "${nomeModelo}".`,
      autor_nome: autorNome || "Sistema",
      autor_uid: autorUid,
      autor_email: autorEmail,
      id_cliente: idCliente,
      anexos: [{
        bucket: "chat-ideal",
        path: uploadPath,
        nome_arquivo: file.name,
        mime_type: file.type || "application/octet-stream",
        tamanho_bytes: file.size,
        versao: nextVersao,
        id_modelo: idModelo,
        url: publicUrl
      }]
    });

    return { success: true, data: newArteRecord };
  } catch (err) {
    console.error("[PRODUCAO_UPLOAD] Exceção no fluxo de upload da arte:", err);
    return {
      success: false,
      errorMessage: err instanceof Error ? err.message : "Erro desconhecido durante o upload."
    };
  }
}

/**
 * Atualiza o status de uma arte específica e propaga para o modelo de pedido caso seja a versão ativa
 */
export async function atualizarStatusArte(params: AtualizarStatusArteParams): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não configurado.");
  }

  const {
    idInt,
    idModelo,
    nomeModelo,
    idArte,
    versao,
    novoStatus,
    comentariosRevisao,
    autorNome,
    autorUid,
    autorEmail,
    idCliente
  } = params;

  // 1. Atualizar o status da arte
  const { error: arteError } = await client
    .from("pedidos_artes")
    .update({
      status: novoStatus,
      comentarios_revisao: comentariosRevisao || null,
      aprovado_por: novoStatus === "APROVADA_CLIENTE" ? autorNome : null,
      data_aprovacao: novoStatus === "APROVADA_CLIENTE" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
    .eq("id", idArte);

  if (arteError) {
    console.error("[producao-artes.service] Erro ao atualizar status da arte:", arteError);
    throw arteError;
  }

  // 2. Verificar se esta arte é a versão mais recente para atualizar o modelo correspondente
  const { data: artesRecentes, error: checkError } = await client
    .from("pedidos_artes")
    .select("id, versao")
    .eq("id_modelo", idModelo)
    .order("versao", { ascending: false })
    .limit(1);

  if (checkError) {
    console.warn("[producao-artes.service] Erro ao checar versão mais recente:", checkError);
  }

  const isMaisRecente = artesRecentes && artesRecentes.length > 0 && artesRecentes[0].id === idArte;

  if (isMaisRecente) {
    const { error: modeloError } = await client
      .from("pedidos_modelos")
      .update({
        status_arte: novoStatus,
        updated_at: new Date().toISOString()
      })
      .eq("id", idModelo);

    if (modeloError) {
      console.error("[producao-artes.service] Erro ao atualizar status no modelo:", modeloError);
      throw modeloError;
    }
  }

  // 3. Registrar na timeline propostas_chat
  let msgTimeline = `Status da arte (v${versao}) do modelo "${nomeModelo}" alterado para ${novoStatus} por ${autorNome}.`;
  if (comentariosRevisao) {
    msgTimeline += ` Observações: "${comentariosRevisao}"`;
  }

  await registrarEventoProducaoChat({
    id_int: idInt,
    mensagem: msgTimeline,
    autor_nome: autorNome,
    autor_uid: autorUid,
    autor_email: autorEmail,
    id_cliente: idCliente
  });

  return true;
}

// Aliases para manter compatibilidade com implementações anteriores do painel
export const getPedidosModelos = listarModelosPorPedido;
export const getPedidosArtes = listarArtesPorModelo;
export const uploadArteModelo = (payload: {
  idInt: number;
  idModelo: string;
  nomeModelo: string;
  file: File;
  autorUid?: string | null;
  autorNome?: string | null;
  autorEmail?: string | null;
  idCliente?: number | null;
}) => uploadNovaVersaoArte({
  idInt: payload.idInt,
  idModelo: payload.idModelo,
  nomeModelo: payload.nomeModelo,
  file: payload.file,
  autorUid: payload.autorUid,
  autorNome: payload.autorNome,
  autorEmail: payload.autorEmail,
  idCliente: payload.idCliente,
  statusInicial: "PENDENTE"
});
