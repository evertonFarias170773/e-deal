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
 * Boletim de Produção. Uma proposta (id_int) pode ter vários — um por setor.
 * A identidade é o `id` da linha em pedidos_artes: é por ele que o PDF é gerado,
 * de modo que renomear um setor não quebra links já emitidos.
 */
export interface BoletimSetor {
  id: string;
  idInt: number;
  setor: string | null;
  prazo: string | null;
  hora: string | null;
  nomeEvento: string | null;
}

function mapBoletim(row: Record<string, unknown>): BoletimSetor {
  return {
    id: String(row.id),
    idInt: Number(row.id_int),
    setor: row.setor ? String(row.setor) : null,
    prazo: row.prazo ? String(row.prazo).slice(0, 10) : null,
    hora: row.hora ? String(row.hora).slice(0, 5) : null,
    nomeEvento: row.nome_evento ? String(row.nome_evento) : null
  };
}

const BOLETIM_SELECT = "id, id_int, setor, prazo, hora, nome_evento, created_at";

/** Lista os boletins da proposta, um por setor. Legados (setor nulo) vêm no fim. */
export async function listarBoletinsDaProposta(idInt: number): Promise<BoletimSetor[]> {
  const client = getSupabaseClient();
  if (!client) return [];

  const { data, error } = await client
    .from("pedidos_artes")
    .select(BOLETIM_SELECT)
    .eq("id_int", idInt)
    .order("created_at", { ascending: true });

  if (error || !data) {
    if (error) console.error(`[PedidosArtesService] Erro ao listar boletins:`, error);
    return [];
  }

  return data
    .map(mapBoletim)
    .sort((a, b) => (a.setor || "￿").localeCompare(b.setor || "￿", "pt-BR"));
}

/** Carrega um boletim pelo seu id. */
export async function carregarBoletimPorId(idBoletim: string): Promise<BoletimSetor | null> {
  const client = getSupabaseClient();
  if (!client) return null;

  const { data, error } = await client
    .from("pedidos_artes")
    .select(BOLETIM_SELECT)
    .eq("id", idBoletim)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error(`[PedidosArtesService] Erro ao carregar boletim:`, error);
    return null;
  }
  return mapBoletim(data);
}

export interface SalvarBoletimInput {
  /** Boletim existente. Ausente = criar um novo para o setor informado. */
  id?: string | null;
  idInt: number;
  setor: string | null;
  prazo: string | null;
  hora: string | null;
}

export type SalvarBoletimResult =
  | { success: true; boletim: BoletimSetor }
  | { success: false; error: string };

/**
 * Cria ou atualiza um boletim de setor.
 *
 * Nunca toca em `status` de linhas existentes — o fluxo de artes é preservado.
 * Ao criar, `status: "APROVADO"` mantém o resultado da liberação para produção
 * idêntico ao cenário "proposta sem artes cadastradas" (a validação de liberação
 * exige que toda arte esteja APROVADO, e zero linhas já passava).
 * A unicidade (id_int, setor) é garantida por índice único parcial no banco.
 */
export async function salvarBoletimSetor(input: SalvarBoletimInput): Promise<SalvarBoletimResult> {
  const client = getSupabaseClient();
  if (!client) return { success: false, error: "Conexão com o banco de dados não disponível." };

  const payload = {
    setor: input.setor?.trim() ? input.setor.trim() : null,
    prazo: input.prazo?.trim() ? input.prazo.trim() : null,
    hora: input.hora?.trim() ? input.hora.trim() : null
  };

  if (input.id) {
    const { data, error } = await client
      .from("pedidos_artes")
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq("id", input.id)
      .select(BOLETIM_SELECT)
      .maybeSingle();

    if (error) {
      console.error(`[PedidosArtesService] Erro ao atualizar boletim:`, error);
      return { success: false, error: traduzirErroBoletim(error) };
    }
    if (!data) return { success: false, error: "Boletim não encontrado para atualização." };
    return { success: true, boletim: mapBoletim(data) };
  }

  const { data, error } = await client
    .from("pedidos_artes")
    .insert({ id_int: input.idInt, ...payload, status: "APROVADO" })
    .select(BOLETIM_SELECT)
    .maybeSingle();

  if (error) {
    console.error(`[PedidosArtesService] Erro ao criar boletim:`, error);
    return { success: false, error: traduzirErroBoletim(error) };
  }
  if (!data) return { success: false, error: "O banco não retornou o boletim criado." };
  return { success: true, boletim: mapBoletim(data) };
}

function traduzirErroBoletim(error: { code?: string; message?: string }): string {
  if (error.code === "23505") {
    return "Já existe um boletim deste setor para esta proposta.";
  }
  return error.message || "Falha ao gravar o boletim.";
}

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
