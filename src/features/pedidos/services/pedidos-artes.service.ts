import { getSupabaseClient } from "@/lib/supabase/client";
import type { PedidoArte } from "@/features/producao/types";

function isValidUuid(uuid: string | undefined): boolean {
  if (!uuid) return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(uuid);
}

export interface AnexarArquivoInput {
  idInt: number;
  arquivo: File;
  enviadoPor?: string;
  enviadoPorUid?: string;
}

export interface AnexarArquivoResult {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Carrega o registro único de briefing de artes da proposta.
 */
export async function carregarBriefingArtes(idInt: number): Promise<PedidoArte | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pedidos_artes")
    .select("*")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(`[PedidosArtesService] Erro ao carregar briefing (id_int: ${idInt}):`, error);
    return null;
  }

  if (!data || data.length === 0) {
    return null;
  }

  // Se houver múltiplas linhas (devido a bug anterior), fazemos um merge dos arquivos
  const firstRow = data[0] as PedidoArte;
  let mergedArquivos: any[] = [];
  
  data.forEach((row) => {
    if (Array.isArray(row.arquivos)) {
      mergedArquivos = [...mergedArquivos, ...row.arquivos];
    }
  });

  // Deduplicar pelo ID do arquivo, caso existam duplicatas
  const uniqueArquivos = Array.from(new Map(mergedArquivos.map(a => [a.id, a])).values());
  firstRow.arquivos = uniqueArquivos;

  return firstRow;
}

/**
 * Salva (UPSERT) o registro de artes da proposta.
 */
export async function salvarBriefingArtes(idInt: number, payload: Partial<PedidoArte>): Promise<PedidoArte | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const savePayload = {
    id_int: idInt,
    nome_evento: payload.nome_evento,
    data_evento: payload.data_evento,
    local_evento: payload.local_evento,
    observacoes: payload.observacoes,
    designer_uid: payload.designer_uid,
    designer_nome: payload.designer_nome,
    enviado_por: payload.enviado_por,
    enviado_por_uid: payload.enviado_por_uid,
    updated_at: new Date().toISOString(),
    status: payload.status || "AGUARDANDO",
  };

  Object.keys(savePayload).forEach(key => {
    if ((savePayload as any)[key] === undefined) {
      delete (savePayload as any)[key];
    }
  });

  const { data: existente, error: fetchError } = await client
    .from("pedidos_artes")
    .select("id")
    .eq("id_int", idInt)
    .order("created_at", { ascending: false })
    .limit(1);

  if (fetchError) {
    console.error(`[PedidosArtesService] Erro ao buscar briefing existente:`, fetchError);
    return null;
  }

  if (existente && existente.length > 0) {
    const { data: updateData, error: updateError } = await client
      .from("pedidos_artes")
      .update(savePayload)
      .eq("id", existente[0].id)
      .select();

    if (updateError) {
      console.error(`[PedidosArtesService] Erro no UPDATE do briefing:`, JSON.stringify(updateError, null, 2));
      return null;
    }
    return updateData ? updateData[0] : null;
  } else {
    const { data: insertData, error: insertError } = await client
      .from("pedidos_artes")
      .insert(savePayload)
      .select();

    if (insertError) {
      console.error(`[PedidosArtesService] Erro no INSERT do briefing:`, JSON.stringify(insertError, null, 2));
      return null;
    }
    return insertData ? insertData[0] : null;
  }
}

/**
 * O boletim de cada setor NÃO mora mais aqui. Ele saiu para
 * `public.propostas_os_setores` em 13/08/2026 — ver
 * `services/boletim-setores.service.ts`. Enquanto morava nesta tabela, cada
 * boletim aberto criava uma linha que contava como evidência de arte e podia
 * travar a liberação do pedido para produção.
 */

/** Define o setor de cada modelo (a que boletim ele pertence). */
export async function atribuirSetorAosModelos(
  atribuicoes: { id: number; setor: string | null }[]
): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Conexão com o banco de dados não disponível." };

  for (const item of atribuicoes) {
    if (!item.id || Number.isNaN(Number(item.id))) continue;
    const { error } = await client
      .from("pedidos_modelos")
      .update({ setor: item.setor?.trim() ? item.setor.trim() : null })
      .eq("id", item.id);
    if (error) {
      console.error(`[PedidosArtesService] Erro ao atribuir setor ao modelo ${item.id}:`, error);
      return { success: false, error: error.message };
    }
  }
  return { success: true };
}

/**
 * Valida, faz upload e adiciona no array `arquivos` JSONB.
 * Cria o registro caso não exista.
 */
export async function anexarArquivoReferencia(input: AnexarArquivoInput): Promise<AnexarArquivoResult> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Cliente Supabase não configurado." };

  const { idInt, arquivo, enviadoPor, enviadoPorUid } = input;

  if (!idInt || isNaN(idInt)) return { success: false, error: "ID interno do pedido inválido." };
  if (!arquivo) return { success: false, error: "Arquivo não fornecido." };

  const allowedMimeTypes = ["image/jpeg", "image/png", "application/pdf"];
  if (!allowedMimeTypes.includes(arquivo.type)) {
    return { success: false, error: "Formato de arquivo não suportado. Apenas JPEG, PNG e PDF são permitidos." };
  }

  const maxSizeBytes = 10 * 1024 * 1024; // 10MB
  if (arquivo.size > maxSizeBytes) {
    return { success: false, error: "O tamanho do arquivo excede o limite permitido de 10MB." };
  }

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
  const uploadPath = `pedidos-artes/${idInt}/v1_${timestamp}_${sanitizedName}`;

  const { data: uploadData, error: uploadError } = await client.storage
    .from("chat-ideal")
    .upload(uploadPath, arquivo, {
      cacheControl: "3600",
      contentType: arquivo.type,
      upsert: false
    });

  if (uploadError || !uploadData) {
    console.error("[PedidosArtesService] Erro no upload para o Storage:", uploadError);
    return { success: false, error: `Erro no upload do Storage: ${uploadError?.message}` };
  }

  const fileId = crypto.randomUUID();
  const fileObj = {
    id: fileId,
    nome_arquivo: arquivo.name,
    storage_bucket: "chat-ideal",
    storage_path: uploadPath,
    mime_type: arquivo.type,
    tamanho_bytes: arquivo.size,
    comentarios_revisao: "",
    enviado_por: enviadoPor || null,
    enviado_por_uid: isValidUuid(enviadoPorUid) ? enviadoPorUid : null,
    created_at: new Date().toISOString()
  };

  // Garante que o registro exista
  let registro = await carregarBriefingArtes(idInt);
  if (!registro) {
    registro = await salvarBriefingArtes(idInt, { status: "AGUARDANDO" as any });
    if (!registro) return { success: false, error: "Erro ao criar registro base da arte." };
  }

  const arquivosAtuais = Array.isArray(registro.arquivos) ? registro.arquivos : [];
  const novosArquivos = [...arquivosAtuais, fileObj];

  const { data: updateData, error: updateError } = await client
    .from("pedidos_artes")
    .update({ arquivos: novosArquivos })
    .eq("id", registro.id)
    .select()
    .single();

  if (updateError) {
    return { success: false, error: `Erro ao atualizar array de arquivos: ${updateError.message}` };
  }

  return { success: true, data: updateData };
}

/**
 * Retorna os arquivos anexados a uma proposta extraindo do JSONB
 */
export async function listarArquivosDaProposta(idInt: number): Promise<any[]> {
  const registro = await carregarBriefingArtes(idInt);
  if (!registro || !Array.isArray(registro.arquivos)) {
    return [];
  }
  return registro.arquivos;
}

/**
 * Remove o arquivo do Storage e do array arquivos do JSONB
 */
export async function excluirArquivo(idInt: number, arquivoId: string): Promise<{ success: boolean; error?: string }> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Cliente Supabase não configurado." };

  const registro = await carregarBriefingArtes(idInt);
  if (!registro || !Array.isArray(registro.arquivos)) {
    return { success: false, error: "Registro ou arquivos não encontrados." };
  }

  const arquivoIndex = registro.arquivos.findIndex(a => a.id === arquivoId);
  if (arquivoIndex === -1) {
    return { success: false, error: "Arquivo não encontrado no registro." };
  }

  const arquivo = registro.arquivos[arquivoIndex];

  if (arquivo.storage_bucket && arquivo.storage_path) {
    const { error: storageError } = await client.storage
      .from(arquivo.storage_bucket)
      .remove([arquivo.storage_path]);

    if (storageError) {
      console.error(`[PedidosArtesService] Erro Storage:`, storageError);
    }
  }

  const novosArquivos = [...registro.arquivos];
  novosArquivos.splice(arquivoIndex, 1);

  const { error: updateError } = await client
    .from("pedidos_artes")
    .update({ arquivos: novosArquivos })
    .eq("id", registro.id);

  if (updateError) {
    return { success: false, error: `Erro ao deletar do banco: ${updateError.message}` };
  }

  return { success: true };
}

/** Quantos pedidos e quantos modelos cada designer acumula, por `designer_uid`. */
export interface TrabalhoDoDesigner {
  pedidos: number;
  modelos: number;
}

/**
 * Contagem de trabalho por designer, para o card "Designers Ideal" da aba Artes.
 *
 * Antes de 20/08/2026 o card mostrava "Pedidos: 0" e "Modelos: 0" fixos no JSX —
 * nao havia consulta nenhuma por tras. Os dados sempre existiram:
 * `pedidos_artes.designer_uid` e quem responde pelo briefing da proposta.
 *
 * Pedidos = propostas distintas com briefing daquele designer.
 * Modelos = linhas de `pedidos_modelos` dessas propostas.
 *
 * Somente leitura. Uma consulta por tabela, agregadas em memoria: o volume e
 * pequeno (41 briefings em 20/08/2026) e assim nao depende de RPC nova.
 */
export async function contarTrabalhoPorDesigner(): Promise<Record<string, TrabalhoDoDesigner>> {
  const client = getSupabaseClient();
  if (!client) return {};

  const { data: artes, error: artesError } = await client
    .from("pedidos_artes")
    .select("id_int, designer_uid")
    .not("designer_uid", "is", null);

  if (artesError || !artes) {
    console.warn("[PedidosArtesService] Erro ao contar pedidos por designer:", artesError);
    return {};
  }

  // Propostas distintas por designer — o mesmo pedido pode ter mais de uma
  // linha de arte, e contar linha em vez de pedido inflaria o numero.
  const pedidosPorDesigner = new Map<string, Set<number>>();
  for (const linha of artes) {
    const uid = String(linha.designer_uid);
    const idInt = Number(linha.id_int);
    if (!uid || !Number.isFinite(idInt)) continue;
    if (!pedidosPorDesigner.has(uid)) pedidosPorDesigner.set(uid, new Set());
    pedidosPorDesigner.get(uid)!.add(idInt);
  }

  const todosIdInt = Array.from(new Set(artes.map((a) => Number(a.id_int)).filter(Number.isFinite)));
  const modelosPorIdInt = new Map<number, number>();
  if (todosIdInt.length > 0) {
    const { data: modelos, error: modelosError } = await client
      .from("pedidos_modelos")
      .select("id_int")
      .in("id_int", todosIdInt);
    if (modelosError) {
      console.warn("[PedidosArtesService] Erro ao contar modelos por designer:", modelosError);
    }
    for (const m of modelos ?? []) {
      const idInt = Number(m.id_int);
      modelosPorIdInt.set(idInt, (modelosPorIdInt.get(idInt) ?? 0) + 1);
    }
  }

  const resultado: Record<string, TrabalhoDoDesigner> = {};
  for (const [uid, idsDoDesigner] of pedidosPorDesigner) {
    let modelos = 0;
    for (const idInt of idsDoDesigner) modelos += modelosPorIdInt.get(idInt) ?? 0;
    resultado[uid] = { pedidos: idsDoDesigner.size, modelos };
  }
  return resultado;
}
