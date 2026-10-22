/**
 * Cotação VEPPO no servidor (21/10/2026). O ÚNICO caminho do ERP até o webhook
 * `coordenadas` do n8n: a tela do orçamento chega aqui pela rota
 * `/api/frete/veppo` e o Maestro chama esta função direto.
 *
 * Ordem: regra de sempre (RS e fora de Porto Alegre) -> lista `cidades_veppo`
 * (lida com a chave de serviço: o RLS da tabela não tem política, e um usuário
 * logado leria zero linhas) -> webhook. O corpo enviado, o tempo limite e o
 * mapeamento da resposta são os de antes. Regra da cidade em lib/cidade-veppo.
 *
 * Só leitura no banco; nada é gravado.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PropostaFrete } from "@/features/orcamentos/types";
import { criarClientServiceRole } from "@/features/cadastros/services/cadastro-online.server";
import {
  chaveCidadeVeppo,
  regraAtualPermiteVeppo,
  type StatusCotacaoVeppo
} from "@/features/orcamentos/lib/cidade-veppo";

export const WEBHOOK_VEPPO = "https://10074.hostoo.net.br/webhook/coordenadas";

export type EntradaCotacaoVeppo = {
  peso: number;
  valor: number;
  cidade: string;
  uf: string;
  id_int?: number | string;
};

export type ResultadoCotacaoVeppo = { status: StatusCotacaoVeppo; fretes: PropostaFrete[] };

type Dependencias = {
  clienteServico: () => SupabaseClient | null;
  buscar: typeof fetch;
};

const PADRAO: Dependencias = {
  clienteServico: () => criarClientServiceRole(),
  buscar: (...args) => fetch(...args)
};

/** Chaves (só letras) das cidades ativas, ou null quando a lista não pôde ser lida. */
async function lerCidadesAtendidas(clienteServico: () => SupabaseClient | null): Promise<Set<string> | null> {
  const client = clienteServico();
  if (!client) return null;
  const { data, error } = await client.from("cidades_veppo").select("cidade").eq("is_ativa", true);
  if (error || !Array.isArray(data)) return null;
  return new Set((data as Array<{ cidade: string | null }>).map((l) => chaveCidadeVeppo(l.cidade)).filter(Boolean));
}

export async function cotarVeppoNoServidor(
  input: EntradaCotacaoVeppo,
  dependencias: Partial<Dependencias> = {}
): Promise<ResultadoCotacaoVeppo> {
  const deps = { ...PADRAO, ...dependencias };

  // 1. Regra de sempre: fora dela, nenhuma cotação, como hoje.
  if (!regraAtualPermiteVeppo(input.uf, input.cidade)) return { status: "FORA_DA_REGRA", fretes: [] };

  // 2. Lista de cidades atendidas.
  const atendidas = await lerCidadesAtendidas(deps.clienteServico);
  if (!atendidas) {
    console.warn("[frete-veppo] lista cidades_veppo indisponivel: VEPPO nao cotada");
    return { status: "LISTA_INDISPONIVEL", fretes: [] };
  }
  if (!atendidas.has(chaveCidadeVeppo(input.cidade))) return { status: "NAO_ATENDIDA", fretes: [] };

  // 3. Webhook, exatamente como antes.
  const normalizedUf = input.uf?.trim().toUpperCase();
  const payload = {
    text: `${input.cidade}, ${normalizedUf}, Brasil`,
    cidade: input.cidade,
    valor: input.valor,
    peso: input.peso
  };

  try {
    const response = await deps.buscar(WEBHOOK_VEPPO, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      console.warn(`[FreteService] VEPPO retornou erro ${response.status}`);
      return { status: "SEM_COTACAO", fretes: [] };
    }

    const data = await response.json();
    if (!data || typeof data.valor_frete !== "number") {
      return { status: "SEM_COTACAO", fretes: [] };
    }

    const valorFrete = Number(data.valor_frete);
    const idIntNum = typeof input.id_int === "number" ? input.id_int : (Number(input.id_int) || 0);

    return {
      status: "COTADA",
      fretes: [{
        id: "frete_veppo",
        id_int: idIntNum,
        transportadora: "VEPPO",
        servico: "VEPPO",
        valor: valorFrete,
        prazo: "Sob consulta",
        observacao: "Cotação via VEPPO",
        escolhido: false,
        pesoUsado: input.peso
      }]
    };
  } catch (error) {
    console.warn(`[FreteService] Erro ao consultar VEPPO:`, error);
    return { status: "SEM_COTACAO", fretes: [] };
  }
}
