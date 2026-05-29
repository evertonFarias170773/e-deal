import { getSupabaseClient } from "@/lib/supabase/client";
import type { VariacaoGlobal, TipoVariacao, ProdutoVariacaoDetalhada } from "@/features/produtos/types";

export type ServiceResult<T> = {
  success: boolean;
  message: string;
  data?: T;
  status?: string | number;
  blocked?: boolean;
};

// --- Interfaces de Banco de Dados ---
interface DBVariacaoRow {
  id_variacao: number;
  nome: string | null;
  descricao: string | null;
  is_ativo: boolean | null;
  tipos_variacoes: { id: number; is_ativo: boolean | null }[] | null;
}

interface DBTipoVariacaoRow {
  id: number;
  id_variacao: number;
  variacao: string | null;
  v_extra: number | null;
  peso: number | null;
  ref: string | null;
  is_ativo: boolean | null;
}

interface DBProdutoVariacaoRow {
  id: number;
  id_variacao: number;
  is_obrigatorio: boolean | null;
  is_multiplo: boolean | null;
}

// --- Funções Auxiliares ---
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

function parseNumber(val: unknown): number {
  if (val === null || val === undefined || val === "") return 0;
  const num = Number(val);
  return Number.isNaN(num) ? 0 : num;
}

// ==========================================
// 1. CAMADA: Variações Globais (public.variacoes)
// ==========================================

export interface VariacaoGlobalJoin extends VariacaoGlobal {
  opcoesCount: number;
}

export async function listVariacoesGlobais(): Promise<VariacaoGlobalJoin[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.error("[ProdutoVariacoesService][listVariacoesGlobais] Supabase client unavailable.");
    return [];
  }

  const { data, error } = await client
    .from("variacoes")
    .select(`
      id_variacao,
      nome,
      descricao,
      is_ativo,
      tipos_variacoes (
        id,
        is_ativo
      )
    `)
    .order("nome", { ascending: true });

  if (error) {
    console.error("[ProdutoVariacoesService][listVariacoesGlobais] Failed:", error);
    return [];
  }

  const rows = (data ?? []) as unknown as DBVariacaoRow[];

  return rows.map((row) => {
    const opcoes = row.tipos_variacoes || [];
    const activeOpcoes = opcoes.filter((o) => o.is_ativo !== false);
    return {
      id_variacao: Number(row.id_variacao),
      nome: row.nome || "",
      descricao: row.descricao || "",
      is_ativo: Boolean(row.is_ativo),
      opcoesCount: activeOpcoes.length
    };
  });
}

export async function getVariacaoGlobalById(id_variacao: number): Promise<VariacaoGlobal & { tipos: TipoVariacao[] } | null> {
  const client = getSupabaseClient();
  if (!client || !Number.isFinite(id_variacao)) {
    return null;
  }

  const { data, error } = await client
    .from("variacoes")
    .select(`
      id_variacao,
      nome,
      descricao,
      is_ativo,
      tipos_variacoes (
        id,
        id_variacao,
        variacao,
        v_extra,
        peso,
        ref,
        is_ativo
      )
    `)
    .eq("id_variacao", id_variacao)
    .single();

  if (error) {
    console.error("[ProdutoVariacoesService][getVariacaoGlobalById] Failed:", error);
    return null;
  }

  if (!data) return null;

  const rawTipos = (data.tipos_variacoes || []) as unknown as DBTipoVariacaoRow[];
  // Ordenação manual de tipos_variacoes deixada preparada no código
  // No futuro, se houver uma coluna 'ordem', ordenar por ela: rawTipos.sort((a, b) => a.ordem - b.ordem)
  const tipos: TipoVariacao[] = rawTipos.map((t) => ({
    id: String(t.id),
    id_variacao: Number(t.id_variacao),
    variacao: t.variacao || "",
    v_extra: Number(t.v_extra ?? 0),
    peso: Number(t.peso ?? 0), // Peso tratado como gramas
    ref: t.ref || "",
    is_ativo: Boolean(t.is_ativo)
  }));

  return {
    id_variacao: Number(data.id_variacao),
    nome: data.nome || "",
    descricao: data.descricao || "",
    is_ativo: Boolean(data.is_ativo),
    tipos
  };
}

export async function createVariacaoGlobal(input: { nome: string; descricao: string; is_ativo: boolean }): Promise<ServiceResult<VariacaoGlobal>> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Cliente Supabase indisponível." };
  }

  const nome = normalizeName(input.nome);
  if (!nome) {
    return { success: false, message: "O nome da variação é obrigatório." };
  }

  // Whitelist para persistência
  const payload = {
    nome,
    descricao: input.descricao?.trim() || "",
    is_ativo: Boolean(input.is_ativo)
  };

  const { data, error } = await client
    .from("variacoes")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return {
      success: false,
      message: error.message || "Erro ao criar variação global.",
      status: error.code
    };
  }

  return {
    success: true,
    message: "Variação global criada com sucesso.",
    data: {
      id_variacao: Number(data.id_variacao),
      nome: data.nome,
      descricao: data.descricao,
      is_ativo: Boolean(data.is_ativo)
    }
  };
}

export async function updateVariacaoGlobal(
  id_variacao: number,
  input: { nome: string; descricao: string; is_ativo: boolean }
): Promise<ServiceResult<VariacaoGlobal>> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(id_variacao)) {
    return { success: false, message: "Cliente Supabase indisponível ou ID inválido." };
  }

  const nome = normalizeName(input.nome);
  if (!nome) {
    return { success: false, message: "O nome da variação é obrigatório." };
  }

  // Whitelist para persistência
  const payload = {
    nome,
    descricao: input.descricao?.trim() || "",
    is_ativo: Boolean(input.is_ativo)
  };

  const { data, error } = await client
    .from("variacoes")
    .update(payload)
    .eq("id_variacao", id_variacao)
    .select("*")
    .single();

  if (error) {
    return {
      success: false,
      message: error.message || "Erro ao atualizar variação global.",
      status: error.code
    };
  }

  return {
    success: true,
    message: "Variação global atualizada com sucesso.",
    data: {
      id_variacao: Number(data.id_variacao),
      nome: data.nome,
      descricao: data.descricao,
      is_ativo: Boolean(data.is_ativo)
    }
  };
}

export async function checkVariacaoGlobalVinculos(id_variacao: number): Promise<boolean> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(id_variacao)) {
    return false;
  }

  const { count, error } = await client
    .from("produto_variacoes")
    .select("*", { count: "exact", head: true })
    .eq("id_variacao", id_variacao);

  if (error) {
    console.error("[ProdutoVariacoesService][checkVinculos] Failed:", error);
    return false;
  }

  return (count ?? 0) > 0;
}

export async function inativarVariacaoGlobal(id_variacao: number): Promise<ServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(id_variacao)) {
    return { success: false, message: "Cliente Supabase indisponível ou ID inválido." };
  }

  // Whitelist de desativação lógica
  const payload = {
    is_ativo: false
  };

  const { error } = await client
    .from("variacoes")
    .update(payload)
    .eq("id_variacao", id_variacao);

  if (error) {
    return {
      success: false,
      message: error.message || "Erro ao inativar variação global.",
      status: error.code
    };
  }

  return {
    success: true,
    message: "Variação global inativada com sucesso."
  };
}

// ==========================================
// 2. CAMADA: Opções Globais (public.tipos_variacoes)
// ==========================================

export async function listTiposVariacoes(id_variacao: number): Promise<TipoVariacao[]> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(id_variacao)) {
    return [];
  }

  const { data, error } = await client
    .from("tipos_variacoes")
    .select("*")
    .eq("id_variacao", id_variacao)
    .order("id", { ascending: true });

  if (error) {
    console.error("[ProdutoVariacoesService][listTiposVariacoes] Failed:", error);
    return [];
  }

  const rows = (data ?? []) as unknown as DBTipoVariacaoRow[];
  return rows.map((t) => ({
    id: String(t.id),
    id_variacao: Number(t.id_variacao),
    variacao: t.variacao || "",
    v_extra: Number(t.v_extra ?? 0),
    peso: Number(t.peso ?? 0), // Gramas
    ref: t.ref || "",
    is_ativo: Boolean(t.is_ativo)
  }));
}

export async function createTipoVariacao(input: {
  id_variacao: number;
  variacao: string;
  v_extra: unknown;
  ref: string;
  peso: unknown;
  is_ativo: boolean;
}): Promise<ServiceResult<TipoVariacao>> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Cliente Supabase indisponível." };
  }

  const variacao = normalizeName(input.variacao);
  if (!variacao) {
    return { success: false, message: "O nome da opção é obrigatório." };
  }

  if (!Number.isInteger(input.id_variacao)) {
    return { success: false, message: "Grupo de variação inválido." };
  }

  // Tratamento do peso (gramas) e v_extra (preço extra)
  const peso = parseNumber(input.peso);
  const v_extra = parseNumber(input.v_extra);

  // Whitelist de inserção
  const payload = {
    id_variacao: input.id_variacao,
    variacao,
    v_extra,
    ref: input.ref?.trim() || "",
    peso,
    is_ativo: Boolean(input.is_ativo)
  };

  const { data, error } = await client
    .from("tipos_variacoes")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    return {
      success: false,
      message: error.message || "Erro ao criar opção de variação.",
      status: error.code
    };
  }

  return {
    success: true,
    message: "Opção criada com sucesso.",
    data: {
      id: String(data.id),
      id_variacao: Number(data.id_variacao),
      variacao: data.variacao,
      v_extra: Number(data.v_extra ?? 0),
      peso: Number(data.peso ?? 0),
      ref: data.ref || "",
      is_ativo: Boolean(data.is_ativo)
    }
  };
}

export async function updateTipoVariacao(
  id: string | number,
  input: {
    variacao: string;
    v_extra: unknown;
    ref: string;
    peso: unknown;
    is_ativo: boolean;
  }
): Promise<ServiceResult<TipoVariacao>> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Cliente Supabase indisponível." };
  }

  const variacao = normalizeName(input.variacao);
  if (!variacao) {
    return { success: false, message: "O nome da opção é obrigatório." };
  }

  const peso = parseNumber(input.peso);
  const v_extra = parseNumber(input.v_extra);

  // Whitelist de atualização
  const payload = {
    variacao,
    v_extra,
    ref: input.ref?.trim() || "",
    peso,
    is_ativo: Boolean(input.is_ativo)
  };

  // Aceita número ou string para o ID da opção
  const parsedId = typeof id === "string" && !Number.isNaN(Number(id)) ? Number(id) : id;

  const { data, error } = await client
    .from("tipos_variacoes")
    .update(payload)
    .eq("id", parsedId)
    .select("*")
    .single();

  if (error) {
    return {
      success: false,
      message: error.message || "Erro ao atualizar opção de variação.",
      status: error.code
    };
  }

  return {
    success: true,
    message: "Opção atualizada com sucesso.",
    data: {
      id: String(data.id),
      id_variacao: Number(data.id_variacao),
      variacao: data.variacao,
      v_extra: Number(data.v_extra ?? 0),
      peso: Number(data.peso ?? 0),
      ref: data.ref || "",
      is_ativo: Boolean(data.is_ativo)
    }
  };
}

export async function inativarTipoVariacao(id: string | number): Promise<ServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Cliente Supabase indisponível." };
  }

  // Whitelist de desativação lógica
  const payload = {
    is_ativo: false
  };

  const parsedId = typeof id === "string" && !Number.isNaN(Number(id)) ? Number(id) : id;

  const { error } = await client
    .from("tipos_variacoes")
    .update(payload)
    .eq("id", parsedId);

  if (error) {
    return {
      success: false,
      message: error.message || "Erro ao inativar opção de variação.",
      status: error.code
    };
  }

  return {
    success: true,
    message: "Opção de variação inativada com sucesso."
  };
}

// ==========================================
// 3. CAMADA: Vínculos de Produtos (public.produto_variacoes)
// ==========================================

export async function listProdutoVariacaoVinculos(id_produto: number): Promise<ProdutoVariacaoDetalhada[]> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(id_produto)) {
    return [];
  }

  const { data, error } = await client
    .from("produto_variacoes")
    .select(`
      id,
      id_produto,
      id_variacao,
      nome,
      is_obrigatorio,
      is_multiplo,
      variacoes (
        id_variacao,
        nome,
        descricao,
        is_ativo,
        tipos_variacoes (
          id,
          id_variacao,
          variacao,
          v_extra,
          peso,
          ref,
          is_active: is_ativo
        )
      )
    `)
    .eq("id_produto", id_produto);

  if (error) {
    console.error("[ProdutoVariacoesService][listProdutoVariacaoVinculos] Failed:", error);
    return [];
  }

  const results: ProdutoVariacaoDetalhada[] = [];

  for (const row of (data ?? [])) {
    const rawVarRaw = row.variacoes;
    if (!rawVarRaw) continue;

    const rawVar = (Array.isArray(rawVarRaw) ? rawVarRaw[0] : rawVarRaw) as Record<string, unknown>;
    if (!rawVar) continue;

    const groupActive = Boolean(rawVar.is_ativo);
    const rawTipos = rawVar.tipos_variacoes || [];
    const tipos: TipoVariacao[] = (Array.isArray(rawTipos) ? rawTipos : [rawTipos])
      .filter((t: unknown) => {
        const item = t as Record<string, unknown>;
        return item.is_active !== false;
      })
      .map((t: unknown) => {
        const item = t as Record<string, unknown>;
        return {
          id: String(item.id ?? ""),
          id_variacao: Number(item.id_variacao ?? 0),
          variacao: String(item.variacao ?? ""),
          v_extra: Number(item.v_extra ?? 0),
          peso: Number(item.peso ?? 0),
          ref: String(item.ref ?? ""),
          is_ativo: Boolean(item.is_active ?? true)
        };
      });

    results.push({
      id: `pv_${row.id}`,
      id_produto: Number(row.id_produto),
      id_variacao: Number(row.id_variacao),
      is_obrigatorio: Boolean(row.is_obrigatorio),
      is_multiplo: Boolean(row.is_multiplo),
      variacao: {
        id_variacao: Number(rawVar.id_variacao ?? 0),
        nome: String(row.nome || rawVar.nome || ""),
        descricao: String(rawVar.descricao ?? ""),
        is_ativo: groupActive
      },
      tipos
    });
  }

  return results;
}

export async function saveProdutoVariacoes(
  id_produto: number,
  vinculos: {
    id_variacao: number;
    is_obrigatorio: boolean;
    is_multiplo: boolean;
  }[]
): Promise<ServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client || !Number.isInteger(id_produto)) {
    return { success: false, message: "Cliente Supabase indisponível ou ID de produto inválido." };
  }

  try {
    // 1. Buscar vínculos atuais no banco
    const { data: dbVinculos, error: selectErr } = await client
      .from("produto_variacoes")
      .select("id, id_variacao, is_obrigatorio, is_multiplo")
      .eq("id_produto", id_produto);

    if (selectErr) {
      return { success: false, message: "Erro ao consultar vínculos de variações atuais: " + selectErr.message };
    }

    const currentMap = new Map<number, { id: number; is_obrigatorio: boolean; is_multiplo: boolean }>();
    const rows = (dbVinculos ?? []) as unknown as DBProdutoVariacaoRow[];
    rows.forEach((row) => {
      currentMap.set(Number(row.id_variacao), {
        id: Number(row.id),
        is_obrigatorio: Boolean(row.is_obrigatorio),
        is_multiplo: Boolean(row.is_multiplo)
      });
    });

    const targetMap = new Map<number, { is_obrigatorio: boolean; is_multiplo: boolean }>();
    vinculos.forEach((item) => {
      targetMap.set(Number(item.id_variacao), {
        is_obrigatorio: Boolean(item.is_obrigatorio),
        is_multiplo: Boolean(item.is_multiplo)
      });
    });

    const inserts: {
      id_produto: number;
      id_variacao: number;
      nome: string;
      is_obrigatorio: boolean;
      is_multiplo: boolean;
    }[] = [];
    const updates: { id: number; is_obrigatorio: boolean; is_multiplo: boolean }[] = [];
    const deletes: number[] = [];

    // 2. Identificar exclusões (estão no banco mas não na lista enviada)
    currentMap.forEach((val, idVar) => {
      if (!targetMap.has(idVar)) {
        deletes.push(val.id);
      }
    });

    // 3. Identificar inserções e atualizações
    for (const [idVar, targetVal] of targetMap.entries()) {
      const current = currentMap.get(idVar);
      if (!current) {
        // Novo vínculo: precisamos buscar o nome da variação global para copiar
        const { data: varObj, error: varErr } = await client
          .from("variacoes")
          .select("nome")
          .eq("id_variacao", idVar)
          .single();

        if (varErr || !varObj) {
          return { success: false, message: `Erro ao buscar nome da variação global ID ${idVar}: ${varErr?.message || "não encontrada"}` };
        }

        inserts.push({
          id_produto,
          id_variacao: idVar,
          nome: varObj.nome || `Variação ${idVar}`,
          is_obrigatorio: targetVal.is_obrigatorio,
          is_multiplo: targetVal.is_multiplo
        });
      } else {
        // Vínculo existente: verificar se as flags mudaram
        if (current.is_obrigatorio !== targetVal.is_obrigatorio || current.is_multiplo !== targetVal.is_multiplo) {
          updates.push({
            id: current.id,
            is_obrigatorio: targetVal.is_obrigatorio,
            is_multiplo: targetVal.is_multiplo
          });
        }
      }
    }

    // 4. Executar DELETEs (Remoção física de relacionamento permitida em tabela N-N)
    if (deletes.length > 0) {
      const { error: delErr } = await client
        .from("produto_variacoes")
        .delete()
        .in("id", deletes);

      if (delErr) {
        return { success: false, message: "Falha ao desvincular variações antigas: " + delErr.message };
      }
    }

    // 5. Executar UPDATEs (Individualmente ou em lote se as políticas permitirem)
    for (const item of updates) {
      const { error: updErr } = await client
        .from("produto_variacoes")
        .update({
          is_obrigatorio: item.is_obrigatorio,
          is_multiplo: item.is_multiplo
        })
        .eq("id", item.id);

      if (updErr) {
        return { success: false, message: "Falha ao atualizar parâmetros de vínculo: " + updErr.message };
      }
    }

    // 6. Executar INSERTs (Utilizando whitelist rígida)
    if (inserts.length > 0) {
      const { error: insErr } = await client
        .from("produto_variacoes")
        .insert(inserts);

      if (insErr) {
        return { success: false, message: "Falha ao vincular novas variações: " + insErr.message };
      }
    }

    return {
      success: true,
      message: "Vínculos de variações sincronizados com sucesso."
    };
  } catch (error) {
    console.error("[ProdutoVariacoesService][saveProdutoVariacoes] Unexpected:", error);
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    return { success: false, message: "Ocorreu um erro inesperado ao salvar vínculos: " + errorMsg };
  }
}

interface LegacyProdutoVariacaoRow {
  id: number;
  id_produto: number;
  id_variacao: number;
  nome: string | null;
  is_obrigatorio: boolean | null;
  is_multiplo: boolean | null;
  produtos: { nomeReal: string } | null;
}

// Mantendo suporte temporário a assinaturas antigas se necessário
export async function listProdutoVariacoes(): Promise<unknown[]> {
  console.warn("listProdutoVariacoes sem parâmetros está obsoleta. Use listVariacoesGlobais ou listProdutoVariacaoVinculos.");
  const client = getSupabaseClient();
  if (!client) return [];
  const { data } = await client.from("produto_variacoes").select("*, produtos(nomeReal)");
  const rows = (data ?? []) as unknown as LegacyProdutoVariacaoRow[];
  return rows.map((r) => ({
    id: Number(r.id),
    id_produto: Number(r.id_produto),
    id_variacao: Number(r.id_variacao),
    nome: r.nome || "",
    is_obrigatorio: Boolean(r.is_obrigatorio),
    is_multiplo: Boolean(r.is_multiplo),
    produtos: r.produtos ? { nomeReal: String(r.produtos.nomeReal) } : null
  }));
}

export async function getProdutoVariacaoById(id: number): Promise<unknown> {
  console.warn("getProdutoVariacaoById está obsoleta. Use getVariacaoGlobalById.");
  const client = getSupabaseClient();
  if (!client) return null;
  const { data } = await client.from("produto_variacoes").select("*, produtos(nomeReal)").eq("id", id).single();
  if (!data) return null;
  const r = data as unknown as LegacyProdutoVariacaoRow;
  return {
    id: Number(r.id),
    id_produto: Number(r.id_produto),
    id_variacao: Number(r.id_variacao),
    nome: r.nome || "",
    is_obrigatorio: Boolean(r.is_obrigatorio),
    is_multiplo: Boolean(r.is_multiplo),
    produtos: r.produtos ? { nomeReal: String(r.produtos.nomeReal) } : null
  };
}

export async function deleteProdutoVariacao(id: number): Promise<ServiceResult<null>> {
  const client = getSupabaseClient();
  if (!client) {
    return { success: false, message: "Cliente Supabase indisponível." };
  }
  const { error } = await client.from("produto_variacoes").delete().eq("id", id);
  if (error) {
    return { success: false, message: "Erro ao desvincular variação: " + error.message };
  }
  return { success: true, message: "Variação desvinculada com sucesso." };
}
