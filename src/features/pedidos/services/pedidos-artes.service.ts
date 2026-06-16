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

  // 3. Consultar se já existe qualquer arte vinculada a este modelo (Versionamento bloqueado)
  const { data: artesExistentes, error: queryError } = await client
    .from("pedidos_artes")
    .select("id")
    .eq("id_modelo", idModelo)
    .limit(1);

  if (queryError) {
    console.error("[PedidosArtesService] Erro ao verificar existência de arte anterior:", queryError);
    return { success: false, error: `Erro ao verificar artes existentes: ${queryError.message}` };
  }

  if (artesExistentes && artesExistentes.length > 0) {
    return { success: false, error: "Este modelo já possui arte anexada. Versionamento será liberado em etapa futura." };
  }

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

  // 7. Inserir registro na tabela public.pedidos_artes
  const { data: insertData, error: insertError } = await client
    .from("pedidos_artes")
    .insert({
      id_int: idInt,
      id_modelo: idModelo,
      versao: 1,
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
    })
    .select()
    .single();

  if (insertError) {
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

  return { success: true, data: insertData as PedidoArte };
}
