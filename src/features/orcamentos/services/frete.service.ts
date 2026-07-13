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
  vol: number;
  cep: string;
  id_int?: number | string;
}): Promise<PropostaFrete[]> {
  const cleanCep = input.cep.replace(/\D/g, "");
  
  let finalPeso = input.peso;
  let finalVol = input.vol;
  
  if (input.peso > 25000) {
    finalPeso = Math.round(input.peso / 2);
    finalVol = 2;
  }

  const payload = {
    peso: String(finalPeso),
    cep: cleanCep,
    vol: Number(finalVol)
  };

  const response = await fetch("https://10074.hostoo.net.br/webhook/sedex_vibe", {
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

  const data = await response.json();
  let arrayData: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    arrayData = data;
  } else if (data && typeof data === "object") {
    arrayData = [data as Record<string, unknown>];
  } else {
    throw new Error("Resposta inválida do serviço de frete.");
  }

  return arrayData.map((item: Record<string, unknown>, idx: number) => {
    const prazo = item.prazo as number | undefined;
    const servico = item.servico as string | undefined;
    const valor = item.valor as number | undefined;
    const texto_entrega = item.texto_entrega as string | undefined;

    const prazoText = prazo 
      ? (prazo === 1 ? "1 dia útil" : `${prazo} dias úteis`)
      : "Sob consulta";
      
    return {
      id: `frete_${String(servico || "sedex").toLowerCase()}_${idx}`,
      id_int: typeof input.id_int === "number" ? input.id_int : (Number(input.id_int) || 0),
      transportadora: servico === "SEDEX" ? "Correios SEDEX" : servico === "PAC" ? "Correios PAC" : (servico || "Correios"),
      servico: servico || "SEDEX",
      valor: Number(valor || 0),
      prazo: prazoText,
      observacao: texto_entrega || "",
      escolhido: false,
      pesoUsado: input.peso,
      volumes: finalVol
    };
  });
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

/**
 * Request Azul Cargo freight quote from the webhook.
 * Webhook expects: { CEPDestino: string, ValorTotal: number, SiglaServico: string, Itens: [...] }
 */
export async function solicitarCotacaoAzulCargo(input: {
  peso: number;
  cep: string;
  valorTotal: number;
  id_int?: number | string;
}): Promise<PropostaFrete[]> {
  const cleanCep = input.cep.replace(/\D/g, "");
  const pesoKg = input.peso / 1000;
  const volumes = Math.max(1, Math.ceil(input.peso / 14500));

  const payload = {
    CEPDestino: cleanCep,
    ValorTotal: Number(input.valorTotal || 0),
    SiglaServico: "ECOMM",
    TaxaColeta: "false",
    TipoEntrega: "AEROPORTO",
    BaseOrigem: "Qns02",
    BaseDestino: "",
    Coleta: "false",
    Itens: [
      {
        Volume: volumes,
        Peso: pesoKg,
        Altura: 36,
        Comprimento: 32,
        Largura: 23
      }
    ]
  };

  const response = await fetch("https://10074.hostoo.net.br/webhook/cotacao-azul", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro na cotação Azul Cargo (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  let arrayData: Record<string, unknown>[] = [];
  if (Array.isArray(data)) {
    arrayData = data;
  } else if (data && typeof data === "object") {
    arrayData = [data as Record<string, unknown>];
  } else {
    throw new Error("Resposta inválida da cotação Azul Cargo.");
  }

  return arrayData.map((item: Record<string, unknown>, idx: number) => {
    const prazo = item.Prazo as number | undefined;
    const total = Number(item.Total || 0);
    const servico = (item.Servico as string) || "ECOMM";

    // Apply margin 1.15
    const valorFinal = total * 1.15;

    const prazoText = prazo 
      ? (prazo === 1 ? "1 dia útil" : `${prazo} dias úteis`)
      : "Sob consulta";

    const idCotacao = item.ID_Cotacao !== undefined ? Number(item.ID_Cotacao) : undefined;

    return {
      id: `frete_azul_${String(servico).toLowerCase()}_${idx}`,
      id_int: typeof input.id_int === "number" ? input.id_int : (Number(input.id_int) || 0),
      transportadora: "Azul Cargo",
      servico: servico,
      valor: valorFinal, // usar SEMPRE o valor final já com margem da Azul.
      prazo: prazoText,
      observacao: `Volumes: ${volumes} | Peso: ${pesoKg.toFixed(2)} KG | Valor original: ${total.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      escolhido: false,
      pesoUsado: input.peso,
      valorOriginal: total,
      valorMargem: valorFinal,
      volumes: volumes,
      pesoKg: pesoKg,
      id_cotacao: idCotacao
    };
  });
}

/**
 * Normalizes city names for the RPC payload (UPPERCASE, no accents).
 */
export function normalizeCityName(value: string): string {
  return value
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Request shipping carrier freight quotes from Supabase RPC.
 */
export async function solicitarCotacaoTransportadoras(input: {
  peso: number;
  cidade: string;
  uf: string;
  id_int?: number | string;
}): Promise<PropostaFrete[]> {
  const normalizedCidade = normalizeCityName(input.cidade);
  const normalizedUf = input.uf.toUpperCase().trim();
  const pesoKg = input.peso / 1000;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Configurações do Supabase ausentes no ambiente.");
  }

  const payload = {
    p_cidade: normalizedCidade,
    p_peso: pesoKg,
    p_uf: normalizedUf
  };

  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/calcular_frete_transportadora`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro na cotação de transportadoras (${response.status}): ${errorText || response.statusText}`);
  }

  const data = await response.json();
  
  // Resposta esperada: [{ sm: number, un: number, mb: number }]
  let row: Record<string, number> = {};
  if (Array.isArray(data) && data.length > 0) {
    row = data[0];
  } else if (data && typeof data === "object" && !Array.isArray(data)) {
    row = data as Record<string, number>;
  } else {
    throw new Error("Resposta inválida da cotação de transportadoras.");
  }

  const results: PropostaFrete[] = [];
  const idIntNum = typeof input.id_int === "number" ? input.id_int : (Number(input.id_int) || 0);

  // sm = Transportadora São Miguel
  if (row.sm !== undefined && row.sm > 0) {
    results.push({
      id: `frete_transp_sm_${Date.now()}`,
      id_int: idIntNum,
      transportadora: "Transportadora São Miguel",
      servico: "SÃO MIGUEL",
      valor: Number(row.sm),
      prazo: "Sob consulta",
      observacao: "Cotação via transportadora",
      escolhido: false,
      pesoUsado: input.peso
    });
  }

  // un = Transportadora Unesul
  if (row.un !== undefined && row.un > 0) {
    results.push({
      id: `frete_transp_un_${Date.now()}`,
      id_int: idIntNum,
      transportadora: "Transportadora Unesul",
      servico: "UNESUL",
      valor: Number(row.un),
      prazo: "Sob consulta",
      observacao: "Cotação via transportadora",
      escolhido: false,
      pesoUsado: input.peso
    });
  }

  // mb = Motoboy
  if (row.mb !== undefined && row.mb > 0) {
    results.push({
      id: `frete_transp_mb_${Date.now()}`,
      id_int: idIntNum,
      transportadora: "Motoboy",
      servico: "MOTOBOY",
      valor: Number(row.mb),
      prazo: "Sob consulta",
      observacao: "Entrega expressa local",
      escolhido: false,
      pesoUsado: input.peso
    });
  }

  return results;
}

/**
 * Request VEPPO freight quote from the webhook.
 * Webhook expects: { text: string, cidade: string, valor: number, peso: number }
 */
export async function solicitarCotacaoVeppo(input: {
  peso: number;
  valor: number;
  cidade: string;
  uf: string;
  id_int?: number | string;
}): Promise<PropostaFrete[]> {
  const normalizedUf = input.uf?.trim().toUpperCase();
  const normalizedCidade = normalizeCityName(input.cidade || "");

  // Regra VEPPO: somente para RS e diferente de Porto Alegre
  if (normalizedUf !== "RS" || normalizedCidade === "PORTO ALEGRE") {
    return [];
  }

  const payload = {
    text: `${input.cidade}, ${normalizedUf}, Brasil`,
    cidade: input.cidade,
    valor: input.valor,
    peso: input.peso
  };

  try {
    const response = await fetch("https://10074.hostoo.net.br/webhook/coordenadas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.warn(`[FreteService] VEPPO retornou erro ${response.status}`);
      return [];
    }

    const data = await response.json();
    if (!data || typeof data.valor_frete !== "number") {
      return [];
    }

    const valorFrete = Number(data.valor_frete);
    const idIntNum = typeof input.id_int === "number" ? input.id_int : (Number(input.id_int) || 0);

    return [{
      id: `frete_veppo_${Date.now()}`,
      id_int: idIntNum,
      transportadora: "VEPPO",
      servico: "VEPPO",
      valor: valorFrete,
      prazo: "Sob consulta",
      observacao: "Cotação via VEPPO",
      escolhido: false,
      pesoUsado: input.peso
    }];
  } catch (error) {
    console.warn(`[FreteService] Erro ao consultar VEPPO:`, error);
    return [];
  }
}
