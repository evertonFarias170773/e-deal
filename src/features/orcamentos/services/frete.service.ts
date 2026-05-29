import { getSupabaseClient } from "@/lib/supabase/client";
import type { PropostaFrete } from "@/features/orcamentos/types";

/**
 * Maps a single row from public.cotacao_frete to PropostaFrete type.
 */
export function mapCotacaoRowToPropostaFrete(row: {
  id: number | string;
  id_int: number | string;
  servico?: string | null;
  valor?: number | string | null;
  prazo?: string | null;
  funcionamento_loja?: string | null;
  escolhido?: boolean | null;
  peso?: number | null;
}): PropostaFrete {
  return {
    id: String(row.id),
    id_int: Number(row.id_int),
    transportadora: row.servico === "SEDEX" ? "Correios SEDEX" : row.servico === "PAC" ? "Correios PAC" : row.servico || "Transportadora",
    servico: row.servico || "",
    valor: Number(row.valor || 0),
    prazo: row.prazo || "Sob consulta",
    observacao: row.funcionamento_loja || "",
    escolhido: Boolean(row.escolhido),
    pesoUsado: Number(row.peso || 0)
  };
}

/**
 * Request SEDEX freight quote from the webhook.
 * Webhook expects: { peso: string, id_int: string, vol: number, cep: string }
 * Note: Weight (peso) is sent in grams as per ERP rules.
 */
export async function solicitarCotacaoSedex(input: {
  peso: number;
  id_int: number;
  vol: number;
  cep: string;
}): Promise<void> {
  const cleanCep = input.cep.replace(/\D/g, "");
  
  const payload = {
    // Peso total enviado em gramas (unidade padrão do ERP)
    peso: String(input.peso),
    id_int: String(input.id_int),
    vol: Number(input.vol),
    cep: cleanCep
  };

  const response = await fetch("https://10074.hostoo.net.br/webhook/SEDEX", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro na cotação SEDEX (${response.status}): ${errorText || response.statusText}`);
  }
}

/**
 * Lists all freight quotes in public.cotacao_frete for the given id_int.
 */
export async function listarCotacoesFrete(id_int: number): Promise<PropostaFrete[]> {
  const client = getSupabaseClient();
  if (!client) {
    console.warn("[FreteService] Supabase client não inicializado.");
    return [];
  }

  const { data, error } = await client
    .from("cotacao_frete")
    .select("*")
    .eq("id_int", id_int)
    .order("id", { ascending: true });

  if (error) {
    console.error(`[FreteService] Erro ao buscar cotações de frete para #${id_int}:`, error);
    throw error;
  }

  return (data || []).map(mapCotacaoRowToPropostaFrete);
}

/**
 * Updates public.cotacao_frete to set chosen option to true and others to false.
 */
export async function escolherCotacaoFrete(id_int: number, id: number): Promise<void> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não inicializado.");
  }

  // 1. Mark all other options for this proposal (id_int) as chosen = false
  const { error: clearError } = await client
    .from("cotacao_frete")
    .update({ escolhido: false })
    .eq("id_int", id_int);

  if (clearError) {
    console.error(`[FreteService] Erro ao limpar escolhas para #${id_int}:`, clearError);
    throw clearError;
  }

  // 2. Mark the selected option as chosen = true
  const { error: chooseError } = await client
    .from("cotacao_frete")
    .update({ escolhido: true })
    .eq("id", id)
    .eq("id_int", id_int);

  if (chooseError) {
    console.error(`[FreteService] Erro ao salvar escolha de frete #${id} para #${id_int}:`, chooseError);
    throw chooseError;
  }
}

/**
 * Inserts a manual freight quote option into public.cotacao_frete.
 */
export async function adicionarCotacaoManual(input: {
  id_int: number;
  servico: string;
  prazo: string;
  valor: number;
  escolhido: boolean;
  cep?: string;
  peso?: number;
}): Promise<PropostaFrete> {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error("Cliente Supabase não inicializado.");
  }

  const { data, error } = await client
    .from("cotacao_frete")
    .insert({
      id_int: input.id_int,
      servico: input.servico,
      prazo: input.prazo,
      valor: input.valor,
      escolhido: input.escolhido,
      cep: input.cep || null,
      peso: input.peso || null
    })
    .select()
    .single();

  if (error) {
    console.error(`[FreteService] Erro ao inserir cotação manual:`, error);
    throw error;
  }

  return mapCotacaoRowToPropostaFrete(data);
}
