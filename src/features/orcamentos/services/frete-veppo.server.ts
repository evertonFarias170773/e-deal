/**
 * Cotação VEPPO no servidor (21/10/2026). O ÚNICO caminho do ERP até o webhook
 * `coordenadas` do n8n: a tela do orçamento chega aqui pela rota
 * `/api/frete/veppo` e o Maestro chama esta função direto.
 *
 * Ordem: regra de sempre (RS e fora de Porto Alegre) -> lista `cidades_veppo`
 * (lida com a chave de serviço: o RLS da tabela não tem política, e um usuário
 * logado leria zero linhas) -> webhook. O corpo enviado, o tempo limite e o
 * mapeamento da resposta são os de antes. Regra da cidade em lib/cidade-veppo.
 * Desde 03/11/2026 o valor do n8n leva +20% aqui, uma vez só (lib/cotacao-veppo),
 * exceto no pedido que já tinha a VEPPO escolhida antes disso (corte por pedido).
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
import {
  aplicarMargemVeppo,
  cotacaoVeppoLegada,
  rotuloMargemVeppo,
  valorVeppoValido
} from "@/features/orcamentos/lib/cotacao-veppo";

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

/**
 * O pedido cota a VEPPO sem o acréscimo? Lê a data da proposta e o frete
 * escolhido em `cotacao_frete` (só leitura, chave de serviço como a lista).
 * `null` = não deu para conferir.
 */
async function lerCorteDoPedido(clienteServico: () => SupabaseClient | null, idInt: number): Promise<boolean | null> {
  const client = clienteServico();
  if (!client) return null;
  const [proposta, escolhidos] = await Promise.all([
    client.from("propostas").select("created_at").eq("id_int", idInt).maybeSingle(),
    client.from("cotacao_frete").select("servico").eq("id_int", idInt).eq("escolhido", true)
  ]);
  if (proposta.error || escolhidos.error) return null;
  return cotacaoVeppoLegada({
    propostaCriadaEm: (proposta.data as { created_at?: string | null } | null)?.created_at,
    servicosEscolhidos: ((escolhidos.data ?? []) as Array<{ servico: string | null }>).map((l) => l.servico)
  });
}

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

  // 3. Corte do acréscimo (lib/cotacao-veppo): pedido com VEPPO escolhida antes
  //    de 03/11/2026 cota sem os 20%. Sem conseguir conferir, não cota (como a lista).
  const idIntNum = typeof input.id_int === "number" ? input.id_int : (Number(input.id_int) || 0);
  const legada = idIntNum > 0 ? await lerCorteDoPedido(deps.clienteServico, idIntNum) : false;
  if (legada === null) {
    console.warn(`[frete-veppo] corte do acrescimo nao conferido para #${idIntNum}: VEPPO nao cotada`);
    return { status: "CORTE_NAO_CONFERIDO", fretes: [] };
  }

  // 4. Webhook, exatamente como antes.
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
    // Zero, negativo ou sem número: sem card (03/11/2026; antes zero e negativo viravam card).
    if (!data || !valorVeppoValido(data.valor_frete)) {
      return { status: "SEM_COTACAO", fretes: [] };
    }

    // Pedido antigo: o card de antes de 03/11/2026, sem acréscimo e sem a linha "Original".
    if (legada) {
      return {
        status: "COTADA",
        fretes: [{
          id: "frete_veppo",
          id_int: idIntNum,
          transportadora: "VEPPO",
          servico: "VEPPO",
          valor: Number(data.valor_frete),
          prazo: "Sob consulta",
          observacao: "Cotação via VEPPO",
          escolhido: false,
          pesoUsado: input.peso
        }]
      };
    }

    // +20% sobre o valor do n8n (lib/cotacao-veppo). Único ponto da conta.
    const { valorOriginal, valorFinal } = aplicarMargemVeppo(data.valor_frete);
    const originalTexto = valorOriginal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

    return {
      status: "COTADA",
      fretes: [{
        id: "frete_veppo",
        id_int: idIntNum,
        transportadora: "VEPPO",
        servico: "VEPPO",
        valor: valorFinal,
        prazo: "Sob consulta",
        observacao: `Cotação via VEPPO | Valor original: ${originalTexto} (${rotuloMargemVeppo()})`,
        escolhido: false,
        pesoUsado: input.peso,
        valorOriginal,
        valorMargem: valorFinal
      }]
    };
  } catch (error) {
    console.warn(`[FreteService] Erro ao consultar VEPPO:`, error);
    return { status: "SEM_COTACAO", fretes: [] };
  }
}
