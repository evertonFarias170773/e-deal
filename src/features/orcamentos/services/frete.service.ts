import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase/client";
import { tokenDaSessao } from "@/lib/supabase/bearer";
import type { PropostaFrete } from "@/features/orcamentos/types";
import { fetchComSessao } from "@/lib/supabase/sessao";
import { regraAtualPermiteVeppo } from "@/features/orcamentos/lib/cidade-veppo";
import { lerCorpoCotacaoAzul, mapearCotacoesAzul } from "@/features/orcamentos/lib/cotacao-azul";

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
  origem?: string | null;
}): PropostaFrete {
  // Origem (21/10/2026): so os dois valores do CHECK contam; o resto e linha antiga.
  const origem = row.origem === "COTACAO" || row.origem === "MANUAL" ? row.origem : null;
  return {
    id: String(row.id),
    id_int: Number(row.id_int),
    transportadora: row.servico === "SEDEX" ? "Correios SEDEX" : row.servico === "PAC" ? "Correios PAC" : row.servico || "Transportadora",
    servico: row.servico || "",
    valor: Number(row.valor || 0),
    prazo: row.prazo || "Sob consulta",
    observacao: row.funcionamento_loja || "",
    escolhido: Boolean(row.escolhido),
    pesoUsado: Number(row.peso || 0),
    origem,
    // Card calculado relido: o valor gravado E o do card (ele nao se edita).
    ...(origem === "COTACAO" ? { valorCotado: Number(row.valor || 0) } : {})
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
 *
 * `SiglaServico` vazio (27/10/2026): a Azul devolve todos os serviços do
 * contrato e cada um vira um card. Nomes, filtro, margem e corpo vazio estão
 * em `lib/cotacao-azul.ts`.
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
    SiglaServico: "",
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

  // Corpo vazio = nenhuma opção da Azul (serviço fora do contrato), não erro.
  return mapearCotacoesAzul(lerCorpoCotacaoAzul(await response.text()), {
    id_int: input.id_int,
    volumes,
    pesoKg,
    pesoGramas: input.peso
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
 * IDENTIDADE ESTAVEL DA OPCAO (08/10/2026).
 *
 * O `id` e a identidade TRANSITORIA da opcao na cotacao: nada dele vai para
 * `cotacao_frete` (a linha nasce com id proprio do banco) nem e lido de volta
 * de `opcoes_cotadas`, que e so retrato de auditoria.
 *
 * Ele PRECISA ser o mesmo entre duas cotacoes iguais: quem aplica — a rota do
 * frete complementar (`/api/orcamentos/complementar/aplicar-frete`) e a
 * recotacao da Expedicao (`/api/expedicao/recotacao/aplicar`) — recota no
 * servidor e procura a opcao escolhida PELO ID. Com `Date.now()` no id, as
 * opcoes de Motoboy, Sao Miguel e VEPPO nunca eram encontradas e a aplicacao
 * morria em "a opcao escolhida nao apareceu na cotacao de agora", fechando um
 * beco no complementar de motoboy (pedido 23409, 07/10/2026).
 *
 * SEDEX e Azul ja eram estaveis (`frete_sedex_<servico>_<idx>` e
 * `frete_azul_<servico>_<idx>`) e nao mudam. Cada fonte abaixo devolve no
 * maximo UMA opcao por cotacao, entao o id fixo nao colide.
 */
/**
 * Request shipping carrier freight quotes from Supabase RPC.
 *
 * Sempre com o JWT do usuário: `calcular_frete_transportadora` roda como quem
 * chama e lê `transportadoras`, que não é aberta ao `anon`. No navegador vale o
 * client da sessão; no servidor não há sessão de navegador, e a rota PRECISA
 * passar o próprio client em `opcoes.supabase`. Até 26/09/2026 o caminho do
 * servidor caía na anon key sem avisar, e as rotas de recotação e de frete do
 * complementar cotavam transportadoras como `anon`.
 */
export async function solicitarCotacaoTransportadoras(
  input: {
    peso: number;
    cidade: string;
    uf: string;
    id_int?: number | string;
  },
  opcoes: { supabase?: SupabaseClient } = {}
): Promise<PropostaFrete[]> {
  const normalizedCidade = normalizeCityName(input.cidade);
  const normalizedUf = input.uf.toUpperCase().trim();
  const pesoKg = input.peso / 1000;

  const client = opcoes.supabase ?? getSupabaseClient();
  if (!client) {
    throw new Error("Configurações do Supabase ausentes no ambiente.");
  }
  if (!opcoes.supabase && !(await tokenDaSessao())) {
    throw new Error("Cotação de transportadoras exige usuário logado.");
  }

  const payload = {
    p_cidade: normalizedCidade,
    p_peso: pesoKg,
    p_uf: normalizedUf
  };

  const { data, error } = await client.rpc("calcular_frete_transportadora", payload);

  if (error) {
    throw new Error(`Erro na cotação de transportadoras: ${error.message}`);
  }

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
      id: "frete_transp_sm",
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

  // un = Transportadora Unesul — DESCONTINUADA em 19/08/2026.
  // A RPC continua devolvendo `un`, e ele é deliberadamente ignorado aqui: parar
  // de oferecer é decisão de negócio, e o lugar dela é o código, não o banco. A
  // tabela `transportadoras` fica intocada (as tarifas UN estavam degradadas —
  // `1kg_UN` zerado em todas as linhas, sobrando ~R$ 1,00/kg sem piso, o que
  // fazia a Unesul aparecer sempre como a opção mais barata da lista).
  // O histórico segue legível: `normalizarTipoFrete` continua reconhecendo
  // "UNESUL" para as 35 cotações e 5 escolhas já gravadas.

  // mb = Motoboy
  if (row.mb !== undefined && row.mb > 0) {
    results.push({
      id: "frete_transp_mb",
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
 * Cotação VEPPO da tela do orçamento.
 *
 * Desde 21/10/2026 o navegador NÃO chama mais o webhook `coordenadas` do n8n:
 * chama a rota `/api/frete/veppo`, que aplica no servidor a regra de sempre
 * (RS e fora de Porto Alegre), confere a cidade em `cidades_veppo` e só então
 * chama o n8n (services/frete-veppo.server). Cidade não atendida volta sem
 * cotação — a opção VEPPO não aparece, como quando a VEPPO não responde.
 *
 * A assinatura e o retorno são os de antes; nunca lança (erro = nenhuma cotação).
 * A regra de sempre também é conferida aqui, antes da rota, para RS fora de
 * Porto Alegre e outros estados não fazerem chamada nenhuma, como hoje.
 */
export async function solicitarCotacaoVeppo(input: {
  peso: number;
  valor: number;
  cidade: string;
  uf: string;
  id_int?: number | string;
}): Promise<PropostaFrete[]> {
  if (!regraAtualPermiteVeppo(input.uf, input.cidade)) {
    return [];
  }

  try {
    const response = await fetchComSessao("/api/frete/veppo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success || !Array.isArray(data.fretes)) {
      return [];
    }
    return data.fretes as PropostaFrete[];
  } catch (error) {
    console.warn(`[FreteService] Erro ao consultar VEPPO:`, error);
    return [];
  }
}
