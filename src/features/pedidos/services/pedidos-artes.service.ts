import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoArte } from "@/features/producao/types";

function isValidUuid(uuid: string | undefined): boolean {
  if (!uuid) return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid);
}

/**
 * Busca em public.pedidos_artes as artes vinculadas a um determinado modelo
 * Ordenado por versão asc
 */
export async function listarArtesDoModelo(idModelo: string): Promise<PedidoArte[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.error("[PedidosArtesService] Cliente Supabase não configurado.");
    return [];
  }

  const { data, error } = await client
    .from("pedidos_artes")
    .select("*")
    .eq("id_modelo", idModelo)
    .order("versao", { ascending: true });

  if (error) {
    console.error(`[PedidosArtesService] Erro ao buscar artes do modelo ${idModelo}:`, error);
    return [];
  }

  return (data || []) as PedidoArte[];
}

export interface AnexarArteInput {
  idInt: number;
  idModelo: string;
  arquivo: File;
  enviadoPor?: string;
  enviadoPorUid?: string;
}

export interface AnexarArteResult {
  success: boolean;
  data?: PedidoArte;
  error?: string;
}

/**
 * Valida, faz upload da arte versão 1 para o Storage e grava o registro em public.pedidos_artes
 */
export async function anexarArteVersao1(input: AnexarArteInput): Promise<AnexarArteResult> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, error: "Cliente Supabase não configurado." };
  }

  const { idInt, idModelo, arquivo, enviadoPor, enviadoPorUid } = input;

  // 1. Validações básicas
  if (!idInt || isNaN(idInt)) {
    return { success: false, error: "ID interno do pedido inválido." };
  }
  if (!idModelo) {
    return { success: false, error: "ID do modelo não fornecido." };
  }
  if (!arquivo) {
    return { success: false, error: "Arquivo de arte não fornecido." };
  }

  // 2. Validações de tipo e tamanho de arquivo
  const allowedMimeTypes = ["image/jpeg", "image/png", "application/pdf"];
  if (!allowedMimeTypes.includes(arquivo.type)) {
    return { success: false, error: "Formato de arquivo não suportado. Apenas JPEG, PNG e PDF são permitidos." };
  }

  const maxSizeBytes = 10 * 1024 * 1024; // 10MB
  if (arquivo.size > maxSizeBytes) {
    return { success: false, error: "O tamanho do arquivo excede o limite permitido de 10MB." };
  }

  // 3. (Removido: validação que bloqueava múltiplos arquivos por modelo)

  // 4. Sanitizar o nome do arquivo
  const parts = arquivo.name.split(".");
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
  const uploadPath = `pedidos-artes/${idInt}/${idModelo}/v1_${timestamp}_${sanitizedName}`;

  // 5. Upload para o bucket público 'chat-ideal'
  const { data: uploadData, error: uploadError } = await client.storage
    .from("chat-ideal")
    .upload(uploadPath, arquivo, {
      cacheControl: "3600",
      contentType: arquivo.type,
      upsert: false
    });

  if (uploadError || !uploadData) {
    console.error("[PedidosArtesService] Erro no upload para o Storage:", uploadError);
    return { success: false, error: `Erro no upload do Storage: ${uploadError?.message || "Erro desconhecido."}` };
  }

  // 6. Gerar URL pública (Convenção)
  const publicUrlResult = client.storage
    .from("chat-ideal")
    .getPublicUrl(uploadPath);
  const publicUrl = publicUrlResult.data?.publicUrl || null;

  const { data: userData } = await client.auth.getUser();
  console.log('[PedidosArtesService] USER', userData);

  // Calcular próxima versão baseada na constraint UNIQUE (id_modelo, versao)
  const { data: maxVersaoData, error: maxVersaoError } = await client
    .from("pedidos_artes")
    .select("versao")
    .eq("id_modelo", idModelo)
    .order("versao", { ascending: false })
    .limit(1);

  let proximaVersao = 1;
  if (!maxVersaoError && maxVersaoData && maxVersaoData.length > 0 && maxVersaoData[0].versao != null) {
    proximaVersao = maxVersaoData[0].versao + 1;
  }

  const payload = {
    id_int: idInt,
    id_modelo: idModelo,
    versao: proximaVersao,
    nome_arquivo: arquivo.name,
    storage_bucket: "chat-ideal",
    storage_path: uploadPath,
    url_arquivo: publicUrl,
    tipo_arquivo: extension?.toUpperCase() || null,
    mime_type: arquivo.type,
    tamanho_bytes: arquivo.size,
    status: "PENDENTE",
    enviado_por: enviadoPor || null,
    enviado_por_uid: isValidUuid(enviadoPorUid) ? enviadoPorUid : null
  };

  console.log('[PedidosArtesService] PAYLOAD ARTE', JSON.stringify(payload, null, 2));

  // 7. Inserir registro na tabela public.pedidos_artes
  const { data: insertData, error: insertError } = await client
    .from("pedidos_artes")
    .insert(payload)
    .select()
    .single();

  if (insertError) {
    console.error('[PedidosArtesService] ERRO ARTE', JSON.stringify(insertError, null, 2));
    console.error("[PedidosArtesService] Erro ao inserir registro da arte:", {
      code: insertError.code,
      message: insertError.message,
      details: insertError.details,
      hint: insertError.hint
    });
    return {
      success: false,
      error: `Erro ao salvar registro no banco: [${insertError.code}] ${insertError.message}. Details: ${insertError.details || "-"}. Hint: ${insertError.hint || "-"}`
    };
  }

  console.log('[PedidosArtesService] RESULTADO ARTE', insertData);

  return { success: true, data: insertData as PedidoArte };
}

/**
 * Carrega o registro principal de briefing de artes da proposta.
 */
export async function carregarBriefingArtes(idInt: number): Promise<PedidoArte | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pedidos_artes")
    .select("*")
    .eq("id_int", idInt)
    .is("nome_arquivo", null)
    .limit(1)
    .single();

  if (error && error.code !== "PGRST116") { // PGRST116 é "No rows found"
    console.error(`[PedidosArtesService] Erro ao carregar briefing (id_int: ${idInt}):`, error);
    return null;
  }

  return (data as PedidoArte) || null;
}

/**
 * Salva (UPSERT) o registro principal de briefing de artes da proposta.
 */
export async function salvarBriefingArtes(idInt: number, payload: Partial<PedidoArte>): Promise<PedidoArte | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  // Garantir chaves do registro principal, enviando estritamente o necessário
  const savePayload = {
    id_int: idInt,
    nome_evento: payload.nome_evento,
    data_evento: payload.data_evento,
    local_evento: payload.local_evento,
    observacoes: payload.observacoes,
    designer_uid: payload.designer_uid,
    designer_nome: payload.designer_nome,
    status: payload.status,
    data_envio: (payload as any).data_envio
  };

  // Remover undefined para não sobrescrever com null indesejado
  Object.keys(savePayload).forEach(key => {
    if ((savePayload as any)[key] === undefined) {
      delete (savePayload as any)[key];
    }
  });

  // 1. Verificar se já existe
  const { data: existente, error: selectError } = await client
    .from("pedidos_artes")
    .select("id")
    .eq("id_int", idInt)
    .is("nome_arquivo", null)
    .limit(1)
    .single();

  if (selectError && selectError.code !== "PGRST116") {
    console.error(`[PedidosArtesService] Erro ao verificar briefing existente (id_int: ${idInt}):`, selectError);
    return null;
  }

  const { data: userData } = await client.auth.getUser();
  console.log('[PedidosArtesService] USER', userData);

  // 2. Insert ou Update
  if (existente?.id) {
    console.log('[PedidosArtesService] PAYLOAD BRIEFING', JSON.stringify(savePayload, null, 2));
    const { data: updateData, error: updateError } = await client
      .from("pedidos_artes")
      .update(savePayload)
      .eq("id", existente.id)
      .select();

    if (updateError) {
      console.error('[PedidosArtesService] ERRO BRIEFING', JSON.stringify(updateError, null, 2));
      console.error(`[PedidosArtesService] Erro no UPDATE do briefing (id: ${existente.id}):`, updateError);
      return null;
    }
    console.log('[PedidosArtesService] RESULTADO BRIEFING', updateData);
    return updateData ? updateData[0] : null;
  } else {
    // Para INSERT, devemos garantir um status inicial
    if (!savePayload.status) {
      (savePayload as any).status = "PENDENTE";
    }

    console.log('[PedidosArtesService] PAYLOAD BRIEFING', JSON.stringify(savePayload, null, 2));
    const { data: insertData, error: insertError } = await client
      .from("pedidos_artes")
      .insert(savePayload)
      .select();

    if (insertError) {
      console.error('[PedidosArtesService] ERRO BRIEFING', JSON.stringify(insertError, null, 2));
      console.error(`[PedidosArtesService] Erro no INSERT do briefing (id_int: ${idInt}):`, insertError);
      return null;
    }
    console.log('[PedidosArtesService] RESULTADO BRIEFING', insertData);
    return insertData ? insertData[0] : null;
  }
}

/**
 * Busca em public.pedidos_artes os arquivos anexados a uma proposta
 */
export async function listarArquivosDaProposta(idInt: number): Promise<PedidoArte[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("pedidos_artes")
    .select("*")
    .eq("id_int", idInt)
    .not("nome_arquivo", "is", null)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[PedidosArtesService] Erro ao listar arquivos da proposta ${idInt}:`, error);
    return [];
  }

  return (data || []) as PedidoArte[];
}

/**
 * Remove o arquivo do Storage e deleta o registro da tabela public.pedidos_artes
 */
export async function excluirArte(id: number): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Cliente Supabase não configurado." };

  // 1. Buscar registro para pegar infos de storage
  const { data: arte, error: selectError } = await client
    .from("pedidos_artes")
    .select("storage_bucket, storage_path")
    .eq("id", id)
    .single();

  if (selectError) {
    console.error(`[PedidosArtesService] Erro ao buscar arte ${id} para exclusão:`, selectError);
    return { success: false, error: "Erro ao buscar arte no banco para exclusão." };
  }

  // 2. Tentar remover do Storage se houver path
  if (arte?.storage_bucket && arte?.storage_path) {
    const { error: storageError } = await client.storage
      .from(arte.storage_bucket)
      .remove([arte.storage_path]);

    if (storageError) {
      console.error(`[PedidosArtesService] Erro ao remover do Storage (path: ${arte.storage_path}):`, storageError);
      return { success: false, error: `Erro ao remover do Storage: ${storageError.message}` };
    }
  }

  // 3. Remover do banco de dados
  const { error: deleteError } = await client
    .from("pedidos_artes")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error(`[PedidosArtesService] Erro ao deletar arte ${id} do banco:`, deleteError);
    return { success: false, error: `Erro ao deletar registro do banco: ${deleteError.message}` };
  }

  return { success: true };
}
